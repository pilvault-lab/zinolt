import { promises as fs } from "node:fs";
import path from "node:path";

// Sandbox-scratch root. On Vercel Sandbox this is a real, writable filesystem
// inside the microVM; on any other host (local dev worker) it's still just a
// tmp dir. We never write to it from the Next.js function itself — that path
// is read-only outside /tmp on Vercel serverless.
const REELSAFE_ROOT = "/tmp/reel-safe";

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

export async function ensureJobDir(jobId: string): Promise<string> {
  assertSafeJobId(jobId);
  const dir = path.join(REELSAFE_ROOT, jobId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
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
