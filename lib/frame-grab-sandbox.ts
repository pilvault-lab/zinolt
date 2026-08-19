import { promises as fs } from "node:fs";
import path from "node:path";
import { Sandbox } from "@vercel/sandbox";

/**
 * Runs the frame-grab pipeline inside a Vercel Sandbox microVM.
 *
 * Synchronous: creates the sandbox, runs the pipeline, waits for it to
 * finish, parses the JSON line printed to stdout, returns it. The parent
 * function's response is blocked on this. Fine for 30-500 short clips
 * (typical wall clock: 30-120s + cold-start install).
 *
 * To skip the ~30s ffmpeg install, set FRAME_GRAB_SANDBOX_SNAPSHOT_ID to a
 * snapshot ID built ahead of time via a snapshot script (same pattern as
 * REEL_SAFE_SANDBOX_SNAPSHOT_ID).
 */

const FFMPEG_INSTALL_CMD = "sudo dnf install -y ffmpeg-free 2>&1";
// yt-dlp_linux is a self-contained binary (bundled Python). ffmpeg is still
// required for the merge step of separate video+audio streams.
const YTDLP_INSTALL_CMD =
  "sudo curl -sL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp && sudo chmod a+rx /usr/local/bin/yt-dlp 2>&1";
const SANDBOX_WORK_DIR = "/work";
// 8 min max — Hobby function cap is 300s but the sandbox runs beyond the
// parent function's window if the caller detaches. Here we're synchronous
// so this is really just a safety net; the caller's maxDuration wins.
const SANDBOX_TIMEOUT_MS = 8 * 60_000;

let cachedPipelineScript: string | null = null;
let cachedYoutubeScript: string | null = null;

async function readPipelineScript(): Promise<string> {
  if (cachedPipelineScript) return cachedPipelineScript;
  const scriptPath = path.join(process.cwd(), "scripts", "frame-grab-pipeline.mjs");
  cachedPipelineScript = await fs.readFile(scriptPath, "utf8");
  return cachedPipelineScript;
}

async function readYoutubeScript(): Promise<string> {
  if (cachedYoutubeScript) return cachedYoutubeScript;
  const scriptPath = path.join(process.cwd(), "scripts", "frame-grab-youtube-pipeline.mjs");
  cachedYoutubeScript = await fs.readFile(scriptPath, "utf8");
  return cachedYoutubeScript;
}

function getSandboxCredentials() {
  // On Vercel: OIDC is automatic. Locally: needs `vercel env pull` to seed
  // VERCEL_TOKEN + VERCEL_TEAM_ID + VERCEL_PROJECT_ID.
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

export type SandboxClip = {
  pathname: string;
  sec: number;
  durationSec: number;
  sizeBytes: number;
};

export type SandboxResult =
  | { clips: SandboxClip[] }
  | { error: string; stderr?: string };

export async function runFrameGrabSandbox(args: {
  jobId: string;
  sourcePathname: string;
  mode: "full-bleed" | "letterboxed";
  cropOffsetX: number;
  clipDurationSec: number;
  moments: number[];
}): Promise<SandboxResult> {
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    return {
      error:
        "BLOB_READ_WRITE_TOKEN missing — enable Vercel Blob on this project and pull env vars.",
    };
  }

  const snapshotId = process.env.FRAME_GRAB_SANDBOX_SNAPSHOT_ID;
  const credentials = getSandboxCredentials();
  const pipelineScript = await readPipelineScript();

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
    // Cold path: install ffmpeg + @vercel/blob. ~30s. A pre-baked snapshot
    // (see FRAME_GRAB_SANDBOX_SNAPSHOT_ID) skips this entirely.
    if (!snapshotId) {
      const installFfmpeg = await sandbox.runCommand("sh", ["-c", FFMPEG_INSTALL_CMD]);
      if (installFfmpeg.exitCode !== 0) {
        return {
          error: `ffmpeg_install_failed (exit ${installFfmpeg.exitCode})`,
          stderr: await installFfmpeg.stderr(),
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
      {
        path: `${SANDBOX_WORK_DIR}/pipeline.mjs`,
        content: pipelineScript,
      },
    ]);

    // Synchronous: block until the pipeline exits so we can grab stdout.
    const pipelineRun = await sandbox.runCommand({
      cmd: "node",
      args: [`${SANDBOX_WORK_DIR}/pipeline.mjs`],
      cwd: SANDBOX_WORK_DIR,
      env: {
        BLOB_READ_WRITE_TOKEN: blobToken,
        JOB_ID: args.jobId,
        SOURCE_PATHNAME: args.sourcePathname,
        MODE: args.mode,
        CROP_OFFSET_X: String(args.cropOffsetX),
        CLIP_DURATION_SEC: String(args.clipDurationSec),
        MOMENTS_JSON: JSON.stringify(args.moments),
      },
    });

    const stdout = await pipelineRun.stdout();
    const stderr = await pipelineRun.stderr();

    // Pipeline prints one JSON line last. Grab the last non-empty line so any
    // stray stdout from npm/node doesn't corrupt the parse.
    const lastLine = stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? "";
    let parsed: SandboxResult | null = null;
    try {
      parsed = JSON.parse(lastLine) as SandboxResult;
    } catch {
      // fall through
    }

    if (pipelineRun.exitCode !== 0) {
      const msg =
        parsed && "error" in parsed
          ? parsed.error
          : `pipeline_failed (exit ${pipelineRun.exitCode})`;
      return { error: msg, stderr: stderr.slice(-800) };
    }
    if (!parsed || !("clips" in parsed)) {
      return { error: "pipeline_no_json_output", stderr: stderr.slice(-800) };
    }
    return parsed;
  } finally {
    // Best-effort cleanup. Sandbox timeout will kill it otherwise.
    await sandbox.stop().catch(() => {});
  }
}

