import { promises as fs } from "node:fs";
import path from "node:path";
import {
  DEFAULT_CONFIG,
  type PlanStep,
  type ReelSafeConfig,
  type ReelSafeJobStatus,
  type ReelSafeResult,
  type RenderPlan,
  type SilenceSpan,
  type TimeRange,
} from "./reelsafe-types";
import {
  REELSAFE_FILES,
  brollPath,
  ensureJobDir,
  ensureOutputs,
  fileExists,
  jobPath,
  outputsRoot,
} from "./media-workspace";
import { extractStderrSummary, runCommand } from "./media-tools";

// In-memory dedupe: if the same jobId is submitted twice we return the running
// promise instead of relaunching. Dies with the dev server; fine locally.
const activeJobs = new Map<string, Promise<ReelSafeResult>>();

export async function writeStatus(jobId: string, status: ReelSafeJobStatus): Promise<void> {
  await fs.writeFile(jobPath(jobId, REELSAFE_FILES.status), JSON.stringify(status), "utf8");
}

export async function readStatus(jobId: string): Promise<ReelSafeJobStatus | null> {
  try {
    const raw = await fs.readFile(jobPath(jobId, REELSAFE_FILES.status), "utf8");
    return JSON.parse(raw) as ReelSafeJobStatus;
  } catch {
    return null;
  }
}

export function getActiveJob(jobId: string): Promise<ReelSafeResult> | undefined {
  return activeJobs.get(jobId);
}

export function startReelSafe(
  jobId: string,
  brollCount: number,
  config: ReelSafeConfig = DEFAULT_CONFIG,
): Promise<ReelSafeResult> {
  const existing = activeJobs.get(jobId);
  if (existing) return existing;
  const p = runPipeline(jobId, brollCount, config).finally(() => {
    activeJobs.delete(jobId);
  });
  activeJobs.set(jobId, p);
  return p;
}

async function runPipeline(
  jobId: string,
  brollCount: number,
  config: ReelSafeConfig,
): Promise<ReelSafeResult> {
  await ensureJobDir(jobId);
  await writeStatus(jobId, { state: "queued", progress: 0 });

  try {
    // 1. Probe main source
    await writeStatus(jobId, { state: "probing", progress: 0.02, note: "Reading video…" });
    const sourcePath = jobPath(jobId, REELSAFE_FILES.source);
    const probe = await ffprobe(sourcePath);
    if (probe.duration <= 0) throw new Error("Source video has no duration.");

    // 2. Detect silences (skip if no audio)
    let silences: SilenceSpan[] = [];
    if (probe.hasAudio) {
      await writeStatus(jobId, {
        state: "detecting",
        progress: 0.1,
        note: "Detecting dead air…",
      });
      silences = await detectSilences(sourcePath, config);
    }

    // 3. Build plan
    await writeStatus(jobId, { state: "planning", progress: 0.2, note: "Planning cuts…" });
    const plan = buildPlan(probe.duration, silences, brollCount, config);
    await fs.writeFile(jobPath(jobId, REELSAFE_FILES.plan), JSON.stringify(plan, null, 2), "utf8");

    // 4. Normalize each b-roll to matching codec/size (parallel-safe but we do
    //    it sequentially so progress is legible)
    const usedBrollIndices = new Set(
      plan.steps.filter((s) => s.kind === "broll").map((s) => (s as { index: number }).index),
    );
    let brollDone = 0;
    for (const idx of usedBrollIndices) {
      const rawPath = jobPath(jobId, `broll-${idx.toString().padStart(2, "0")}-raw.mp4`);
      const normPath = brollPath(jobId, idx);
      await normalizeBroll(rawPath, normPath, config);
      brollDone += 1;
      const pct = 0.2 + (0.15 * brollDone) / Math.max(1, usedBrollIndices.size);
      await writeStatus(jobId, {
        state: "rendering",
        progress: pct,
        note: `Normalizing b-roll ${brollDone}/${usedBrollIndices.size}…`,
      });
    }

    // 5. Render final MP4
    await writeStatus(jobId, {
      state: "rendering",
      progress: 0.35,
      note: "Encoding reel…",
    });
    await ensureOutputs();
    const finalPath = jobPath(jobId, REELSAFE_FILES.output);
    await renderFinal({
      jobId,
      sourcePath,
      plan,
      brollIndices: [...usedBrollIndices].sort((a, b) => a - b),
      hasAudio: probe.hasAudio,
      config,
      onProgress: async (pct) => {
        // Map ffmpeg progress into 0.35 → 0.95 band.
        const p = 0.35 + Math.min(1, Math.max(0, pct)) * 0.6;
        await writeStatus(jobId, {
          state: "rendering",
          progress: p,
          note: "Encoding reel…",
        });
      },
    });

    // Copy into /outputs with a friendly name so it's easy to find on disk.
    const outputsDir = outputsRoot();
    const friendly = path.join(outputsDir, `reel-safe-${jobId}.mp4`);
    try {
      await fs.copyFile(finalPath, friendly);
    } catch {
      // non-fatal; the file exists in the job dir either way
    }

    const finalProbe = await ffprobe(finalPath);
    const result: ReelSafeResult = {
      jobId,
      outputUrl: `/api/reel-safe/file?jobId=${encodeURIComponent(jobId)}`,
      duration: finalProbe.duration,
      brollUsed: usedBrollIndices.size,
      silencesTrimmed: silences.length,
    };
    await writeStatus(jobId, { state: "done", progress: 1, result });
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await writeStatus(jobId, { state: "error", progress: 0, error: msg });
    throw err;
  }
}

