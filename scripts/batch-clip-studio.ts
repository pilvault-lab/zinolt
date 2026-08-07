/**
 * Batch Clip Studio pipeline — segment-only download + letterbox treatment.
 *
 * For each clip:
 *   1. yt-dlp --download-sections to grab only the needed seconds
 *   2. buildTreatmentArgs → ffmpeg letterbox + headline + watermark
 *   3. Output to outputs/clips/<BATCH>/
 *
 * Usage: npx tsx scripts/batch-clip-studio.ts
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brandAssetPaths, buildTreatmentArgs, fitHeadline, runFfmpeg } from "../lib/video-treatment";

const BATCH = "doac-hormozi-sohk";
const ROOT = join(import.meta.dirname, "..");
const OUT_DIR = join(ROOT, "outputs", "clips", BATCH);
mkdirSync(OUT_DIR, { recursive: true });

// ─── Clip manifest ───────────────────────────────────────────────────────────
const CLIPS = [
  {
    n: "01", videoId: "vOvLFT4v4LQ", start: 290, end: 375,
    label: "housel-psychology-of-money",
    headline: "Morgan Housel on money: the psychology matters more than the math.",
  },
  {
    n: "02", videoId: "vOvLFT4v4LQ", start: 1336, end: 1421,
    label: "housel-most-valuable-skill",
    headline: "Morgan Housel: the most valuable financial skill anyone can have.",
  },
  {
    n: "03", videoId: "gEF67-G9MO0", start: 266, end: 356,
    label: "hormozi-get-rich-quick-myth",
    headline: "Alex Hormozi: the get rich quick model is real. The work just filters people out.",
  },
  {
    n: "04", videoId: "gEF67-G9MO0", start: 5326, end: 5416,
    label: "hormozi-irresistible-offer",
    headline: "Alex Hormozi on offers: four ingredients that make saying no feel stupid.",
  },
  {
    n: "05", videoId: "q-_hwD1jNK4", start: 147, end: 232,
    label: "hormozi-comfort-vs-potential",
    headline: "Alex Hormozi: comfort is the price you pay for staying average.",
  },
  {
    n: "06", videoId: "q-_hwD1jNK4", start: 1685, end: 1775,
    label: "hormozi-why-people-fail",
    headline: "Alex Hormozi on failure: most people lose before they ever start.",
  },
  {
    n: "07", videoId: "SKbND1wH80k", start: 300, end: 390,
    label: "hormozi-sell-so-good",
    headline: "Alex Hormozi: learn to sell so well that saying no feels like a mistake.",
  },
  {
    n: "08", videoId: "aGrMOowjMag", start: 60, end: 145,
    label: "sohk-30-billionaires",
    headline: "I interviewed 30 billionaires. Here is what they all had in common.",
  },
  {
    n: "09", videoId: "KxoKCNCLOss", start: 60, end: 145,
    label: "sohk-90yr-billionaires",
    headline: "Asking 90-year-old billionaires if getting rich was worth it.",
  },
  {
    n: "10", videoId: "DmDeNuTUetE", start: 60, end: 145,
    label: "sohk-ny-billionaires",
    headline: "Asking New York billionaires how they actually got rich.",
  },
];

// ─── yt-dlp segment download ──────────────────────────────────────────────────
function downloadSegment(videoId: string, start: number, end: number, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      "--download-sections", `*${start}-${end}`,
      // Pre-muxed MP4 = single HTTP range request, no post-merge needed.
      // For letterboxed podcast clips the quality difference is invisible.
      "-f", "best[ext=mp4]/best",
      "--no-playlist",
      "-o", dest,
      `https://www.youtube.com/watch?v=${videoId}`,
    ];
    const child = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    // Pipe yt-dlp stderr to our stderr so progress is visible
    child.stderr.on("data", (c: Buffer) => process.stderr.write(c));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`yt-dlp exit ${code}: ${stderr.slice(-300)}`));
      else resolve();
    });
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const brand = brandAssetPaths(join(ROOT, "public"));
  const tmp = join(tmpdir(), "zinolt-batch");
  mkdirSync(tmp, { recursive: true });

  // Phase 1: download all segments in parallel
  console.log("Phase 1: downloading all 10 segments in parallel …\n");
  const segPaths: Record<string, string> = {};

  await Promise.all(CLIPS.map(async (clip) => {
    const { n, videoId, start, end, label } = clip;
    const segPath = join(tmp, `${n}_${label}_seg.mp4`);
    segPaths[n] = segPath;
    console.log(`  [${n}] ↓ ${videoId} ${start}s–${end}s`);
    try {
      await downloadSegment(videoId, start, end, segPath);
      console.log(`  [${n}] ✓ downloaded`);
    } catch (err) {
      console.error(`  [${n}] ✗ ${(err as Error).message}`);
      segPaths[n] = "";
    }
  }));

  // Phase 2: ffmpeg treatment sequentially (CPU-bound)
  console.log("\nPhase 2: letterbox + headline treatment …\n");

  for (const clip of CLIPS) {
    const { n, label, headline, start, end } = clip;
    const duration = end - start;
    const segPath = segPaths[n];
    if (!segPath) { console.log(`  [${n}] skip (download failed)`); continue; }

    const outName = `${n}_${label}.mp4`;
    const outPath = join(OUT_DIR, outName);
    const txtPath = join(tmp, `${n}_${label}_headline.txt`);

    const fit = fitHeadline(headline);
    writeFileSync(txtPath, fit.lines.join("\n"), "utf8");

    const args = buildTreatmentArgs({
      source: segPath,
      output: outPath,
      orientation: "letterboxed",
      clipStart: 0,
      clipDuration: duration,
      watermarkPath: brand.watermark,
      headline,
      vernavleTtf: brand.vernavleTtf,
      fontsDir: brand.fontsDir,
      headlineTextfilePath: txtPath,
      headlineFontsize: fit.fontsize,
      headlineLineCount: fit.lines.length,
    });

    console.log(`  [${n}] ⚙ ffmpeg ${label} …`);
    const res = await runFfmpeg(args);
    if (res.code !== 0) {
      console.error(`  [${n}] ✗ ffmpeg: ${res.stderr.slice(-200)}`);
      continue;
    }
    console.log(`  [${n}] ✓ outputs/clips/${BATCH}/${outName}`);

    try { rmSync(segPath); } catch { /* ignore */ }
    try { rmSync(txtPath); } catch { /* ignore */ }
  }

  console.log(`\nDone. Files in outputs/clips/${BATCH}/`);
}

main().catch((err) => { console.error(err); process.exit(1); });
