import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { brandAssetPaths, buildTreatmentArgs, fitHeadline, runFfmpeg } from "../lib/video-treatment";

const ROOT = join(import.meta.dirname, "..");
const BATCH = "doac-hormozi-sohk";
const OUT_DIR = join(ROOT, "outputs", "clips", BATCH);
const tmp = join(tmpdir(), "zinolt-batch");
const brand = brandAssetPaths(join(ROOT, "public"));

const headline = "Asking 90-year-old billionaires if getting rich was worth it.";
const segPath = join(tmp, "09_sohk-90yr-billionaires_seg.mp4");
const outPath = join(OUT_DIR, "09_sohk-90yr-billionaires.mp4");
const txtPath = join(tmp, "09_headline.txt");

const fit = fitHeadline(headline);
writeFileSync(txtPath, fit.lines.join("\n"), "utf8");

const args = buildTreatmentArgs({
  source: segPath,
  output: outPath,
  orientation: "letterboxed",
  clipStart: 0,
  clipDuration: 85,
  watermarkPath: brand.watermark,
  headline,
  vernavleTtf: brand.vernavleTtf,
  fontsDir: brand.fontsDir,
  headlineTextfilePath: txtPath,
  headlineFontsize: fit.fontsize,
  headlineLineCount: fit.lines.length,
});

async function main() {
  console.log("Running ffmpeg for clip 09...");
  const res = await runFfmpeg(args);
  if (res.code !== 0) {
    console.error("ffmpeg failed:", res.stderr.slice(-400));
    process.exit(1);
  }
  console.log("Done: outputs/clips/" + BATCH + "/09_sohk-90yr-billionaires.mp4");
}

main().catch((err) => { console.error(err); process.exit(1); });
