import { spawn } from "node:child_process";
import { mkdir, access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cookieArgs } from "../ytdlp-cookies";
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

/** Extract video ID from a canonical TikTok URL (@user/video/ID). */
function videoIdFromUrl(url: string): string | null {
  const m = url.match(/\/video\/(\d+)/);
  return m ? m[1] : null;
}

export type TikTokResult = {
  videoId: string;
  title: string;
  filename: string;
};

/** Resolve tiktok.com/t/ short links to their canonical @user/video/ URL. */
async function resolveUrl(url: string): Promise<string> {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow" });
    return res.url || url;
  } catch {
    return url;
  }
}

async function readTitle(dir: string, fallback: string): Promise<string> {
  try {
    const info = JSON.parse(await readFile(join(dir, "info.json"), "utf8")) as { title?: string };
    return info.title ?? fallback;
  } catch {
    return fallback;
  }
}

export async function downloadTikTok(
  rawUrl: string,
): Promise<TikTokResult | { error: string }> {
  // Expand short links (tiktok.com/t/XXXXX) before hitting yt-dlp.
  const url = /tiktok\.com\/t\//i.test(rawUrl) ? await resolveUrl(rawUrl) : rawUrl;

  // TikTok photo/slideshow posts have no video — catch early.
  if (/tiktok\.com\/@[^/]+\/photo\//i.test(url)) {
    return { error: "This is a TikTok photo post — only video posts can be downloaded." };
  }

  // Fast path: if we already have the branded output, return immediately —
  // no yt-dlp network call needed.
  const maybeId = videoIdFromUrl(url);
  if (maybeId) {
    const dir = join(CACHE_ROOT, maybeId);
    const brandedPath = join(dir, "branded.mp4");
    if (await fileExists(brandedPath)) {
      return {
        videoId: maybeId,
        title: await readTitle(dir, maybeId),
        filename: `tiktok-${maybeId}.mp4`,
      };
    }
  }

  // Step 1: info JSON — extracts real video ID and duration.
  const infoRes = await run("yt-dlp", [
    "-J", "--no-playlist", ...await cookieArgs(), "--skip-download", url,
  ]);
  if (infoRes.code !== 0) {
    return { error: `yt-dlp info failed: ${infoRes.stderr.slice(0, 200)}` };
  }

  let infoJson: { id?: string; title?: string; duration?: number } | null;
  try {
    infoJson = JSON.parse(infoRes.stdout) as typeof infoJson;
  } catch {
    return { error: "yt-dlp returned invalid JSON" };
  }
  if (!infoJson) return { error: `yt-dlp returned no info: ${infoRes.stderr.slice(0, 200)}` };

  const videoId = infoJson.id;
  if (!videoId) return { error: "could_not_extract_video_id" };

  const dir = join(CACHE_ROOT, videoId);
  await mkdir(dir, { recursive: true });

  // Persist info so we have the title for future fast-path returns.
  await writeFile(join(dir, "info.json"), infoRes.stdout, "utf8");

  const rawPath = join(dir, "raw.mp4");
  const brandedPath = join(dir, "branded.mp4");

  // Step 2: download raw video (cached).
  if (!(await fileExists(rawPath))) {
    const dlRes = await run("yt-dlp", [
      "--no-playlist", ...await cookieArgs(),
      "-f", "mp4/best[ext=mp4]/best",
      "--merge-output-format", "mp4",
      "-o", rawPath, url,
    ]);
    if (dlRes.code !== 0 || !(await fileExists(rawPath))) {
      return { error: `yt-dlp download failed: ${dlRes.stderr.slice(0, 300)}` };
    }
  }

  // Step 3: apply brand treatment (cached).
  if (!(await fileExists(brandedPath))) {
    const brand = brandAssetPaths(join(process.cwd(), "public"));
    const duration = infoJson.duration ?? 9999;
    const ffRes = await runFfmpeg(buildTreatmentArgs({
      source: rawPath, output: brandedPath,
      orientation: "full-bleed", clipStart: 0, clipDuration: duration,
      watermarkPath: brand.watermark, vernavleTtf: brand.vernavleTtf, fontsDir: brand.fontsDir,
    }));
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