// ---------- probing ----------

type Probed = { duration: number; hasAudio: boolean; width: number; height: number };

async function ffprobe(filePath: string): Promise<Probed> {
  const { code, stdout, stderr } = await runCommand("ffprobe", [
    "-v",
    "quiet",
    "-print_format",
    "json",
    "-show_streams",
    "-show_format",
    filePath,
  ]);
  if (code !== 0) throw new Error(`ffprobe failed: ${extractStderrSummary(stderr)}`);
  let parsed: {
    streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
    format?: { duration?: string };
  };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("ffprobe returned invalid JSON.");
  }
  const streams = parsed.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  const hasAudio = streams.some((s) => s.codec_type === "audio");
  return {
    duration: Number(parsed.format?.duration ?? 0) || 0,
    hasAudio,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
  };
}

// ---------- silence detection ----------

async function detectSilences(
  sourcePath: string,
  config: ReelSafeConfig,
): Promise<SilenceSpan[]> {
  // silencedetect prints markers on stderr:
  //   [silencedetect @ 0x...] silence_start: 12.345
  //   [silencedetect @ 0x...] silence_end: 13.567 | silence_duration: 1.222
  const args = [
    "-hide_banner",
    "-nostats",
    "-i",
    sourcePath,
    "-af",
    `silencedetect=noise=${config.silenceNoiseDb}dB:d=${config.silenceMinSec}`,
    "-f",
    "null",
    "-",
  ];
  const { code, stderr } = await runCommand("ffmpeg", args, { timeoutMs: 10 * 60_000 });
  if (code !== 0) throw new Error(`silencedetect failed: ${extractStderrSummary(stderr)}`);

  const spans: SilenceSpan[] = [];
  let pendingStart: number | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const startMatch = line.match(/silence_start:\s*(-?\d+(?:\.\d+)?)/);
    if (startMatch) {
      pendingStart = Math.max(0, Number(startMatch[1]));
      continue;
    }
    const endMatch = line.match(/silence_end:\s*(-?\d+(?:\.\d+)?)/);
    if (endMatch && pendingStart != null) {
      const end = Number(endMatch[1]);
      if (end > pendingStart) spans.push({ start: pendingStart, end });
      pendingStart = null;
    }
  }
  return spans;
}

// ---------- planning ----------

