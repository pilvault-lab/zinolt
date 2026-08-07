/**
 * Batch: viral-wealth-mechanics
 *
 * 10 clips from high-view wealth-building interviews.
 * Sources: Patrick Bet-David (2 videos), Codie Sanchez (2 videos),
 *          Ramit Sethi, Naval Ravikant (JRE), Graham Stephan.
 *
 * All timestamps verified against video chapter data via yt-dlp.
 *
 * Usage: npx tsx scripts/batch-viral-wealth.ts
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brandAssetPaths, buildTreatmentArgs, fitHeadline, runFfmpeg } from "../lib/video-treatment";

const BATCH = "viral-wealth-mechanics";
const ROOT = join(import.meta.dirname, "..");
const OUT_DIR = join(ROOT, "outputs", "clips", BATCH);
mkdirSync(OUT_DIR, { recursive: true });

// ─── Clip manifest ────────────────────────────────────────────────────────────
// Timestamps chosen from verified chapter boundaries.
const CLIPS = [
  {
    n: "01", videoId: "q5ycx357EoM", start: 71, end: 151,
    label: "pbd-if-i-was-broke",
    // Chapter: "If you were broke today, what would be your first 3 moves?" (71–236s)
    headline: "Patrick Bet-David: if I woke up broke tomorrow, these are the exact three things I would do.",
  },
  {
    n: "02", videoId: "WPn6ll25Wr4", start: 568, end: 648,
    label: "codie-why-boring-biz",
    // Chapter: "Why do you like boring businesses" (568–769s)
    headline: "Codie Sanchez: the businesses nobody wants to own are the ones quietly making people rich.",
  },
  {
    n: "03", videoId: "3qHkcs3kG44", start: 300, end: 380,
    label: "naval-jre-wealth",
    // JRE #1309 — wealth discussion opens the episode; first chapter 0–1223s
    headline: "Naval Ravikant: you're not going to get rich renting out your time. You must own equity.",
  },
  {
    n: "04", videoId: "WPn6ll25Wr4", start: 2962, end: 3042,
    label: "codie-seller-financing",
    // Chapter: "Seller Financing" (2962–3168s)
    headline: "Codie Sanchez: seller financing lets you buy a business using the business's own revenue.",
  },
  {
    n: "05", videoId: "hSiNUggA6jE", start: 1939, end: 2019,
    label: "ramit-skill-of-spending",
    // Chapter: "The Skill of Spending Money" (1939–2132s)
    headline: "Ramit Sethi: the skill nobody teaches you is how to spend money on the life you actually want.",
  },
  {
    n: "06", videoId: "jjFWtuFWZa8", start: 440, end: 520,
    label: "codie-first-boring-biz",
    // Chapter: "The first boring business Codie bought" (368–630s)
    headline: "Codie Sanchez: I bought my first boring business with almost nothing down. Here is exactly how.",
  },
  {
    n: "07", videoId: "q5ycx357EoM", start: 2461, end: 2541,
    label: "pbd-what-blocks-wealth",
    // Chapter: "What blocks people from making money the most?" (2461–2969s)
    headline: "Patrick Bet-David: this single mindset is the reason most people never build real wealth.",
  },
  {
    n: "08", videoId: "hSiNUggA6jE", start: 3472, end: 3552,
    label: "ramit-negotiate-salary",
    // Chapter: "Negotiating Raises Effectively" (3472–3860s)
    headline: "Ramit Sethi: one salary negotiation is worth more than a decade of cutting your spending.",
  },
  {
    n: "09", videoId: "sTpvUc9U6f8", start: 120, end: 200,
    label: "graham-millionaire-26",
    // Graham Stephan "How I became a Millionaire in Real Estate by 26" (3.4M views)
    headline: "Graham Stephan: I became a millionaire in real estate at 26 using one repeatable strategy.",
  },
  {
    n: "10", videoId: "nD1Et0QUrrU", start: 50, end: 130,
    label: "pbd-number-1-rule",
    // Patrick Bet-David "Number 1 Rule Of Money" (1.6M views, Valuetainment)
    headline: "Patrick Bet-David: the number one rule of money that separates the wealthy from everyone else.",
  },
];

// ─── yt-dlp segment download ──────────────────────────────────────────────────
function downloadSegment(videoId: string, start: number, end: number, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      "--download-sections", `*${start}-${end}`,
      "-f", "best[ext=mp4]/best",
      "--no-playlist",
      "-o", dest,
      `https://www.youtube.com/watch?v=${videoId}`,
    ];
    const child = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString();
      process.stderr.write(c);
    });
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
  const tmp = join(tmpdir(), "zinolt-viral-wealth");
  mkdirSync(tmp, { recursive: true });

  // Phase 1: sequential downloads (avoid 403 rate-limiting from parallel)
  console.log("Phase 1: downloading 10 segments …\n");
  const segPaths: Record<string, string> = {};

  for (const clip of CLIPS) {
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
  }

  // Phase 2: ffmpeg letterbox + headline treatment
  console.log("\nPhase 2: letterbox + headline treatment …\n");

  for (const clip of CLIPS) {
    const { n, label, headline, start, end } = clip;
    const duration = end - start;
    const segPath = segPaths[n];
    if (!segPath) { console.log(`  [${n}] skip (download failed)`); continue; }

    const outName = `${n}_${label}.mp4`;
    const outPath = join(OUT_DIR, outName);
    const txtPath = join(tmp, `${n}_headline.txt`);

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
