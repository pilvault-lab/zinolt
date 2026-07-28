import { spawn, type SpawnOptions } from "node:child_process";

/** Run a shell command, capturing stdout + stderr. Never throws for non-zero
 *  exit — returns { code, stdout, stderr } so callers can surface stderr as
 *  a readable message to the UI. */
export function runCommand(
  cmd: string,
  args: string[],
  opts: { cwd?: string; onStderr?: (chunk: string) => void; timeoutMs?: number } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const spawnOpts: SpawnOptions = {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      // Windows needs shell:true so `.cmd` shims resolve from PATH consistently.
      shell: process.platform === "win32",
    };
    const child = spawn(cmd, args, spawnOpts);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const s = chunk.toString();
      stderr += s;
      opts.onStderr?.(s);
    });
    let killed = false;
    const timeout = opts.timeoutMs
      ? setTimeout(() => {
          killed = true;
          child.kill("SIGKILL");
        }, opts.timeoutMs)
      : null;
    child.on("error", (err) => {
      if (timeout) clearTimeout(timeout);
      reject(err);
    });
    child.on("close", (code) => {
      if (timeout) clearTimeout(timeout);
      if (killed) {
        resolve({ code: 124, stdout, stderr: stderr + "\n[killed: timeout]" });
        return;
      }
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/** Extract the most useful line from stderr for the UI. ffmpeg dumps a lot of
 *  noise; the last "Error" / "Invalid" line is usually the actionable one. */
export function extractStderrSummary(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const errorLine = [...lines]
    .reverse()
    .find((l) => /^(error|invalid|failed)/i.test(l));
  return errorLine ?? lines[lines.length - 1] ?? "Unknown error.";
}

export type ToolCheck = { ok: true } | { ok: false; error: string };

export async function checkTool(cmd: string, args: string[] = ["-version"]): Promise<ToolCheck> {
  try {
    const { code, stderr } = await runCommand(cmd, args, { timeoutMs: 10_000 });
    if (code === 0) return { ok: true };
    return { ok: false, error: `${cmd} exited ${code}: ${extractStderrSummary(stderr)}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `${cmd} not found on PATH (${msg}). Install it and try again.` };
  }
}

export async function requireFfmpeg(): Promise<void> {
  const r = await checkTool("ffmpeg", ["-version"]);
  if (!r.ok) throw new Error(r.error);
}

export async function requireFfprobe(): Promise<void> {
  const r = await checkTool("ffprobe", ["-version"]);
  if (!r.ok) throw new Error(r.error);
}