export function buildPlan(
  duration: number,
  silences: SilenceSpan[],
  brollCount: number,
  config: ReelSafeConfig,
): RenderPlan {
  // Compute speech chunks = duration minus silences (any silence, not just
  // long ones — we always trim dead air).
  const speech: TimeRange[] = [];
  let cursor = 0;
  for (const s of [...silences].sort((a, b) => a.start - b.start)) {
    const start = Math.max(cursor, 0);
    const end = Math.min(s.start, duration);
    if (end - start > 0.05) speech.push({ start, end });
    cursor = Math.max(cursor, s.end);
  }
  if (duration - cursor > 0.05) speech.push({ start: cursor, end: duration });
  if (speech.length === 0) {
    // Whole clip was silence (or no audio) — keep it all.
    speech.push({ start: 0, end: duration });
  }

  // Interleave b-roll between speech chunks. Insert up to brollCount clips,
  // spread evenly across the gaps between speech.
  const steps: PlanStep[] = [];
  const gapCount = Math.max(0, speech.length - 1);
  const inserts = Math.min(brollCount, gapCount);
  const stride = inserts > 0 ? gapCount / inserts : 0;
  let nextInsertGap = 0;
  let brollIdx = 0;
  for (let i = 0; i < speech.length; i += 1) {
    steps.push({ kind: "speech", source: "main", range: speech[i] });
    if (i < gapCount && brollIdx < inserts && i >= Math.floor(nextInsertGap)) {
      steps.push({ kind: "broll", source: "broll", index: brollIdx });
      brollIdx += 1;
      nextInsertGap += stride;
    }
  }

  const speechDur = speech.reduce((sum, r) => sum + (r.end - r.start), 0);
  // We don't know exact broll durations at plan time; assume 3s each as a
  // rough estimate. The final probe corrects this.
  const rawDuration = speechDur + inserts * 3;
  const finalDuration = rawDuration / Math.max(0.01, config.speed);
  return { steps, rawDuration, finalDuration };
}

// ---------- b-roll normalization ----------

async function normalizeBroll(
  srcPath: string,
  outPath: string,
  config: ReelSafeConfig,
): Promise<void> {
  const probe = await ffprobe(srcPath);
  const w = config.outWidth;
  const h = config.outHeight;
  const vf =
    `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=30`;

  const args: string[] = ["-y", "-i", srcPath];
  if (!probe.hasAudio) {
    // Add a silent stereo track so downstream concat has matching streams.
    args.push("-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-shortest");
  }
  args.push(
    "-vf",
    vf,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ar",
    "44100",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    outPath,
  );
  const { code, stderr } = await runCommand("ffmpeg", args, { timeoutMs: 10 * 60_000 });
  if (code !== 0) {
    throw new Error(`b-roll normalize failed: ${extractStderrSummary(stderr)}`);
  }
}

// ---------- final render ----------

type RenderArgs = {
  jobId: string;
  sourcePath: string;
  plan: RenderPlan;
  brollIndices: number[];
  hasAudio: boolean;
  config: ReelSafeConfig;
  onProgress: (pct: number) => Promise<void>;
};

