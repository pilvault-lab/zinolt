// Runs inside a Vercel Sandbox microVM. Reads inputs from env vars, downloads
// source/brolls/watermark from Vercel Blob, runs the ffmpeg pipeline, uploads
// the output back to Blob, and writes status blobs throughout so the parent
// Next.js function's GET /api/reel-safe can poll for progress.
//
// Env inputs:
//   BLOB_READ_WRITE_TOKEN — required, passed through from the Next.js function
//   JOB_ID                — required, opaque hex string
//   SOURCE_URL            — required, public blob URL of the main video
//   BROLL_URLS_JSON       — JSON array of public blob URLs (may be empty)
//   WATERMARK_URL         — optional, public blob URL of the PNG (empty string if none)
//   CONFIG_JSON           — JSON-serialized ReelSafeConfig
//
// Node runtime: 24 (matches the sandbox default). No TypeScript, no bundler.

import { spawn } from "node:child_process";
import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { put } from "@vercel/blob";

const JOB_ID = required("JOB_ID");
const SOURCE_URL = required("SOURCE_URL");
const BROLL_URLS = JSON.parse(process.env.BROLL_URLS_JSON || "[]");
const WATERMARK_URL = process.env.WATERMARK_URL || "";
const CONFIG = JSON.parse(required("CONFIG_JSON"));

const WORK_DIR = `/tmp/reel-safe/${JOB_ID}`;

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

// ---------- status writes to Blob ----------

