import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { fetchYouTube } from "@/lib/clip-studio/youtube";

export type FrameMode = "full-bleed" | "letterboxed";

export type WindowSpec = {
  startSec: number;
  count: number;
};

export type WindowResult = {
  startSec: number;
  count: number;
  frames: string[];
};

export type FrameGrabResult = {
  sourceId: string;
  title: string;
  channel: string;
  durationSec: number;
  intervalSec: number;
  mode: FrameMode;
  windows: WindowResult[];
};

type Options = {
  source: string; // YouTube URL OR absolute local file path
  windows: WindowSpec[];
  intervalSec: number;
  mode: FrameMode;
};

function run(cmd: string, args: string[]): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let stderr = "";
    p.stderr.on("data", (c) => (stderr += c.toString()));
    p.on("error", reject);
    p.on("close", (code) => resolve({ code, stderr }));
  });
}

function isUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

function localSourceId(path: string): string {
  const name = basename(path).replace(/[^\w.-]+/g, "_").slice(0, 40);
  const hash = createHash("sha1").update(path).digest("hex").slice(0, 8);
  return `local-${name}-${hash}`;
}

type ResolvedSource = {
  sourceId: string;
  title: string;
  channel: string;
  durationSec: number;
  videoPath: string;
};

async function resolveSource(source: string): Promise<ResolvedSource | { error: string }> {
  const s = source.trim();
  if (!s) return { error: "missing_source" };

  if (isUrl(s)) {
    const yt = await fetchYouTube(s);
    if ("error" in yt) return yt;
    return {
      sourceId: yt.videoId,
      title: yt.title,
      channel: yt.channel,
      durationSec: yt.durationSec,
      videoPath: yt.videoPath,
    };
  }

  // Local path
  try {
    await access(s);
  } catch {
    return { error: `local_file_not_found: ${s}` };
  }
  return {
    sourceId: localSourceId(s),
    title: basename(s),
    channel: "local",
    durationSec: 0,
    videoPath: s,
  };
}

function buildFilter(intervalSec: number, mode: FrameMode): string {
  const fps = 1 / intervalSec;
  if (mode === "letterboxed") {
    // Fit whole frame into 1080x1920, black bars top/bottom (or sides).
    return `fps=${fps},scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black`;
  }
  // Center-crop to 9:16, then scale.
  return `fps=${fps},crop='min(iw\\,ih*9/16)':'min(ih\\,iw*16/9)',scale=1080:1920:flags=lanczos`;
}

export async function extractFrames(opts: Options): Promise<FrameGrabResult | { error: string }> {
  const { source, intervalSec, mode, windows } = opts;
  if (intervalSec <= 0) return { error: "invalid_interval" };
  if (!Array.isArray(windows) || windows.length === 0) return { error: "no_windows" };
  const totalCount = windows.reduce((a, w) => a + w.count, 0);
  if (totalCount <= 0 || totalCount > 600) return { error: "invalid_count" };
  for (const w of windows) {
    if (!(w.count > 0) || !(w.startSec >= 0)) return { error: "invalid_window" };
  }

  const resolved = await resolveSource(source);
  if ("error" in resolved) return resolved;

  const outDir = join(process.cwd(), "public", "frame-grab", resolved.sourceId);
  // Wipe previous run for this source (filenames repeat).
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const filter = buildFilter(intervalSec, mode);
  const windowResults: WindowResult[] = [];

  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];
    const duration = intervalSec * w.count + 0.5;
    const prefix = `w${String(i + 1).padStart(2, "0")}`;

    const args = [
      "-y",
      "-ss", String(w.startSec),
      "-i", resolved.videoPath,
      "-t", String(duration),
      "-vf", filter,
      "-frames:v", String(w.count),
      "-q:v", "2",
      join(outDir, `${prefix}_frame_%02d.jpg`),
    ];

    const res = await run("ffmpeg", args);
    if (res.code !== 0) {
      return { error: `ffmpeg failed (window ${i + 1}): ${res.stderr.slice(-400)}` };
    }

    const files = (await readdir(outDir))
      .filter((f) => f.startsWith(`${prefix}_frame_`) && f.endsWith(".jpg"))
      .sort();
    if (files.length === 0) {
      return { error: `no_frames_extracted (window ${i + 1})` };
    }
    windowResults.push({
      startSec: w.startSec,
      count: files.length,
      frames: files.map((f) => `/frame-grab/${resolved.sourceId}/${f}`),
    });
  }

  return {
    sourceId: resolved.sourceId,
    title: resolved.title,
    channel: resolved.channel,
    durationSec: resolved.durationSec,
    intervalSec,
    mode,
    windows: windowResults,
  };
}
