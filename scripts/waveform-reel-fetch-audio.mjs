// Runs inside a Vercel Sandbox microVM. yt-dlp bestaudio → uploads to Blob →
// prints one JSON line to stdout for the parent Next.js function to parse.
//
// Env inputs:
//   BLOB_READ_WRITE_TOKEN — required
//   JOB_ID                — required, namespaces the Blob path
//   SOURCE_URL            — required (YouTube, TikTok, X, IG, Vimeo, …)
//
// Node 24. Assumes yt-dlp + ffmpeg are on PATH and @vercel/blob is installed
// (handled by the sandbox cold-path installer).

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { put } from "@vercel/blob";

const JOB_ID = required("JOB_ID");
const SOURCE_URL = required("SOURCE_URL");

const WORK_DIR = `/tmp/waveform-reel/${JOB_ID}`;

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function log(msg) {
  process.stderr.write(`[waveform-fetch] ${msg}\n`);
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

async function fetchAudio() {
  await fs.mkdir(WORK_DIR, { recursive: true });
  const outTemplate = path.join(WORK_DIR, "audio.%(ext)s");
  log(`fetching audio from ${SOURCE_URL}`);
  const args = [
    "--no-playlist",
    "--no-warnings",
    "--no-progress",
    "--print-json",
    "-f",
    "bestaudio[ext=m4a]/bestaudio",
    "-o",
    outTemplate,
    SOURCE_URL,
  ];
  const res = await runCmd("yt-dlp", args);
  if (res.code !== 0) {
    throw new Error(`yt-dlp_failed (exit ${res.code}): ${res.stderr.slice(-500)}`);
  }
  const line = res.stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? "";
  let meta = {};
  try {
    meta = JSON.parse(line);
  } catch {
    /* file is still on disk, we just don't get metadata */
  }
  const entries = await fs.readdir(WORK_DIR);
  const file = entries.find((e) => e.startsWith("audio."));
  if (!file) throw new Error("output_file_missing");
  return { meta, filepath: path.join(WORK_DIR, file), ext: file.split(".").pop() };
}

function mimeFor(ext) {
  const m = {
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    mp4: "audio/mp4",
    wav: "audio/wav",
    webm: "audio/webm",
    ogg: "audio/ogg",
    aac: "audio/aac",
    opus: "audio/ogg",
  };
  return m[ext?.toLowerCase()] ?? "application/octet-stream";
}

async function main() {
  const { meta, filepath, ext } = await fetchAudio();
  const stat = await fs.stat(filepath);
  log(`downloaded ${(stat.size / 1024 / 1024).toFixed(2)} MB (.${ext}), uploading to Blob`);
  const buf = await fs.readFile(filepath);
  const extractor = (meta.extractor || meta.extractor_key || "url").toLowerCase();
  const id = meta.id || JOB_ID;
  const key = `waveform-reel/url/${extractor}-${id}.${ext}`;
  const blob = await put(key, buf, {
    access: "public",
    contentType: mimeFor(ext),
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60 * 60 * 24 * 7,
  });
  await fs.unlink(filepath).catch(() => {});
  const out = {
    blobUrl: blob.url,
    pathname: blob.pathname,
    mime: mimeFor(ext),
    ext,
    title: meta.title ?? "",
    channel: meta.uploader ?? meta.channel ?? "",
    extractor,
    durationSec: Number(meta.duration ?? 0) || 0,
    sizeBytes: stat.size,
  };
  process.stdout.write(JSON.stringify(out) + "\n");
}

main().catch((err) => {
  process.stderr.write(
    `[waveform-fetch] FATAL: ${err instanceof Error ? err.stack ?? err.message : err}\n`,
  );
  process.stdout.write(
    JSON.stringify({ error: err instanceof Error ? err.message : String(err) }) + "\n",
  );
  process.exit(1);
});