async function writeStatus(state, progress, extra = {}) {
  const body = JSON.stringify({ state, progress, ...extra });
  // `addRandomSuffix: false` + `allowOverwrite: true` keeps the pathname stable
  // so the parent function can always fetch `reel-safe/jobs/{jobId}/status.json`.
  await put(`reel-safe/jobs/${JOB_ID}/status.json`, body, {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
}

// ---------- shell helper ----------

function runCmd(cmd, args, { onStderr, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => {
      const s = c.toString();
      stderr += s;
      if (onStderr) onStderr(s);
    });
    let killed = false;
    const timer = timeoutMs
      ? setTimeout(() => {
          killed = true;
          child.kill("SIGKILL");
        }, timeoutMs)
      : null;
    child.on("error", (e) => {
      if (timer) clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (killed) resolve({ code: 124, stdout, stderr: stderr + "\n[killed: timeout]" });
      else resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

function extractStderrSummary(stderr) {
  const lines = stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const errLine = [...lines].reverse().find((l) => /^(error|invalid|failed)/i.test(l));
  return errLine ?? lines[lines.length - 1] ?? "Unknown error.";
}

// ---------- blob download ----------

async function downloadTo(url, dest) {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Download failed (${res.status}) for ${url}`);
  }
  await pipeline(res.body, createWriteStream(dest));
}

// ---------- ffprobe / silence detect ----------

async function ffprobe(filePath) {
  const { code, stdout, stderr } = await runCmd("ffprobe", [
    "-v", "quiet",
    "-print_format", "json",
    "-show_streams",
    "-show_format",
    filePath,
  ]);
  if (code !== 0) throw new Error(`ffprobe failed: ${extractStderrSummary(stderr)}`);
  const parsed = JSON.parse(stdout);
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

async function detectSilences(sourcePath) {
  const { code, stderr } = await runCmd(
    "ffmpeg",
    [
      "-hide_banner",
      "-nostats",
      "-i", sourcePath,
      "-af", `silencedetect=noise=${CONFIG.silenceNoiseDb}dB:d=${CONFIG.silenceMinSec}`,
      "-f", "null",
      "-",
    ],
    { timeoutMs: 10 * 60_000 },
  );
  if (code !== 0) throw new Error(`silencedetect failed: ${extractStderrSummary(stderr)}`);

  const spans = [];
  let pendingStart = null;
  for (const line of stderr.split(/\r?\n/)) {
    const start = line.match(/silence_start:\s*(-?\d+(?:\.\d+)?)/);
    if (start) {
      pendingStart = Math.max(0, Number(start[1]));
      continue;
    }
    const end = line.match(/silence_end:\s*(-?\d+(?:\.\d+)?)/);
    if (end && pendingStart != null) {
      const e = Number(end[1]);
      if (e > pendingStart) spans.push({ start: pendingStart, end: e });
      pendingStart = null;
    }
  }
  return spans;
}

// ---------- planning ----------

function buildPlan(duration, silences, brollCount) {
  const speech = [];
  let cursor = 0;
  for (const s of [...silences].sort((a, b) => a.start - b.start)) {
    const start = Math.max(cursor, 0);
    const end = Math.min(s.start, duration);
    if (end - start > 0.05) speech.push({ start, end });
    cursor = Math.max(cursor, s.end);
  }
  if (duration - cursor > 0.05) speech.push({ start: cursor, end: duration });
  if (speech.length === 0) speech.push({ start: 0, end: duration });

  const steps = [];
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

  const speechDur = speech.reduce((s, r) => s + (r.end - r.start), 0);
  const rawDuration = speechDur + inserts * 3;
  const finalDuration = rawDuration / Math.max(0.01, CONFIG.speed);
  return { steps, rawDuration, finalDuration };
}

// ---------- b-roll normalization ----------

async function normalizeBroll(srcPath, outPath) {
  const probe = await ffprobe(srcPath);
  const w = CONFIG.outWidth;
  const h = CONFIG.outHeight;
  const vf = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=30`;
  const args = ["-y", "-i", srcPath];
  if (!probe.hasAudio) {
    args.push("-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-shortest");
  }
  args.push(
    "-vf", vf,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "23",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-ar", "44100",
    "-ac", "2",
    "-movflags", "+faststart",
    outPath,
  );
  const { code, stderr } = await runCmd("ffmpeg", args, { timeoutMs: 10 * 60_000 });
  if (code !== 0) throw new Error(`b-roll normalize failed: ${extractStderrSummary(stderr)}`);
}

// ---------- final render ----------

async function renderFinal({ sourcePath, plan, brollPaths, hasAudio, wmPath, onProgress }) {
  const outPath = path.join(WORK_DIR, "output.mp4");
  const wmExists = !!wmPath;

  const brollInputIdx = new Map();
  brollPaths.forEach((_, i) => brollInputIdx.set(i, 1 + i));
  const wmInputIdx = wmExists ? 1 + brollPaths.length : -1;

  const inputs = ["-i", sourcePath];
  for (const bp of brollPaths) inputs.push("-i", bp);
  if (wmExists) inputs.push("-loop", "1", "-i", wmPath);

  const w = CONFIG.outWidth;
  const h = CONFIG.outHeight;
  const scaleCrop = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=30`;

  const chains = [];
  const labelPairs = [];
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
  chains.push(`[cv]setpts=PTS/${CONFIG.speed}[sv]`);
  let finalVLabel = "sv";
  let finalALabel = "";
  if (hasAudio) {
    chains.push(`[ca]atempo=${CONFIG.speed}[sa]`);
    finalALabel = "sa";
  }

  if (wmExists && wmInputIdx >= 0) {
    const jitter = CONFIG.watermarkJitterPx;
    const jx = Math.floor(Math.random() * jitter);
    const jy = Math.floor(Math.random() * jitter);
    const pad = 24;
    let expr;
    switch (CONFIG.watermarkCorner) {
      case "top-left": expr = `${pad + jx}:${pad + jy}`; break;
      case "bottom-left": expr = `${pad + jx}:H-h-${pad + jy}`; break;
      case "bottom-right": expr = `W-w-${pad + jx}:H-h-${pad + jy}`; break;
      case "top-right":
      default: expr = `W-w-${pad + jx}:${pad + jy}`;
    }
    const wmScaledLabel = "wm";
    chains.push(`[${wmInputIdx}:v]scale=${Math.floor(w * 0.12)}:-1[${wmScaledLabel}]`);
    chains.push(`[${finalVLabel}][${wmScaledLabel}]overlay=${expr}:shortest=1[out]`);
    finalVLabel = "out";
  }

  const filterComplex = chains.join(";");
  const mapArgs = ["-map", `[${finalVLabel}]`];
  if (hasAudio) mapArgs.push("-map", `[${finalALabel}]`);

  const encodeArgs = [
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "22",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
  ];
  if (hasAudio) encodeArgs.push("-c:a", "aac", "-b:a", "128k");

  const ffmpegArgs = [
    "-y",
    "-hide_banner",
    "-nostats",
    "-progress", "pipe:2",
    ...inputs,
    "-filter_complex", filterComplex,
    ...mapArgs,
    ...encodeArgs,
    outPath,
  ];

  const totalMs = plan.finalDuration * 1000;
  const { code, stderr } = await runCmd("ffmpeg", ffmpegArgs, {
    timeoutMs: 30 * 60_000,
    onStderr: (chunk) => {
      const m = [...chunk.matchAll(/out_time_ms=(\d+)/g)].pop();
      if (m && totalMs > 0) {
        const doneMs = Number(m[1]) / 1000;
        onProgress(doneMs / totalMs);
      }
    },
  });
  if (code !== 0) {
    await fs
      .writeFile(path.join(WORK_DIR, "filter_complex.txt"), filterComplex, "utf8")
      .catch(() => {});
    throw new Error(`ffmpeg render failed: ${extractStderrSummary(stderr)}`);
  }
  return outPath;
}

// ---------- upload output ----------

async function uploadOutput(outPath) {
  const stream = createReadStream(outPath);
  const blob = await put(`reel-safe/outputs/${JOB_ID}.mp4`, stream, {
    access: "public",
    contentType: "video/mp4",
    addRandomSuffix: false,
    allowOverwrite: true,
    // Keep the finished reel around for a week. Vercel Blob has no built-in
    // TTL — clients can extend the retention window by re-listing/re-tagging.
    cacheControlMaxAge: 7 * 24 * 60 * 60,
  });
  return blob.url;
}

// ---------- main ----------

async function main() {
  await fs.mkdir(WORK_DIR, { recursive: true });
  await writeStatus("probing", 0.02, { note: "Downloading inputs…" });

  const sourcePath = path.join(WORK_DIR, "source.mp4");
  await downloadTo(SOURCE_URL, sourcePath);

  const brollRawPaths = [];
  for (let i = 0; i < BROLL_URLS.length; i += 1) {
    const p = path.join(WORK_DIR, `broll-${String(i).padStart(2, "0")}-raw.mp4`);
    await downloadTo(BROLL_URLS[i], p);
    brollRawPaths.push(p);
  }

  let wmPath = null;
  if (WATERMARK_URL) {
    wmPath = path.join(WORK_DIR, "watermark.png");
    await downloadTo(WATERMARK_URL, wmPath);
  }

  await writeStatus("probing", 0.05, { note: "Reading video…" });
  const probe = await ffprobe(sourcePath);
  if (probe.duration <= 0) throw new Error("Source video has no duration.");

  let silences = [];
  if (probe.hasAudio) {
    await writeStatus("detecting", 0.1, { note: "Detecting dead air…" });
    silences = await detectSilences(sourcePath);
  }

  await writeStatus("planning", 0.2, { note: "Planning cuts…" });
  const plan = buildPlan(probe.duration, silences, brollRawPaths.length);

  const usedBrollIndices = new Set(
    plan.steps.filter((s) => s.kind === "broll").map((s) => s.index),
  );
  const brollFinalPaths = [];
  let brollDone = 0;
  for (const idx of usedBrollIndices) {
    const normPath = path.join(WORK_DIR, `broll-${String(idx).padStart(2, "0")}.mp4`);
    await normalizeBroll(brollRawPaths[idx], normPath);
    brollFinalPaths.push(normPath);
    brollDone += 1;
    const pct = 0.2 + (0.15 * brollDone) / Math.max(1, usedBrollIndices.size);
    await writeStatus("rendering", pct, {
      note: `Normalizing b-roll ${brollDone}/${usedBrollIndices.size}…`,
    });
  }

  await writeStatus("rendering", 0.35, { note: "Encoding reel…" });
  let lastReported = 0;
  const outPath = await renderFinal({
    sourcePath,
    plan,
    brollPaths: brollFinalPaths,
    hasAudio: probe.hasAudio,
    wmPath,
    onProgress: (pct) => {
      const mapped = 0.35 + Math.min(1, Math.max(0, pct)) * 0.55;
      // Throttle status writes to ~1/s so we don't hammer Blob during long
      // renders. Small drift is fine — the UI polls at ~1 Hz anyway.
      const now = Date.now();
      if (now - lastReported > 1000) {
        lastReported = now;
        writeStatus("rendering", mapped, { note: "Encoding reel…" }).catch(() => {});
      }
    },
  });

  await writeStatus("rendering", 0.95, { note: "Uploading result…" });
  const outputUrl = await uploadOutput(outPath);

  const finalProbe = await ffprobe(outPath);
  await writeStatus("done", 1, {
    result: {
      jobId: JOB_ID,
      outputUrl,
      duration: finalProbe.duration,
      brollUsed: usedBrollIndices.size,
      silencesTrimmed: silences.length,
    },
  });
}

main().catch(async (err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(msg);
  try {
    await writeStatus("error", 0, { error: msg });
  } catch {
    // If status write fails, at least the parent times out cleanly.
  }
  process.exit(1);
});
