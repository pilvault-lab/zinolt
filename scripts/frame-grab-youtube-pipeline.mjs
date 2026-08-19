// Runs inside a Vercel Sandbox microVM. Downloads a YouTube video with
// yt-dlp, uploads it to private Blob storage, prints one JSON line to stdout
// so the parent Next.js function can hand the pathname to the extract flow.
//
// Env inputs:
//   BLOB_READ_WRITE_TOKEN — required
//   JOB_ID                — required, namespaces Blob paths
//   YOUTUBE_URL           — required
//   MAX_HEIGHT            — optional, cap resolution (default 1080)
//
// Node 24. Assumes yt-dlp is on PATH and @vercel/blob is installed
// (both handled by the sandbox helper cold-path).

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { put } from "@vercel/blob";

const JOB_ID = required("JOB_ID");
const YOUTUBE_URL = required("YOUTUBE_URL");
const MAX_HEIGHT = process.env.MAX_HEIGHT || "1080";

const WORK_DIR = `/tmp/frame-grab-yt/${JOB_ID}`;
const OUT_PATH = path.join(WORK_DIR, "video.mp4");

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function log(msg) {
  process.stderr.write(`[youtube-pipeline] ${msg}\n`);
}

function runCmd(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

async function fetchWithYtDlp() {
  await fs.mkdir(WORK_DIR, { recursive: true });
  log(`downloading ${YOUTUBE_URL} → ${OUT_PATH} (max ${MAX_HEIGHT}p)`);
  // --no-playlist: single video only.
  // --print-json: metadata to stdout (single line).
  // --no-warnings + --no-progress: keep stdout clean.
  // Format string: best mp4 video ≤ MAX_HEIGHT + best m4a audio, merged.
  const args = [
    "--no-playlist",
    "--no-warnings",
    "--no-progress",
    "--print-json",
    "-f",
    `bv*[height<=${MAX_HEIGHT}][ext=mp4]+ba[ext=m4a]/b[height<=${MAX_HEIGHT}]/b`,
    "--merge-output-format",
    "mp4",
    "-o",
    OUT_PATH,
    YOUTUBE_URL,
  ];
  const res = await runCmd("yt-dlp", args);
  if (res.code !== 0) {
    throw new Error(`yt-dlp_failed (exit ${res.code}): ${res.stderr.slice(-500)}`);
  }
  // yt-dlp prints one JSON blob to stdout. Grab the last non-empty line.
  const line = res.stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? "";
  let meta = {};
  try {
    meta = JSON.parse(line);
  } catch {
    // fall through with empty meta — we still have the file
  }
  return meta;
}

async function main() {
  const meta = await fetchWithYtDlp();
  const stat = await fs.stat(OUT_PATH);
  log(`downloaded ${(stat.size / 1024 / 1024).toFixed(1)} MB, uploading to Blob`);
  const buf = await fs.readFile(OUT_PATH);
  const key = `frame-grab/youtube/${JOB_ID}/${(meta.id || "video")}.mp4`;
  await put(key, buf, {
    access: "private",
    contentType: "video/mp4",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60 * 60 * 24 * 3,
  });
  await fs.unlink(OUT_PATH).catch(() => {});
  const out = {
    pathname: key,
    videoId: meta.id ?? null,
    title: meta.title ?? "",
    channel: meta.uploader ?? meta.channel ?? "",
    durationSec: Number(meta.duration ?? 0) || 0,
    sizeBytes: stat.size,
  };
  process.stdout.write(JSON.stringify(out) + "\n");
}

main().catch((err) => {
  process.stderr.write(`[youtube-pipeline] FATAL: ${err instanceof Error ? err.stack ?? err.message : err}\n`);
  process.stdout.write(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }) + "\n");
  process.exit(1);
});
