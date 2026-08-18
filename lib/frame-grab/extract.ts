import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { fetchYouTube } from "@/lib/clip-studio/youtube";

export type FrameMode = "full-bleed" | "letterboxed";

export type WindowSpec = { startSec: number; count: number };
export type FrameOut = { src: string; sec: number };

export type FrameGrabResult = {
  sourceId: string;
  title: string;
  channel: string;
  durationSec: number;
  intervalSec: number;
  mode: FrameMode;
  cropOffsetX: number;
  frames: FrameOut[];
};

type Options = {
  source: string;
  mode: FrameMode;
  cropOffsetX?: number; // 0..1, horizontal position of the 9:16 crop. 0.5 = center.
  intervalSec?: number; // used for windows
  windows?: WindowSpec[]; // auto mode
  moments?: number[]; // manual mode — one frame per timestamp (seconds)
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
function buildFilter(mode: FrameMode, cropOffsetX: number, fps: number): string {
  const off = Math.max(0, Math.min(1, cropOffsetX));
  if (mode === "letterboxed") {
    return `fps=${fps},scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black`;
  }
  // Full-bleed: crop 9:16 window from source, horizontal position controlled by `off`.
  // For a 16:9 source, the crop is a vertical stripe; `(iw - crop_w) * off` positions it.
  const cropW = `min(iw\\,ih*9/16)`;
  const cropH = `min(ih\\,iw*16/9)`;
  const cropX = `(iw-${cropW})*${off.toFixed(4)}`;
  const cropY = `(ih-${cropH})/2`;
  return `fps=${fps},crop=${cropW}:${cropH}:${cropX}:${cropY},scale=1080:1920:flags=lanczos`;
}

export async function extractFrames(opts: Options): Promise<FrameGrabResult | { error: string }> {
  const { source, mode } = opts;
  const cropOffsetX = typeof opts.cropOffsetX === "number" ? opts.cropOffsetX : 0.5;
  const intervalSec = opts.intervalSec ?? 0.5;

  const isManual = Array.isArray(opts.moments) && opts.moments.length > 0;
  const isAuto = Array.isArray(opts.windows) && opts.windows.length > 0;
  if (!isManual && !isAuto) return { error: "no_moments_or_windows" };

  if (isAuto) {
    if (intervalSec <= 0) return { error: "invalid_interval" };
    for (const w of opts.windows!) {
      if (!(w.count > 0) || !(w.startSec >= 0)) return { error: "invalid_window" };
    }
  }
  if (isManual) {
    for (const m of opts.moments!) {
      if (!(m >= 0) || !isFinite(m)) return { error: "invalid_moment" };
    }
    if (opts.moments!.length > 600) return { error: "too_many_moments" };
  }

  const resolved = await resolveSource(source);
  if ("error" in resolved) return resolved;

  const outDir = join(process.cwd(), "public", "frame-grab", resolved.sourceId);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const frames: FrameOut[] = [];

  if (isManual) {
    const filter = buildFilter(mode, cropOffsetX, 30); // fps irrelevant for -frames:v 1 with -ss
    const moments = opts.moments!;
    for (let i = 0; i < moments.length; i++) {
      const t = moments[i];
      const name = `m${String(i + 1).padStart(3, "0")}_${Math.round(t * 1000)}.jpg`;
      const args = [
        "-y",
        "-ss", String(t),
        "-i", resolved.videoPath,
        "-vf", filter,
        "-frames:v", "1",
        "-q:v", "2",
        join(outDir, name),
      ];
      const res = await run("ffmpeg", args);
      if (res.code !== 0) {
        return { error: `ffmpeg failed (moment ${i + 1} at ${t}s): ${res.stderr.slice(-400)}` };
      }
      frames.push({ src: `/frame-grab/${resolved.sourceId}/${name}`, sec: t });
    }
  } else {
    // Auto: one ffmpeg per window, collect files in disk order.
    for (let wi = 0; wi < opts.windows!.length; wi++) {
      const w = opts.windows![wi];
      const duration = intervalSec * w.count + 0.5;
      const prefix = `w${String(wi + 1).padStart(2, "0")}`;
      const filter = buildFilter(mode, cropOffsetX, 1 / intervalSec);
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
        return { error: `ffmpeg failed (window ${wi + 1}): ${res.stderr.slice(-400)}` };
      }
      const files = (await readdir(outDir))
        .filter((f) => f.startsWith(`${prefix}_frame_`) && f.endsWith(".jpg"))
        .sort();
      files.forEach((f, i) => {
        frames.push({
          src: `/frame-grab/${resolved.sourceId}/${f}`,
          sec: w.startSec + i * intervalSec,
        });
      });
    }
  }

  if (frames.length === 0) return { error: "no_frames_extracted" };

  return {
    sourceId: resolved.sourceId,
    title: resolved.title,
    channel: resolved.channel,
    durationSec: resolved.durationSec,
    intervalSec,
    mode,
    cropOffsetX,
    frames,
  };
}
