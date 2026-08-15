/**
 * Build (+ render) one Concept Reel from a registered concept file.
 *
 * The pipeline:
 *   1. Loads the concept from lib/explainer/concepts/{slug}.ts
 *   2. Synthesizes narration (Edge TTS, brand voice) → mp3 + word timings
 *   3. Writes the audio to public/concept-reel/audio/{slug}.mp3
 *   4. Writes render props to a temp file
 *   5. Runs `npx remotion render ConceptReel …` → outputs/concept-reels/{slug}.mp4
 *
 * Adding a new concept:
 *   - Author lib/explainer/concepts/{slug}.ts exporting a ConceptScript.
 *   - Register it in lib/explainer/concepts/index.ts (add to CONCEPTS).
 *   - Run: npx tsx scripts/build-concept-reel.ts --concept {slug}
 *
 * Usage:
 *   npx tsx scripts/build-concept-reel.ts --concept fvg
 *   npx tsx scripts/build-concept-reel.ts --concept fvg --voice en-US-BrianMultilingualNeural
 *   npx tsx scripts/build-concept-reel.ts --all
 *   npx tsx scripts/build-concept-reel.ts --concept fvg --no-render
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, statSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { CONCEPTS, getConcept } from "../lib/explainer/concepts";
import { synthesizeNarration } from "../lib/tts";
import { computeConceptReelDurationFrames, CR_FPS } from "../remotion/concept-reel/ConceptReelComposition";

const ROOT = resolve(join(import.meta.dirname, ".."));
const AUDIO_DIR = join(ROOT, "public", "concept-reel", "audio");
const OUT_DIR = join(ROOT, "outputs", "concept-reels");

const DEFAULT_VOICE = "en-US-AndrewMultilingualNeural";

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function run(
  cmd: string,
  cmdArgs: string[],
  opts: { timeoutMs?: number; env?: Record<string, string> } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const isWindows = process.platform === "win32";
    const child = spawn(cmd, cmdArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: isWindows,
      env: { ...process.env, ...opts.env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => {
      stdout += c.toString();
      process.stdout.write(c);
    });
    child.stderr.on("data", (c) => {
      stderr += c.toString();
      process.stderr.write(c);
    });
    const timer = opts.timeoutMs
      ? setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs)
      : null;
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolvePromise({ code: code ?? -1, stdout, stderr });
    });
    child.on("error", () =>
      resolvePromise({ code: -1, stdout, stderr }),
    );
  });
}

async function buildOne(slug: string, voice: string, noRender: boolean): Promise<boolean> {
  const script = getConcept(slug);
  if (!script) {
    console.error(`  ✗ no concept registered with id "${slug}"`);
    console.error(`    known concepts: ${CONCEPTS.map((c) => c.id).join(", ")}`);
    return false;
  }

  console.log(`\n▶ ${script.label}  (${slug})`);

  // 1. Synthesize narration.
  console.log(`  [1/3] synthesizing narration (voice=${voice}) …`);
  const { mp3, words, durationSec } = await synthesizeNarration(script.narration, {
    voice,
    rate: "-5%",
  });
  console.log(`    ✓ ${mp3.length}B mp3, ${words.length} words, ${durationSec.toFixed(2)}s`);

  // 2. Write audio to public/ so staticFile() can serve it to Remotion.
  mkdirSync(AUDIO_DIR, { recursive: true });
  const audioPath = join(AUDIO_DIR, `${slug}.mp3`);
  writeFileSync(audioPath, mp3);
  const audioRel = `concept-reel/audio/${slug}.mp3`;
  console.log(`    ✓ audio → public/${audioRel}`);

  // 3. Write props file for remotion CLI.
  mkdirSync(OUT_DIR, { recursive: true });
  const propsPath = join(OUT_DIR, `.props-${slug}.json`);
  const props = {
    text: script.narration,
    words,
    audioSrc: audioRel,
    mode: "diagram" as const,
    diagramId: slug,
  };
  writeFileSync(propsPath, JSON.stringify(props), "utf8");

  if (noRender) {
    console.log(`  [2/3] --no-render, wrote props to ${propsPath} and skipping render.`);
    return true;
  }

  // 4. Render.
  const outPath = join(OUT_DIR, `${slug}.mp4`);
  const durationFrames = computeConceptReelDurationFrames(words, CR_FPS);
  console.log(`  [2/3] rendering ${durationFrames} frames @ ${CR_FPS}fps → ${outPath}`);
  const res = await run(
    "npx",
    [
      "remotion",
      "render",
      "ConceptReel",
      outPath,
      "--props",
      propsPath,
      "--codec",
      "h264",
    ],
    {
      timeoutMs: 20 * 60 * 1000,
      env: { CONCEPT_REEL_ONLY: "1" },
    },
  );

  try {
    unlinkSync(propsPath);
  } catch {
    // best-effort cleanup
  }

  if (res.code !== 0 || !existsSync(outPath) || statSync(outPath).size < 100_000) {
    console.error(`  ✗ render failed for ${slug} (exit=${res.code})`);
    return false;
  }
  console.log(`  ✓ ${outPath} (${(statSync(outPath).size / 1e6).toFixed(1)} MB)`);
  return true;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const voice = (args.voice as string) || DEFAULT_VOICE;
  const noRender = Boolean(args["no-render"]);

  let slugs: string[];
  if (args.all) {
    slugs = CONCEPTS.map((c) => c.id);
  } else if (typeof args.concept === "string") {
    slugs = [args.concept];
  } else {
    console.error(
      "Usage: build-concept-reel.ts --concept <slug> [--voice <name>] [--no-render]",
    );
    console.error("       build-concept-reel.ts --all");
    console.error(`\nKnown concepts: ${CONCEPTS.map((c) => c.id).join(", ")}`);
    process.exit(1);
  }

  let failed = 0;
  for (const slug of slugs) {
    const ok = await buildOne(slug, voice, noRender);
    if (!ok) failed++;
  }
  if (failed > 0) {
    console.error(`\n✗ ${failed} concept(s) failed.`);
    process.exit(1);
  }
  console.log(`\n✓ Done.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
