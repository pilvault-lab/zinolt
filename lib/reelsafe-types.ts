// Shared types for the reel-safe pipeline (submit → silence-detect → plan → render).

/** A [start, end) time range on some source video, in seconds. */
export type TimeRange = { start: number; end: number };

/** A raw silence span reported by ffmpeg's silencedetect filter. */
export type SilenceSpan = TimeRange;

/** One step in the concat plan: either a trimmed slice of the source video,
 *  or a whole b-roll clip inserted between speech chunks. */
export type PlanStep =
  | { kind: "speech"; source: "main"; range: TimeRange }
  | { kind: "broll"; source: "broll"; index: number };

export type RenderPlan = {
  steps: PlanStep[];
  /** Sum of step durations before pacing speedup, in seconds. */
  rawDuration: number;
  /** Expected final duration after atempo, in seconds. */
  finalDuration: number;
};

export type WatermarkCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export type ReelSafeConfig = {
  /** Playback speedup applied to both video (setpts) and audio (atempo). */
  speed: number;
  /** dB threshold below which a stretch counts as silence. */
  silenceNoiseDb: number;
  /** Minimum silence duration (seconds) before it's a trim/insert candidate. */
  silenceMinSec: number;
  /** Silences longer than this are candidates for b-roll insertion. */
  silenceInsertMinSec: number;
  /** Which corner the watermark sits in. */
  watermarkCorner: WatermarkCorner;
  /** Random pixel jitter applied to the watermark position, per-render. */
  watermarkJitterPx: number;
  /** Output canvas dimensions. */
  outWidth: number;
  outHeight: number;
};

export const DEFAULT_CONFIG: ReelSafeConfig = {
  speed: 1.05,
  silenceNoiseDb: -30,
  silenceMinSec: 0.6,
  silenceInsertMinSec: 1.5,
  watermarkCorner: "top-right",
  watermarkJitterPx: 20,
  outWidth: 1080,
  outHeight: 1920,
};

export type ReelSafeJobStatus =
  | { state: "queued"; progress: 0 }
  | { state: "probing"; progress: number; note?: string }
  | { state: "detecting"; progress: number; note?: string }
  | { state: "planning"; progress: number; note?: string }
  | { state: "rendering"; progress: number; note?: string }
  | { state: "done"; progress: 1; result: ReelSafeResult }
  | { state: "error"; progress: number; error: string };

export type ReelSafeResult = {
  jobId: string;
  /** Public Vercel Blob URL of the finished MP4. */
  outputUrl: string;
  /** Final MP4 duration, seconds. */
  duration: number;
  /** How many b-roll clips were spliced in. */
  brollUsed: number;
  /** How many silence spans were trimmed. */
  silencesTrimmed: number;
};
