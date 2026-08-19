// Runs inside a Vercel Sandbox microVM. Downloads a source video from Blob,
// cuts N vertical clips with ffmpeg, uploads each clip back to Blob, and
// prints one JSON line to stdout so the parent Next.js function can parse
// it as the extract response.
//
// Env inputs:
//   BLOB_READ_WRITE_TOKEN  — required, passed through from the function
//   JOB_ID                 — required, opaque hex string (namespaces Blob paths)
//   SOURCE_URL             — required, public blob URL of the source video
//   MODE                   — "full-bleed" | "letterboxed"
//   CROP_OFFSET_X          — 0..1, horizontal crop position for full-bleed
//   CLIP_DURATION_SEC      — float seconds per clip
//   MOMENTS_JSON           — JSON array of start-time floats (seconds)
//
// Node 24 runtime, no bundler. Stdout must contain exactly one JSON line at
// the end — everything else goes to stderr so it can't corrupt the parse.

import { spawn } from "node:child_process";
import { createWriteStream, promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { put } from "@vercel/blob";

const JOB_ID = required("JOB_ID");
const SOURCE_URL = required("SOURCE_URL");
const MODE = process.env.MODE === "letterboxed" ? "letterboxed" : "full-bleed";
const CROP_OFFSET_X = Math.max(0, Math.min(1, parseFloat(process.env.CROP_OFFSET_X ?? "0.5")));
const CLIP_DURATION_SEC = Math.max(0.05, Math.min(10, parseFloat(process.env.CLIP_DURATION_SEC ?? "0.5")));
const MOMENTS = JSON.parse(required("MOMENTS_JSON"));

const WORK_DIR = `/tmp/frame-grab/${JOB_ID}`;
const SRC_PATH = path.join(WORK_DIR, "src.mp4");

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function log(msg) {
  process.stderr.write(`[pipeline] ${msg}\n`);
}

function runCmd(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stderr }));
  });
}

function buildFilter(mode, off) {
  if (mode === "letterboxed") {
    return "scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1";
  }
  const cropW = "min(iw\\,ih*9/16)";
  const cropH = "min(ih\\,iw*16/9)";
  const cropX = `(iw-${cropW})*${off.toFixed(4)}`;
  const cropY = `(ih-${cropH})/2`;
  return `crop=${cropW}:${cropH}:${cropX}:${cropY},scale=1080:1920:flags=lanczos,setsar=1`;
}

async function downloadSource() {
  log(`downloading ${SOURCE_URL} → ${SRC_PATH}`);
  const res = await fetch(SOURCE_URL);
  if (!res.ok || !res.body) throw new Error(`download_failed: ${res.status}`);
  await fs.mkdir(WORK_DIR, { recursive: true });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(SRC_PATH));
  const s = await fs.stat(SRC_PATH);
  log(`downloaded ${(s.size / 1024 / 1024).toFixed(1)} MB`);
}

async function extractClip(index, startSec) {
  const name = `c${String(index + 1).padStart(3, "0")}_${Math.round(startSec * 1000)}ms.mp4`;
  const outPath = path.join(WORK_DIR, name);
  const filter = buildFilter(MODE, CROP_OFFSET_X);
  const args = [
    "-y",
    "-ss", String(startSec),
    "-i", SRC_PATH,
    "-t", String(CLIP_DURATION_SEC),
    "-vf", filter,
    "-an",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outPath,
  ];
  const res = await runCmd("ffmpeg", args);
  if (res.code !== 0) {
    throw new Error(`ffmpeg_failed clip ${index + 1} at ${startSec}s: ${res.stderr.slice(-400)}`);
  }
  const buf = await fs.readFile(outPath);
  const blob = await put(`frame-grab/jobs/${JOB_ID}/${name}`, buf, {
    access: "public",
    contentType: "video/mp4",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60 * 60 * 24 * 7,
  });
  // Free /tmp — we don't need the file after upload.
  await fs.unlink(outPath).catch(() => {});
  return {
    url: blob.url,
    sec: startSec,
    durationSec: CLIP_DURATION_SEC,
    sizeBytes: buf.length,
  };
}

async function main() {
  await downloadSource();
  const clips = [];
  for (let i = 0; i < MOMENTS.length; i++) {
    const t = Number(MOMENTS[i]);
    if (!(t >= 0) || !isFinite(t)) continue;
    log(`clip ${i + 1}/${MOMENTS.length} @ ${t.toFixed(2)}s`);
    clips.push(await extractClip(i, t));
  }
  // Cleanup source before printing result — sandbox will exit right after.
  await fs.unlink(SRC_PATH).catch(() => {});
  // One JSON line on stdout — parent parses this.
  process.stdout.write(JSON.stringify({ clips }) + "\n");
}

main().catch((err) => {
  process.stderr.write(`[pipeline] FATAL: ${err instanceof Error ? err.stack ?? err.message : err}\n`);
  process.stdout.write(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }) + "\n");
  process.exit(1);
});
