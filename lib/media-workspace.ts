import { promises as fs } from "node:fs";
import path from "node:path";

const REELSAFE_ROOT = path.join(process.cwd(), ".reel-safe");
const OUTPUTS_ROOT = path.join(process.cwd(), "outputs");

// Job IDs are opaque hex strings we mint server-side. Keep the pattern strict
// so a bad id can never escape into ../../etc/passwd territory.
const SAFE_JOB_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function assertSafeJobId(id: string): void {
  if (!SAFE_JOB_ID.test(id)) {
    throw new Error(`Invalid jobId: ${id}`);
  }
}

export function newJobId(): string {
  // 16 bytes → 32 hex chars. Enough entropy, filename-safe.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function reelSafeRoot(): string {
  return REELSAFE_ROOT;
}

export function outputsRoot(): string {
  return OUTPUTS_ROOT;
}

export async function ensureJobDir(jobId: string): Promise<string> {
  assertSafeJobId(jobId);
  const dir = path.join(REELSAFE_ROOT, jobId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function ensureOutputs(): Promise<string> {
  await fs.mkdir(OUTPUTS_ROOT, { recursive: true });
  return OUTPUTS_ROOT;
}

export function jobPath(jobId: string, ...rest: string[]): string {
  assertSafeJobId(jobId);
  return path.join(REELSAFE_ROOT, jobId, ...rest);
}

export async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** File slots used across the reel-safe pipeline. Keep centralized so refactors
 *  don't scatter magic strings. */
export const REELSAFE_FILES = {
  status: "status.json",
  source: "source.mp4",
  watermark: "watermark.png",
  plan: "plan.json",
  output: "output.mp4",
} as const;

export function brollPath(jobId: string, idx: number): string {
  return jobPath(jobId, `broll-${idx.toString().padStart(2, "0")}.mp4`);
}

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Best-effort sweep of job workspaces older than 7 days. Called from the
 *  submit route on each new job. Never throws. */
export async function sweepOldJobs(now = Date.now()): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(REELSAFE_ROOT);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    return;
  }
  await Promise.all(
    entries.map(async (name) => {
      const dir = path.join(REELSAFE_ROOT, name);
      try {
        const stat = await fs.stat(dir);
        if (!stat.isDirectory()) return;
        if (now - stat.mtimeMs < MAX_AGE_MS) return;
        await fs.rm(dir, { recursive: true, force: true });
      } catch {
        // ignore individual failures
      }
    }),
  );
}
