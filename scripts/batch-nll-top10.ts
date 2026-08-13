/**
 * Batch: NLL top 10 — hand-picked Next Level Life clips.
 *
 * Fix for prior audio-cutoff: skip `--download-sections` entirely
 * (broken mux at boundaries). Download full 1080p, then let the
 * letterbox pass do the trim via -ss/-t + full re-encode.
 *
 * Pipeline per clip:
 *   1. yt-dlp full-download 1080p (cached).
 *   2. buildTreatmentArgs letterboxed + Vernavle hook + watermark, no captions.
 *      -ss/-t select the window with re-encode (audio+video stay in sync).
 *   3. Output → outputs/money-simplified/nll-NN-{slug}.mp4.
 *
 * Usage:
 *   npx tsx scripts/batch-nll-top10.ts              # runs all 10
 *   npx tsx scripts/batch-nll-top10.ts 01 03 07     # runs subset by number
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, statSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brandAssetPaths, buildTreatmentArgs, fitHeadline, runFfmpeg } from "../lib/video-treatment";

const ROOT = join(import.meta.dirname, "..");
const OUT_DIR = join(ROOT, "outputs", "money-simplified");
const COOKIES = join(ROOT, "cookies.txt");
const TMP = join(tmpdir(), "zinolt-nll-top10");
const CACHE = join(TMP, "sources");
const REPORT = join(OUT_DIR, "nll-run-report.md");
mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(CACHE, { recursive: true });
const BRAND = brandAssetPaths(join(ROOT, "public"));

type Clip = { n: string; slug: string; videoId: string; hook: string; start: number; end: number; sourceTitle: string };

// Hand-picked, high-value NLL videos. Windows chosen to skip cold-open/CTA.
const CLIPS: Clip[] = [
  { n: "01", slug: "compound-interest",         videoId: "i0ub12TKBBc", hook: "The power of compound interest",           start: 10,  end: 128, sourceTitle: "The Power of Compound Interest" },
  { n: "02", slug: "wealth-you-dont-see",       videoId: "_IM8AQ3wCj0", hook: "Wealth is what you don't see",             start: 30,  end: 135, sourceTitle: "PSA: Wealth Is What You Don't See" },
  { n: "03", slug: "hierarchy-financial-needs", videoId: "CJdVlI7_MDU", hook: "The hierarchy of financial needs",         start: 30,  end: 135, sourceTitle: "The Hierarchy of Financial Needs" },
  { n: "04", slug: "three-stages-of-wealth",    videoId: "4WQPyHxZGVE", hook: "The 3 stages of wealth creation",          start: 30,  end: 135, sourceTitle: "The 3 Stages of Wealth Creation" },
  { n: "05", slug: "atomic-habits-money",       videoId: "B54DZW6g_hQ", hook: "The atomic habits of financial success",   start: 30,  end: 135, sourceTitle: "The Atomic Habits of Financial Success" },
  { n: "06", slug: "time-in-the-market",        videoId: "8M9vkcVZOTs", hook: "Time in the market beats timing the market", start: 30, end: 135, sourceTitle: "Time In The Market Beats Timing The Market" },
  { n: "07", slug: "parkinsons-law-budget",     videoId: "oN_ZNdvxyzc", hook: "Parkinson's law wrecks your budget",       start: 30,  end: 135, sourceTitle: "How Parkinson's Law WRECKS Your BUDGET" },
  { n: "08", slug: "only-financial-number",     videoId: "Ty5KeSaSJeI", hook: "The only financial number that matters",   start: 30,  end: 135, sourceTitle: "The ONLY Financial Number That REALLY Matters" },
  { n: "09", slug: "personal-finance-tradeoffs",videoId: "nIBIQsO8VQw", hook: "Personal finance is all about trade-offs", start: 30,  end: 135, sourceTitle: "Personal Finance Is All About Trade Offs" },
  { n: "10", slug: "problem-with-inflation",    videoId: "MI6VB0K27dQ", hook: "The problem with inflation",               start: 30,  end: 135, sourceTitle: "Here's The Problem With Inflation..." },
];

// Firefox live cookies — see lib/ytdlp-cookies.ts for rationale.
const cookieArgs = ["--cookies-from-browser", "firefox"];

function run(cmd: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "", stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    const timer = opts.timeoutMs ? setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs) : null;
    child.on("close", (code) => { if (timer) clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }); });
    child.on("error", () => resolve({ code: -1, stdout, stderr }));
  });
}

async function downloadFull(videoId: string): Promise<{ ok: boolean; path?: string; err?: string }> {
  const dest = join(CACHE, `${videoId}.mp4`);
  if (existsSync(dest) && statSync(dest).size > 500_000) return { ok: true, path: dest };
  const res = await run("yt-dlp", [
    ...cookieArgs,
    "-f", "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best",
    "--merge-output-format", "mp4",
    "--no-playlist",
    "-o", dest,
    `https://www.youtube.com/watch?v=${videoId}`,
  ], { timeoutMs: 900_000 });
  if (res.code === 0 && existsSync(dest) && statSync(dest).size > 500_000) return { ok: true, path: dest };
  return { ok: false, err: res.stderr.slice(-400) };
}

async function repurpose(input: string, output: string, hook: string, start: number, dur: number): Promise<{ ok: boolean; err?: string }> {
  const txtPath = join(TMP, `${Buffer.from(output).toString("hex").slice(0, 8)}_hook.txt`);
  const fit = fitHeadline(hook);
  writeFileSync(txtPath, fit.lines.join("\n"), "utf8");
  const args = buildTreatmentArgs({
    source: input, output,
    orientation: "letterboxed",
    clipStart: start, clipDuration: dur,
    watermarkPath: BRAND.watermark,
    headline: hook,
    vernavleTtf: BRAND.vernavleTtf,
    fontsDir: BRAND.fontsDir,
    headlineTextfilePath: txtPath,
    headlineFontsize: fit.fontsize,
    headlineLineCount: fit.lines.length,
  });
  const res = await runFfmpeg(args);
  try { rmSync(txtPath); } catch {}
  if (res.code !== 0) return { ok: false, err: res.stderr.slice(-500) };
  return { ok: true };
}

function appendReport(section: string) {
  if (!existsSync(REPORT)) {
    writeFileSync(REPORT, `# NLL top 10 run report\n\nGenerated: ${new Date().toISOString()}\nSource: Next Level Life (@NextLevelLife)\n\n`, "utf8");
  }
  appendFileSync(REPORT, section + "\n", "utf8");
}

async function runClip(c: Clip): Promise<void> {
  const dur = c.end - c.start;
  console.log(`\n══════════════════════════════════════════════`);
  console.log(`▶ [${c.n}] ${c.hook}  (${c.slug})`);
  console.log(`  video: https://youtu.be/${c.videoId}  window: ${c.start}-${c.end}s`);

  const dl = await downloadFull(c.videoId);
  if (!dl.ok) {
    console.log(`  ⊘ download failed: ${dl.err}`);
    appendReport(`## ${c.n}. ${c.hook}\nslug: \`${c.slug}\`\n\n- **SKIPPED** — download failed\n`);
    return;
  }
  console.log(`  ✓ source ready (${(statSync(dl.path!).size / 1e6).toFixed(1)} MB)`);

  const outName = `nll-${c.n}-${c.slug}.mp4`;
  const outPath = join(OUT_DIR, outName);
  if (existsSync(outPath)) rmSync(outPath);
  const rep = await repurpose(dl.path!, outPath, c.hook, c.start, dur);
  if (!rep.ok) {
    console.log(`  ⊘ ffmpeg failed: ${rep.err}`);
    appendReport(`## ${c.n}. ${c.hook}\nslug: \`${c.slug}\`\n\n- **SKIPPED** — ffmpeg failed\n`);
    return;
  }
  console.log(`  ✓ wrote outputs/money-simplified/${outName}`);
  appendReport([
    `## ${c.n}. ${c.hook}`,
    `slug: \`${c.slug}\``,
    ``,
    `- **Source**: [${c.sourceTitle}](https://youtu.be/${c.videoId})`,
    `- **Window**: ${c.start}s – ${c.end}s (${dur}s)`,
    `- **Output**: \`outputs/money-simplified/${outName}\``,
    ``,
  ].join("\n"));
}

async function main() {
  const argv = process.argv.slice(2);
  const targets = argv.length > 0 ? CLIPS.filter((c) => argv.includes(c.n)) : CLIPS;
  if (argv.length && targets.length === 0) {
    console.error(`No matching clips. Numbers: ${CLIPS.map((c) => c.n).join(", ")}`);
    process.exit(1);
  }
  for (const c of targets) await runClip(c);
  console.log(`\nDone. Report: outputs/money-simplified/nll-run-report.md`);
}

main().catch((e) => { console.error(e); process.exit(1); });
