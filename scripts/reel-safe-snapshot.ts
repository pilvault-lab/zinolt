// One-off helper: build a Vercel Sandbox snapshot with ffmpeg + @vercel/blob
// pre-installed. After running, set REEL_SAFE_SANDBOX_SNAPSHOT_ID in the
// project's env vars — subsequent sandbox spawns start in ~1s instead of ~30s.
//
// Run:
//   npx tsx scripts/reel-safe-snapshot.ts
//
// Requires VERCEL_TOKEN + VERCEL_TEAM_ID + VERCEL_PROJECT_ID in env (or run
// this from a Vercel deployment where OIDC auth is automatic).

import { Sandbox } from "@vercel/sandbox";

async function main(): Promise<void> {
  console.log("Creating base sandbox…");
  const sandbox = await Sandbox.create({
    runtime: "node24",
    timeout: 10 * 60_000,
  });

  console.log("Installing ffmpeg-free…");
  const ffmpeg = await sandbox.runCommand("sh", [
    "-c",
    "sudo dnf install -y ffmpeg-free 2>&1",
  ]);
  if (ffmpeg.exitCode !== 0) {
    console.error(await ffmpeg.stderr());
    throw new Error(`ffmpeg install failed (${ffmpeg.exitCode}).`);
  }

  console.log("Installing @vercel/blob into /work…");
  await sandbox.runCommand("mkdir", ["-p", "/work"]);
  const npm = await sandbox.runCommand("sh", [
    "-c",
    "cd /work && npm init -y >/dev/null && npm install @vercel/blob --no-audit --no-fund 2>&1",
  ]);
  if (npm.exitCode !== 0) {
    console.error(await npm.stderr());
    throw new Error(`npm install failed (${npm.exitCode}).`);
  }

  console.log("Snapshotting…");
  const snapshot = await sandbox.snapshot();
  await sandbox.stop().catch(() => {});

  console.log("\nSnapshot ready.");
  console.log(`Set REEL_SAFE_SANDBOX_SNAPSHOT_ID=${snapshot.snapshotId}`);
  console.log("Then `vercel env add REEL_SAFE_SANDBOX_SNAPSHOT_ID production` (and preview).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
