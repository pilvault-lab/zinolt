import { spawn } from "node:child_process";
import { readFile, mkdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";

/**
 * yt-dlp wrapper. All shell-outs to yt-dlp live here so the day the
 * binary interface shifts, one file needs to change.
 */

const CACHE_ROOT = join(process.cwd(), ".clip-studio-cache");

export type CaptionSegment = {
  start: number;
  end: number;
  text: string;
};

export type HeatmapBucket = {
  /** Bucket start time (seconds). */
  start: number;
  /** Bucket end time (seconds). */
  end: number;
  /** 0..1 normalized "replay intensity". */
  value: number;
};

export type FetchedVideo = {
  videoId: string;
  title: string;
  channel: string;
  durationSec: number;
  videoPath: string;
  transcript: CaptionSegment[];
  heatmap: HeatmapBucket[];
  captionsAvailable: boolean;
};

function ytIdFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1) || null;
    if (u.hostname.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return v;
      const short = u.pathname.match(/\/shorts\/([\w-]+)/);
      if (short) return short[1];
    }
  } catch {
    /* fallthrough */
  }
  return null;
}

function run(cmd: string, args: string[], cwd?: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, windowsHide: true });
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

/** Parse YouTube's JSON3 subtitle format into caption segments. */
function parseJson3(json: unknown): CaptionSegment[] {
  const j = json as { events?: Array<{ tStartMs?: number; dDurationMs?: number; segs?: Array<{ utf8?: string }> }> };
  const events = j.events ?? [];
  const out: CaptionSegment[] = [];
  for (const e of events) {
    const startMs = e.tStartMs;
    const durMs = e.dDurationMs;
    if (typeof startMs !== "number" || typeof durMs !== "number") continue;
    const text = (e.segs ?? [])
      .map((s) => s.utf8 ?? "")
      .join("")
      .replace(/\n+/g, " ")
      .trim();
    if (!text) continue;
    out.push({ start: startMs / 1000, end: (startMs + durMs) / 1000, text });
  }
  return out;
}

function parseHeatmap(raw: unknown): HeatmapBucket[] {
  if (!Array.isArray(raw)) return [];
  const out: HeatmapBucket[] = [];
  for (const b of raw as Array<{ start_time?: number; end_time?: number; value?: number }>) {
    if (typeof b.start_time === "number" && typeof b.end_time === "number" && typeof b.value === "number") {
      out.push({ start: b.start_time, end: b.end_time, value: b.value });
    }
  }
  return out;
}

/**
 * Fetch or reuse cached copy of a YouTube video, its auto-captions, and
 * the "most replayed" heatmap. Everything lives under
 * .clip-studio-cache/{videoId}/.
 */
export async function fetchYouTube(rawUrl: string): Promise<FetchedVideo | { error: string }> {
  const videoId = ytIdFromUrl(rawUrl);
  if (!videoId) return { error: "invalid_url" };
  const dir = join(CACHE_ROOT, videoId);
  await mkdir(dir, { recursive: true });

  const videoPath = join(dir, "video.mp4");
  const infoPath = join(dir, "info.json");
  const captionPath = join(dir, "captions.en.json3");

  // (1) info JSON — `-J` implies short-circuit so it MUST be its own call.
  if (!(await fileExists(infoPath))) {
    const infoRes = await run("yt-dlp", ["-J", "--skip-download", rawUrl], dir);
    if (infoRes.code !== 0) {
      return { error: `yt-dlp info failed: ${infoRes.stderr.slice(0, 200)}` };
    }
    await writeFile(infoPath, infoRes.stdout, "utf8");
  }

  // (2) auto-captions — separate call because -J skips this step.
  // Skip if we already have any json3 file for this videoId.
  const captionSearchPaths = [
    captionPath,
    join(dir, `${videoId}.en.json3`),
    join(dir, `${videoId}.en-orig.json3`),
  ];
  let haveCaption = false;
  for (const p of captionSearchPaths) {
    if (await fileExists(p)) {
      haveCaption = true;
      break;
    }
  }
  if (!haveCaption) {
    // Note: `--write-auto-sub` covers YouTube-generated captions, but many
    // creator-uploaded talks/podcasts only expose `--write-sub`. Ask for both.
    await run("yt-dlp", [
      "--write-auto-sub",
      "--write-sub",
      "--sub-lang", "en.*,en",
      "--sub-format", "json3/best",
      "--skip-download",
      "-o", "%(id)s",
      rawUrl,
    ], dir);
    // Subs failing is not fatal — video might have none.
  }

  const infoJson = JSON.parse(await readFile(infoPath, "utf8")) as {
    id?: string;
    title?: string;
    channel?: string;
    uploader?: string;
    duration?: number;
    heatmap?: unknown;
  };

  // Some videos land the subtitle file at different names — locate it.
  let transcript: CaptionSegment[] = [];
  const captionCandidates = [
    captionPath,
    join(dir, `${videoId}.en.json3`),
    join(dir, `${videoId}.en-orig.json3`),
    join(dir, `${videoId}.en.en.json3`),
  ];
  for (const p of captionCandidates) {
    if (await fileExists(p)) {
      try {
        const parsed = JSON.parse(await readFile(p, "utf8"));
        transcript = parseJson3(parsed);
        if (transcript.length > 0) break;
      } catch {
        /* try next */
      }
    }
  }

  const heatmap = parseHeatmap(infoJson.heatmap);

  // Download the actual video (only if missing).
  if (!(await fileExists(videoPath))) {
    const dlRes = await run("yt-dlp", [
      "-f", "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/b[height<=1080]",
      "--merge-output-format", "mp4",
      "-o", videoPath,
      rawUrl,
    ]);
    if (dlRes.code !== 0 || !(await fileExists(videoPath))) {
      return { error: `yt-dlp download failed: ${dlRes.stderr.slice(0, 300)}` };
    }
  }

  return {
    videoId,
    title: infoJson.title ?? videoId,
    channel: infoJson.channel ?? infoJson.uploader ?? "",
    durationSec: infoJson.duration ?? 0,
    videoPath,
    transcript,
    heatmap,
    captionsAvailable: transcript.length > 0,
  };
}

export function clipCacheDir(videoId: string): string {
  return join(CACHE_ROOT, videoId);
}
