import { promises as fs } from "node:fs";
import path from "node:path";
import { Sandbox } from "@vercel/sandbox";
import { get, put } from "@vercel/blob";
import type { ReelSafeConfig, ReelSafeJobStatus } from "./reelsafe-types";

// Amazon Linux 2023 (the Sandbox base image) ships ffmpeg-free in the default
// enabled AppStream repo. It's LGPL-only but has everything we need
// (libx264 encode, aac, silencedetect). Anything more exotic (nvenc, etc.) is
// out of scope.
const FFMPEG_INSTALL_CMD = "sudo dnf install -y ffmpeg-free 2>&1";

const SANDBOX_WORK_DIR = "/work";
// 45 min max — long enough for a real 20-30 min render + upload with headroom.
// The parent function has already returned by the time the sandbox is spun up,
// so this is entirely the VM's own lifetime.
const SANDBOX_TIMEOUT_MS = 45 * 60_000;

let cachedPipelineScript: string | null = null;

async function readPipelineScript(): Promise<string> {
  if (cachedPipelineScript) return cachedPipelineScript;
  const scriptPath = path.join(process.cwd(), "scripts", "reel-safe-pipeline.mjs");
  cachedPipelineScript = await fs.readFile(scriptPath, "utf8");
  return cachedPipelineScript;
}

function getSandboxCredentials() {
  // On Vercel, OIDC auth is automatic. For local dev, the developer needs
  // VERCEL_TOKEN + VERCEL_TEAM_ID + VERCEL_PROJECT_ID pulled via `vercel env`.
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

/** Write a status blob at the canonical location. Used by the parent function
 *  to seed initial state and to report failures before the sandbox is alive. */
export async function putStatusBlob(
  jobId: string,
  status: ReelSafeJobStatus,
): Promise<void> {
  await put(`reel-safe/jobs/${jobId}/status.json`, JSON.stringify(status), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
}

/** Fetch the current status blob for a job. Returns null if it doesn't exist
 *  (never submitted, or expired). */
export async function readStatusBlob(
  jobId: string,
): Promise<ReelSafeJobStatus | null> {
  const result = await get(`reel-safe/jobs/${jobId}/status.json`, {
    access: "public",
    // Bypass CDN — polling clients care about the latest state, not a
    // stale 60s-old cached copy.
    useCache: false,
  });
  if (!result) return null;
  if (result.statusCode !== 200 || !result.stream) return null;
  const text = await new Response(result.stream).text();
  return JSON.parse(text) as ReelSafeJobStatus;
}

/** Kick off the reel-safe pipeline inside a Vercel Sandbox microVM. Returns
 *  as soon as the pipeline is running (detached) — the sandbox owns its own
 *  lifetime from here, and the client polls status via the blob. */
export async function startReelSafeSandbox(args: {
  jobId: string;
  sourceUrl: string;
  brollUrls: string[];
  watermarkUrl: string | null;
  config: ReelSafeConfig;
}): Promise<void> {
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    throw new Error(
      "BLOB_READ_WRITE_TOKEN missing — enable Vercel Blob on this project and pull env vars.",
    );
  }

  const snapshotId = process.env.REEL_SAFE_SANDBOX_SNAPSHOT_ID;
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

  // Cold path (no snapshot): install ffmpeg + @vercel/blob. ~30s. Recommend
  // building a snapshot via `scripts/reel-safe-snapshot.ts` to skip this.
  if (!snapshotId) {
    const installFfmpeg = await sandbox.runCommand("sh", ["-c", FFMPEG_INSTALL_CMD]);
    if (installFfmpeg.exitCode !== 0) {
      throw new Error(
        `ffmpeg install failed (exit ${installFfmpeg.exitCode}): ${await installFfmpeg.stderr()}`,
      );
    }
    await sandbox.runCommand("mkdir", ["-p", SANDBOX_WORK_DIR]);
    await sandbox.runCommand("sh", [
      "-c",
      `cd ${SANDBOX_WORK_DIR} && npm init -y >/dev/null && npm install @vercel/blob --no-audit --no-fund 2>&1`,
    ]);
  }

  await sandbox.writeFiles([
    {
      path: `${SANDBOX_WORK_DIR}/pipeline.mjs`,
      content: pipelineScript,
    },
  ]);

  // Detached: the parent Next.js function returns immediately after this
  // resolves. The sandbox VM keeps running until the script exits or the
  // sandbox's own timeout elapses.
  await sandbox.runCommand({
    cmd: "node",
    args: [`${SANDBOX_WORK_DIR}/pipeline.mjs`],
    cwd: SANDBOX_WORK_DIR,
    detached: true,
    env: {
      BLOB_READ_WRITE_TOKEN: blobToken,
      JOB_ID: args.jobId,
      SOURCE_URL: args.sourceUrl,
      BROLL_URLS_JSON: JSON.stringify(args.brollUrls),
      WATERMARK_URL: args.watermarkUrl ?? "",
      CONFIG_JSON: JSON.stringify(args.config),
    },
  });
}
