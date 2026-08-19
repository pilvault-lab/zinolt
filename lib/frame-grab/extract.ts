import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readdir, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { fetchYouTube } from "@/lib/clip-studio/youtube";

export type FrameMode = "full-bleed" | "letterboxed";

export type WindowSpec = { startSec: number; count: number };
export type ClipOut = { src: string; sec: number; durationSec: number; sizeBytes: number };

export type FrameGrabResult = {
  sourceId: string;
  title: string;
  channel: string;
  durationSec: number;
  intervalSec: number;
  clipDurationSec: number;
  mode: FrameMode;
  cropOffsetX: number;
  clips: ClipOut[];
};

type Options = {
  source: string;
  mode: FrameMode;
  cropOffsetX?: number; // 0..1, horizontal position of the 9:16 crop
  intervalSec?: number; // for windows mode
  clipDurationSec?: number; // length of each clip
  windows?: WindowSpec[]; // auto mode
  moments?: number[]; // manual mode
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

export type ResolvedSource = {
  sourceId: string;
  title: string;
  channel: string;
  durationSec: number;
  videoPath: string;
};

export async function resolveSource(source: string): Promise<ResolvedSource | { error: string }> {
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

/** Build the ffmpeg -vf filter for a given mode + crop offset. */
function buildFilter(mode: FrameMode, cropOffsetX: number): string {
  const off = Math.max(0, Math.min(1, cropOffsetX));
  if (mode === "letterboxed") {
    return `scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
  }
  const cropW = `min(iw\\,ih*9/16)`;
  const cropH = `min(ih\\,iw*16/9)`;
  const cropX = `(iw-${cropW})*${off.toFixed(4)}`;
  const cropY = `(ih-${cropH})/2`;
  return `crop=${cropW}:${cropH}:${cropX}:${cropY},scale=1080:1920:flags=lanczos,setsar=1`;
}

export async function extractFrames(opts: Options): Promise<FrameGrabResult | { error: string }> {
  const { source, mode } = opts;
  const cropOffsetX = typeof opts.cropOffsetX === "number" ? opts.cropOffsetX : 0.5;
  const intervalSec = opts.intervalSec ?? 0.5;
  const clipDurationSec = Math.max(0.05, Math.min(10, opts.clipDurationSec ?? 0.5));

  const isManual = Array.isArray(opts.moments) && opts.moments.length > 0;
  const isAuto = Array.isArray(opts.windows) && opts.windows.length > 0;
  if (!isManual && !isAuto) return { error: "no_moments_or_windows" };

  // Expand into a flat list of clip start timestamps.
  const starts: number[] = [];
  if (isManual) {
    for (const m of opts.moments!) {
      if (!(m >= 0) || !isFinite(m)) return { error: "invalid_moment" };
      starts.push(m);
    }
  } else {
    if (intervalSec <= 0) return { error: "invalid_interval" };
    for (const w of opts.windows!) {
      if (!(w.count > 0) || !(w.startSec >= 0)) return { error: "invalid_window" };
      for (let i = 0; i < w.count; i++) starts.push(w.startSec + i * intervalSec);
    }
  }
  if (starts.length > 200) return { error: "too_many_clips" };

  const resolved = await resolveSource(source);
  if ("error" in resolved) return resolved;

  const outDir = join(process.cwd(), "public", "frame-grab", resolved.sourceId);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const filter = buildFilter(mode, cropOffsetX);
  const clips: ClipOut[] = [];

  for (let i = 0; i < starts.length; i++) {
    const t = starts[i];
    const name = `c${String(i + 1).padStart(3, "0")}_${Math.round(t * 1000)}ms.mp4`;
    const outPath = join(outDir, name);
    // Fast seek before -i, re-encode with x264, drop audio.
    // -pix_fmt yuv420p + -movflags +faststart = plays in any browser/editor.
    const args = [
      "-y",
      "-ss", String(t),
      "-i", resolved.videoPath,
      "-t", String(clipDurationSec),
      "-vf", filter,
      "-an",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "20",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      outPath,
    ];
    const res = await run("ffmpeg", args);
    if (res.code !== 0) {
      return { error: `ffmpeg failed (clip ${i + 1} at ${t}s): ${res.stderr.slice(-400)}` };
    }
    let sizeBytes = 0;
    try {
      const s = await stat(outPath);
      sizeBytes = s.size;
    } catch {
      /* ignore */
    }
    clips.push({
      src: `/frame-grab/${resolved.sourceId}/${name}`,
      sec: t,
      durationSec: clipDurationSec,
      sizeBytes,
    });
  }

  if (clips.length === 0) return { error: "no_clips_extracted" };
  void readdir; // keep import used if we add cleanup later

  return {
    sourceId: resolved.sourceId,
    title: resolved.title,
    channel: resolved.channel,
    durationSec: resolved.durationSec,
    intervalSec,
    clipDurationSec,
    mode,
    cropOffsetX,
    clips,
  };
}
