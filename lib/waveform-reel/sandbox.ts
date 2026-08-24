import { promises as fs } from "node:fs";
import path from "node:path";
import { Sandbox } from "@vercel/sandbox";

/**
 * Runs the waveform-reel yt-dlp pipeline inside a Vercel Sandbox microVM.
 * Serverless functions can't run native binaries, so URL ingest on deployed
 * Vercel uses a Firecracker microVM instead. Returns a public Blob URL that
 * the browser (and Remotion's headless render) can fetch directly.
 *
 * Set WAVEFORM_REEL_SANDBOX_SNAPSHOT_ID after building a snapshot with
 * ffmpeg + yt-dlp + @vercel/blob pre-installed to skip the ~40s cold path.
 */

const FFMPEG_INSTALL_CMD = "sudo dnf install -y ffmpeg-free 2>&1";
const YTDLP_INSTALL_CMD =
  "sudo curl -sL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp && sudo chmod a+rx /usr/local/bin/yt-dlp 2>&1";
const SANDBOX_WORK_DIR = "/work";
const SANDBOX_TIMEOUT_MS = 6 * 60_000;

let cachedScript: string | null = null;
async function readPipelineScript(): Promise<string> {
  if (cachedScript) return cachedScript;
  const p = path.join(process.cwd(), "scripts", "waveform-reel-fetch-audio.mjs");
  cachedScript = await fs.readFile(p, "utf8");
  return cachedScript;
}

function getSandboxCredentials() {
  if (
    process.env.VERCEL_TOKEN &&
    process.env.VERCEL_TEAM_ID &&
    process.env.VERCEL_PROJECT_ID
  ) {
    return {
      token: process.env.VERCEL_TOKEN,
      teamId: process.env.VERCEL_TEAM_ID,
      projectId: process.env.VERCEL_PROJECT_ID,
    };
  }
  return {};
}

export function sandboxAvailable(): boolean {
  const hasVercel =
    (!!process.env.VERCEL_TOKEN &&
      !!process.env.VERCEL_TEAM_ID &&
      !!process.env.VERCEL_PROJECT_ID) ||
    !!process.env.VERCEL_OIDC_TOKEN;
  const hasBlob = !!process.env.BLOB_READ_WRITE_TOKEN;
  return hasVercel && hasBlob;
}

export type SandboxFetchResult =
  | {
      blobUrl: string;
      pathname: string;
      mime: string;
      ext: string;
      title: string;
      channel: string;
      extractor: string;
      durationSec: number;
      sizeBytes: number;
    }
  | { error: string; stderr?: string };

export async function runFetchAudioSandbox(args: {
  jobId: string;
  url: string;
}): Promise<SandboxFetchResult> {
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    return {
      error:
        "BLOB_READ_WRITE_TOKEN missing — enable Vercel Blob on this project.",
    };
  }

  const snapshotId = process.env.WAVEFORM_REEL_SANDBOX_SNAPSHOT_ID;
  const credentials = getSandboxCredentials();
  const script = await readPipelineScript();

  const sandbox = snapshotId
    ? await Sandbox.create({
        ...credentials,
        source: { type: "snapshot", snapshotId },
        timeout: SANDBOX_TIMEOUT_MS,
      })
    : await Sandbox.create({
        ...credentials,
        runtime: "node24",
        timeout: SANDBOX_TIMEOUT_MS,
      });

  try {
    if (!snapshotId) {
      // Cold path: ~40s to install ffmpeg + yt-dlp + @vercel/blob.
      const installFfmpeg = await sandbox.runCommand("sh", ["-c", FFMPEG_INSTALL_CMD]);
      if (installFfmpeg.exitCode !== 0) {
        return {
          error: `ffmpeg_install_failed (exit ${installFfmpeg.exitCode})`,
          stderr: await installFfmpeg.stderr(),
        };
      }
      const installYtdlp = await sandbox.runCommand("sh", ["-c", YTDLP_INSTALL_CMD]);
      if (installYtdlp.exitCode !== 0) {
        return {
          error: `ytdlp_install_failed (exit ${installYtdlp.exitCode})`,
          stderr: await installYtdlp.stderr(),
        };
      }
      await sandbox.runCommand("mkdir", ["-p", SANDBOX_WORK_DIR]);
      const npmInstall = await sandbox.runCommand("sh", [
        "-c",
        `cd ${SANDBOX_WORK_DIR} && npm init -y >/dev/null && npm install @vercel/blob --no-audit --no-fund 2>&1`,
      ]);
      if (npmInstall.exitCode !== 0) {
        return {
          error: `npm_install_failed (exit ${npmInstall.exitCode})`,
          stderr: await npmInstall.stderr(),
        };
      }
    }

    await sandbox.writeFiles([
      { path: `${SANDBOX_WORK_DIR}/fetch.mjs`, content: script },
    ]);

    const run = await sandbox.runCommand({
      cmd: "node",
      args: [`${SANDBOX_WORK_DIR}/fetch.mjs`],
      cwd: SANDBOX_WORK_DIR,
      env: {
        BLOB_READ_WRITE_TOKEN: blobToken,
        JOB_ID: args.jobId,
        SOURCE_URL: args.url,
      },
    });

    const stdout = await run.stdout();
    const stderr = await run.stderr();
    const last = stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? "";
    let parsed: SandboxFetchResult | null = null;
    try {
      parsed = JSON.parse(last) as SandboxFetchResult;
    } catch {
      /* fall through */
    }

    if (run.exitCode !== 0) {
      const msg =
        parsed && "error" in parsed
          ? parsed.error
          : `fetch_failed (exit ${run.exitCode})`;
      return { error: msg, stderr: stderr.slice(-800) };
    }
    if (!parsed || !("blobUrl" in parsed)) {
      return { error: "fetch_no_json_output", stderr: stderr.slice(-800) };
    }
    return parsed;
  } finally {
    await sandbox.stop().catch(() => {});
  }
}
