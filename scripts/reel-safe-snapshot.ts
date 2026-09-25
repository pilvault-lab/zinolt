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

  console.log("Installing static ffmpeg…");
  const ffmpeg = await sandbox.runCommand("sh", [
    "-c",
    [
      "set -e",
      "cd /tmp",
      "curl -sL https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz -o ffmpeg.tar.xz",
      "mkdir -p ffmpeg-static && tar -xJf ffmpeg.tar.xz -C ffmpeg-static --strip-components=1",
      "sudo mv ffmpeg-static/ffmpeg ffmpeg-static/ffprobe /usr/local/bin/",
      "sudo chmod a+rx /usr/local/bin/ffmpeg /usr/local/bin/ffprobe",
      "rm -rf ffmpeg.tar.xz ffmpeg-static",
    ].join(" && ") + " 2>&1",
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
