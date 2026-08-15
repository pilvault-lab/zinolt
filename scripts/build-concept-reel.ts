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
import { fileAsAttachment, isEmailConfigured, sendEmail } from "../lib/mail";

// Kept in sync with remotion/concept-reel/ConceptReelComposition.ts.
// We hardcode here to avoid pulling @remotion/media (webpack-only) into Node.
const CR_FPS = 60;
const CR_TAIL_PADDING_SEC = 2.0;

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

async function emailVideo(
  slug: string,
  label: string,
  mp4Path: string,
  to: string | undefined,
): Promise<boolean> {
  if (!isEmailConfigured()) {
    console.error(
      "  ✗ email requested but not configured — set RESEND_API_KEY + EMAIL_FROM (+ EMAIL_TO)",
    );
    return false;
  }
  try {
    const attachment = fileAsAttachment(mp4Path, "video/mp4");
    const sizeMb = (Buffer.byteLength(attachment.content, "base64") / 1e6).toFixed(2);
    console.log(`  [3/3] emailing ${sizeMb} MB → ${to ?? process.env.EMAIL_TO ?? "(EMAIL_TO)"}`);
    const { id } = await sendEmail({
      to,
      subject: `Concept Reel — ${label}`,
      html: `<p>Fresh <strong>${label}</strong> reel attached (${sizeMb} MB).</p><p>Slug: <code>${slug}</code></p>`,
      text: `Fresh ${label} reel attached (${sizeMb} MB). Slug: ${slug}`,
      attachments: [attachment],
    });
    console.log(`    ✓ sent (resend id: ${id})`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ email failed: ${msg}`);
    return false;
  }
}

async function buildOne(
  slug: string,
  voice: string,
  noRender: boolean,
  emailTo: string | undefined,
  shouldEmail: boolean,
): Promise<boolean> {
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
  const totalSec = (words.at(-1)?.end ?? 0) + CR_TAIL_PADDING_SEC;
  const durationFrames = Math.max(CR_FPS, Math.ceil(totalSec * CR_FPS));
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

  if (shouldEmail) {
    const ok = await emailVideo(slug, script.label, outPath, emailTo);
    if (!ok) return false;
  }
  return true;
}

/** Load .env.local into process.env — the build script runs outside Next.js. */
function loadEnvLocal() {
  try {
    const content = readEnvFile(".env.local");
    for (const [k, v] of Object.entries(content)) {
      if (process.env[k] === undefined) process.env[k] = v;
    }
  } catch {
    // no .env.local — env may already be set another way, fine.
  }
}

function readEnvFile(path: string): Record<string, string> {
  const raw = require("node:fs").readFileSync(path, "utf8") as string;
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[m[1]] = value;
  }
  return out;
}

async function main() {
  loadEnvLocal();

  const args = parseArgs(process.argv.slice(2));
  const voice = (args.voice as string) || DEFAULT_VOICE;
  const noRender = Boolean(args["no-render"]);
  // --email          → send to EMAIL_TO env var
  // --email address  → send to that specific address
  const shouldEmail = Boolean(args.email);
  const emailTo = typeof args.email === "string" ? args.email : undefined;

  let slugs: string[];
  if (args.all) {
    slugs = CONCEPTS.map((c) => c.id);
  } else if (typeof args.concept === "string") {
    slugs = [args.concept];
  } else {
    console.error(
      "Usage: build-concept-reel.ts --concept <slug> [--voice <name>] [--no-render] [--email [address]]",
    );
    console.error("       build-concept-reel.ts --all [--email [address]]");
    console.error(`\nKnown concepts: ${CONCEPTS.map((c) => c.id).join(", ")}`);
    process.exit(1);
  }

  if (shouldEmail && !isEmailConfigured()) {
    console.error(
      "\n✗ --email requires RESEND_API_KEY and EMAIL_FROM in .env.local (see lib/mail.ts).",
    );
    process.exit(1);
  }

  let failed = 0;
  for (const slug of slugs) {
    const ok = await buildOne(slug, voice, noRender, emailTo, shouldEmail);
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
