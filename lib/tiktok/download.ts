import { spawn } from "node:child_process";
import { mkdir, access } from "node:fs/promises";
import { join } from "node:path";
import { brandAssetPaths, buildTreatmentArgs, runFfmpeg } from "../video-treatment";

const CACHE_ROOT = join(process.cwd(), ".tiktok-cache");

function run(
  cmd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (c) => (stdout += c.toString()));
    p.stderr.on("data", (c) => (stderr += c.toString()));
    p.on("error", reject);
    p.on("close", (code) => resolve({ stdout, stderr, code }));
  });
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export type TikTokResult = {
  videoId: string;
  title: string;
  filename: string;
};

export async function downloadTikTok(
  rawUrl: string,
): Promise<TikTokResult | { error: string }> {
  // Step 1: info JSON — extracts real video ID and duration regardless of
  // URL format (short links, @user/video/, etc.).
  const infoRes = await run("yt-dlp", [
    "-J",
    "--no-playlist",
    "--skip-download",
    rawUrl,
  ]);
  if (infoRes.code !== 0) {
    return { error: `yt-dlp info failed: ${infoRes.stderr.slice(0, 200)}` };
  }

  let infoJson: { id?: string; title?: string; duration?: number };
  try {
    infoJson = JSON.parse(infoRes.stdout) as typeof infoJson;
  } catch {
    return { error: "yt-dlp returned invalid JSON" };
  }

  const videoId = infoJson.id;
  if (!videoId) return { error: "could_not_extract_video_id" };

  const dir = join(CACHE_ROOT, videoId);
  await mkdir(dir, { recursive: true });

  const rawPath = join(dir, "raw.mp4");
  const brandedPath = join(dir, "branded.mp4");

  // Step 2: download raw video (cached).
  if (!(await fileExists(rawPath))) {
    const dlRes = await run("yt-dlp", [
      "--no-playlist",
      "-f", "mp4/best[ext=mp4]/best",
      "--merge-output-format", "mp4",
      "-o", rawPath,
      rawUrl,
    ]);
    if (dlRes.code !== 0 || !(await fileExists(rawPath))) {
      return { error: `yt-dlp download failed: ${dlRes.stderr.slice(0, 300)}` };
    }
  }

  // Step 3: apply brand treatment (cached).
  if (!(await fileExists(brandedPath))) {
    const brand = brandAssetPaths(join(process.cwd(), "public"));
    const duration = infoJson.duration ?? 9999;
    const args = buildTreatmentArgs({
      source: rawPath,
      output: brandedPath,
      orientation: "full-bleed",
      clipStart: 0,
      clipDuration: duration,
      watermarkPath: brand.watermark,
      vernavleTtf: brand.vernavleTtf,
      fontsDir: brand.fontsDir,
    });
    const ffRes = await runFfmpeg(args);
    if (ffRes.code !== 0 || !(await fileExists(brandedPath))) {
      return { error: `ffmpeg failed: ${ffRes.stderr.slice(-300)}` };
    }
  }

  return {
    videoId,
    title: infoJson.title ?? videoId,
    filename: `tiktok-${videoId}.mp4`,
  };
}

export function tiktokCacheDir(videoId: string): string {
  return join(CACHE_ROOT, videoId);
}
