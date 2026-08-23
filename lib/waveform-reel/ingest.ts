import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile, access, readdir, readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { cookieArgs } from "../ytdlp-cookies";

export const WR_CACHE_ROOT = join(process.cwd(), ".waveform-reel-cache");

export type IngestedAudio = {
  /** Cache key — used to build the /api/waveform-reel/serve URL. */
  key: string;
  /** Container extension without dot ("m4a", "mp3", "webm", "wav"). */
  ext: string;
  /** MIME string for `<audio>` / `<Audio>`. */
  mime: string;
  /** Optional metadata from YouTube. */
  title?: string;
  channel?: string;
};

const MIME_BY_EXT: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  wav: "audio/wav",
  webm: "audio/webm",
  ogg: "audio/ogg",
  aac: "audio/aac",
  opus: "audio/ogg",
};

function mimeFor(ext: string): string {
  return MIME_BY_EXT[ext.toLowerCase()] ?? "application/octet-stream";
}

function ytIdFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1) || null;
    if (u.hostname.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return v;
      const m = u.pathname.match(/\/(shorts|embed|live)\/([\w-]+)/);
      if (m) return m[2];
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function run(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (c) => (stdout += c.toString()));
    p.stderr.on("data", (c) => (stderr += c.toString()));
    p.on("error", reject);
    p.on("close", (code) => resolve({ stdout, stderr, code }));
  });
}

export async function ingestUpload(
  bytes: Uint8Array,
  originalName: string,
): Promise<IngestedAudio> {
  const rawExt = extname(originalName).replace(/^\./, "").toLowerCase() || "bin";
  // If they hand us a video container, we still let the browser's
  // AudioContext.decodeAudioData handle it — MP4/WEBM both decode fine.
  const ext = rawExt;
  const hash = createHash("sha1").update(bytes).digest("hex").slice(0, 16);
  const key = `upload-${hash}`;
  const dir = join(WR_CACHE_ROOT, key);
  await mkdir(dir, { recursive: true });
  const dest = join(dir, `audio.${ext}`);
  if (!(await fileExists(dest))) {
    await writeFile(dest, bytes);
  }
  return { key, ext, mime: mimeFor(ext) };
}

export async function ingestYouTube(rawUrl: string): Promise<IngestedAudio | { error: string }> {
  const videoId = ytIdFromUrl(rawUrl);
  if (!videoId) return { error: "invalid_url" };
  const key = `yt-${videoId}`;
  const dir = join(WR_CACHE_ROOT, key);
  await mkdir(dir, { recursive: true });

  // If we already have an audio file cached, reuse it.
  const existing = await findAudio(dir);
  if (existing) {
    const meta = await readMeta(dir);
    return { key, ext: existing.ext, mime: mimeFor(existing.ext), ...meta };
  }

  const infoRes = await run("yt-dlp", [
    "-J",
    "--no-playlist",
    ...(await cookieArgs()),
    "--skip-download",
    rawUrl,
  ]);
  let title: string | undefined;
  let channel: string | undefined;
  if (infoRes.code === 0) {
    try {
      const j = JSON.parse(infoRes.stdout) as {
        title?: string;
        channel?: string;
        uploader?: string;
      };
      title = j.title;
      channel = j.channel ?? j.uploader;
      await writeFile(join(dir, "meta.json"), JSON.stringify({ title, channel }), "utf8");
    } catch {
      /* ignore */
    }
  }

  const dlRes = await run("yt-dlp", [
    "--no-playlist",
    ...(await cookieArgs()),
    "-f",
    "bestaudio[ext=m4a]/bestaudio",
    "-o",
    join(dir, "audio.%(ext)s"),
    rawUrl,
  ]);

  const grabbed = await findAudio(dir);
  if (dlRes.code !== 0 || !grabbed) {
    return { error: interpretYtdlpError(dlRes.stderr) };
  }

  return { key, ext: grabbed.ext, mime: mimeFor(grabbed.ext), title, channel };
}

async function findAudio(dir: string): Promise<{ ext: string; path: string } | null> {
  try {
    const files = await readdir(dir);
    for (const f of files) {
      if (f.startsWith("audio.")) {
        const ext = extname(f).replace(/^\./, "").toLowerCase();
        return { ext, path: join(dir, f) };
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function readMeta(dir: string): Promise<{ title?: string; channel?: string }> {
  try {
    const raw = await readFile(join(dir, "meta.json"), "utf8");
    return JSON.parse(raw) as { title?: string; channel?: string };
  } catch {
    return {};
  }
}

export async function resolveAudioPath(key: string): Promise<{ path: string; mime: string; ext: string } | null> {
  const dir = join(WR_CACHE_ROOT, key);
  const found = await findAudio(dir);
  if (!found) return null;
  return { path: found.path, mime: mimeFor(found.ext), ext: found.ext };
}

function interpretYtdlpError(stderr: string): string {
  const s = stderr || "";
  if (/cookies are no longer valid|rotated in the browser|Sign in to confirm/i.test(s)) {
    return (
      "YouTube rejected the request. yt-dlp is set to use Firefox live cookies " +
      "(--cookies-from-browser firefox) — make sure Firefox is installed and signed in to YouTube."
    );
  }
  if (/HTTP Error 429|Too Many Requests/i.test(s)) {
    return "YouTube rate-limited this IP. Wait a few minutes and retry.";
  }
  if (/Video unavailable|Private video|has been removed/i.test(s)) {
    return "Video is unavailable, private, or removed.";
  }
  if (/yt-dlp: command not found|ENOENT/i.test(s)) {
    return "yt-dlp is not installed on the server.";
  }
  return `yt-dlp failed: ${s.slice(0, 300)}`;
}