async function renderFinal(args: RenderArgs): Promise<void> {
  const { jobId, sourcePath, plan, brollIndices, hasAudio, config } = args;
  const wmPath = jobPath(jobId, REELSAFE_FILES.watermark);
  const wmExists = await fileExists(wmPath);
  const outPath = jobPath(jobId, REELSAFE_FILES.output);

  // Assign input indices: 0 = source, 1..K = brolls (in brollIndices order),
  // K+1 = watermark (if present).
  const brollInputIdx = new Map<number, number>();
  brollIndices.forEach((broll, i) => brollInputIdx.set(broll, 1 + i));
  const wmInputIdx = wmExists ? 1 + brollIndices.length : -1;

  const inputs: string[] = ["-i", sourcePath];
  for (const broll of brollIndices) {
    inputs.push("-i", brollPath(jobId, broll));
  }
  if (wmExists) {
    inputs.push("-loop", "1", "-i", wmPath);
  }

  const w = config.outWidth;
  const h = config.outHeight;
  const scaleCrop =
    `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=30`;

  // Build filter graph. Each step produces a [vN] and (if hasAudio) [aN] label.
  const chains: string[] = [];
  const labelPairs: string[] = [];
  let speechCount = 0;
  plan.steps.forEach((step, i) => {
    if (step.kind === "speech") {
      const { start, end } = step.range;
      const vLbl = `sv${i}`;
      chains.push(
        `[0:v]trim=start=${start.toFixed(3)}:end=${end.toFixed(3)},setpts=PTS-STARTPTS,${scaleCrop}[${vLbl}]`,
      );
      if (hasAudio) {
        const aLbl = `sa${i}`;
        chains.push(
          `[0:a]atrim=start=${start.toFixed(3)}:end=${end.toFixed(3)},asetpts=PTS-STARTPTS,aresample=44100[${aLbl}]`,
        );
        labelPairs.push(`[${vLbl}][${aLbl}]`);
      } else {
        labelPairs.push(`[${vLbl}]`);
      }
      speechCount += 1;
    } else {
      const inIdx = brollInputIdx.get(step.index);
      if (inIdx == null) return;
      const vLbl = `bv${i}`;
      chains.push(`[${inIdx}:v]${scaleCrop}[${vLbl}]`);
      if (hasAudio) {
        const aLbl = `ba${i}`;
        chains.push(`[${inIdx}:a]aresample=44100[${aLbl}]`);
        labelPairs.push(`[${vLbl}][${aLbl}]`);
      } else {
        labelPairs.push(`[${vLbl}]`);
      }
    }
  });

  const n = labelPairs.length;
  const concatSpec = hasAudio ? `concat=n=${n}:v=1:a=1[cv][ca]` : `concat=n=${n}:v=1:a=0[cv]`;
  chains.push(labelPairs.join("") + concatSpec);

  // Pacing speedup
  chains.push(`[cv]setpts=PTS/${config.speed}[sv]`);
  let finalVLabel = "sv";
  let finalALabel = "";
  if (hasAudio) {
    chains.push(`[ca]atempo=${config.speed}[sa]`);
    finalALabel = "sa";
  }

  // Watermark overlay (with jitter). Position in the chosen corner.
  if (wmExists && wmInputIdx >= 0) {
    const jitter = config.watermarkJitterPx;
    // Ranges: pad from edge is 24..24+jitter. Use fixed since ffmpeg overlay
    // expressions can't easily reference Math.random() — we compute JS-side.
    const jx = Math.floor(Math.random() * jitter);
    const jy = Math.floor(Math.random() * jitter);
    const pad = 24;
    let expr = "";
    switch (config.watermarkCorner) {
      case "top-left":
        expr = `${pad + jx}:${pad + jy}`;
        break;
      case "bottom-left":
        expr = `${pad + jx}:H-h-${pad + jy}`;
        break;
      case "bottom-right":
        expr = `W-w-${pad + jx}:H-h-${pad + jy}`;
        break;
      case "top-right":
      default:
        expr = `W-w-${pad + jx}:${pad + jy}`;
        break;
    }
    // Scale watermark to a sane width (12% of frame width) before overlay.
    const wmScaledLabel = "wm";
    chains.push(`[${wmInputIdx}:v]scale=${Math.floor(w * 0.12)}:-1[${wmScaledLabel}]`);
    chains.push(`[${finalVLabel}][${wmScaledLabel}]overlay=${expr}:shortest=1[out]`);
    finalVLabel = "out";
  }

  const filterComplex = chains.join(";");
  const mapArgs: string[] = ["-map", `[${finalVLabel}]`];
  if (hasAudio) mapArgs.push("-map", `[${finalALabel}]`);

  const encodeArgs = [
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "22",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
  ];
  if (hasAudio) {
    encodeArgs.push("-c:a", "aac", "-b:a", "128k");
  }

  const ffmpegArgs = [
    "-y",
    "-hide_banner",
    "-nostats",
    "-progress",
    "pipe:2",
    ...inputs,
    "-filter_complex",
    filterComplex,
    ...mapArgs,
    ...encodeArgs,
    outPath,
  ];

  const totalMs = plan.finalDuration * 1000;
  const { code, stderr } = await runCommand("ffmpeg", ffmpegArgs, {
    timeoutMs: 30 * 60_000,
    onStderr: (chunk) => {
      // ffmpeg -progress prints `out_time_ms=12345678` lines to the same pipe
      // we're pointed at (stderr). Parse the last one seen per chunk.
      const m = [...chunk.matchAll(/out_time_ms=(\d+)/g)].pop();
      if (m && totalMs > 0) {
        const doneMs = Number(m[1]) / 1000;
        void args.onProgress(doneMs / totalMs);
      }
    },
  });
  if (code !== 0) {
    // Persist filter graph on failure so debugging is easy.
    await fs
      .writeFile(jobPath(jobId, "filter_complex.txt"), filterComplex, "utf8")
      .catch(() => {});
    throw new Error(`ffmpeg render failed: ${extractStderrSummary(stderr)}`);
  }
  // Suppress unused warning
  void speechCount;
}
