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
const SANDBOX_WORK_DIR = "/work";
// 8 min max — Hobby function cap is 300s but the sandbox runs beyond the
// parent function's window if the caller detaches. Here we're synchronous
// so this is really just a safety net; the caller's maxDuration wins.
const SANDBOX_TIMEOUT_MS = 8 * 60_000;

let cachedPipelineScript: string | null = null;

async function readPipelineScript(): Promise<string> {
  if (cachedPipelineScript) return cachedPipelineScript;
  const scriptPath = path.join(process.cwd(), "scripts", "frame-grab-pipeline.mjs");
  cachedPipelineScript = await fs.readFile(scriptPath, "utf8");
  return cachedPipelineScript;
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
  url: string;
  sec: number;
  durationSec: number;
  sizeBytes: number;
};

export type SandboxResult =
  | { clips: SandboxClip[] }
  | { error: string; stderr?: string };

export async function runFrameGrabSandbox(args: {
  jobId: string;
  sourceUrl: string;
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
        SOURCE_URL: args.sourceUrl,
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