// ---------- YouTube fetch ------------------------------------------------

export type YoutubeFetchResult =
  | {
      pathname: string;
      videoId: string | null;
      title: string;
      channel: string;
      durationSec: number;
      sizeBytes: number;
    }
  | { error: string; stderr?: string };

/**
 * Downloads a YouTube video inside a sandbox and uploads it to private Blob.
 * Returns the Blob pathname (not URL) so the caller can hand it to the
 * extract flow or serve it via a proxy route.
 */
export async function runYoutubeFetchSandbox(args: {
  jobId: string;
  youtubeUrl: string;
  maxHeight?: number;
}): Promise<YoutubeFetchResult> {
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    return {
      error:
        "BLOB_READ_WRITE_TOKEN missing — enable Vercel Blob on this project and pull env vars.",
    };
  }

  const snapshotId = process.env.FRAME_GRAB_SANDBOX_SNAPSHOT_ID;
  const credentials = getSandboxCredentials();
  const pipelineScript = await readYoutubeScript();

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
      // ffmpeg for the merge step. yt-dlp will bail without it on separate
      // video+audio streams.
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
      {
        path: `${SANDBOX_WORK_DIR}/youtube.mjs`,
        content: pipelineScript,
      },
    ]);

    const run = await sandbox.runCommand({
      cmd: "node",
      args: [`${SANDBOX_WORK_DIR}/youtube.mjs`],
      cwd: SANDBOX_WORK_DIR,
      env: {
        BLOB_READ_WRITE_TOKEN: blobToken,
        JOB_ID: args.jobId,
        YOUTUBE_URL: args.youtubeUrl,
        MAX_HEIGHT: String(args.maxHeight ?? 1080),
      },
    });

    const stdout = await run.stdout();
    const stderr = await run.stderr();
    const lastLine = stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? "";
    let parsed: YoutubeFetchResult | null = null;
    try {
      parsed = JSON.parse(lastLine) as YoutubeFetchResult;
    } catch {
      /* fall through */
    }
    if (run.exitCode !== 0) {
      const msg =
        parsed && "error" in parsed
          ? parsed.error
          : `youtube_pipeline_failed (exit ${run.exitCode})`;
      return { error: msg, stderr: stderr.slice(-800) };
    }
    if (!parsed || !("pathname" in parsed)) {
      return { error: "youtube_pipeline_no_json", stderr: stderr.slice(-800) };
    }
    return parsed;
  } finally {
    await sandbox.stop().catch(() => {});
  }
}

