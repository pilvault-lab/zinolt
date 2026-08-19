/**
 * Batch runner — build + render N rankings sequentially from a directory
 * of manifests. Continues on individual failures and prints a summary.
 *
 * Usage:
 *   npx tsx scripts/build-rankings-batch.ts scripts/rankings/pending/
 *   npx tsx scripts/build-rankings-batch.ts scripts/rankings/pending/ --no-render
 *
 * Input: any directory containing *.json manifest files. Each file is a
 * manifest per scripts/build-ranking.ts. Files are processed in alphabetical
 * order.
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

function run(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    // shell:true so Windows can find npx (.cmd) and quotes on nested args
    // survive the trip through cmd.exe.
    const child = spawn(cmd, args, {
      stdio: "inherit",
      windowsHide: true,
      shell: process.platform === "win32",
      env: process.env,
    });
    child.on("close", (code) => resolve(code ?? -1));
    child.on("error", () => resolve(-1));
  });
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 1) {
    console.error("Usage: build-rankings-batch.ts <manifests-dir> [--no-render] [--top-n N]");
    process.exit(1);
  }
  const dir = resolve(argv[0]);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    console.error(`Not a directory: ${dir}`);
    process.exit(1);
  }
  const passthrough = argv.slice(1);

  const manifestFiles = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => join(dir, f));

  if (manifestFiles.length === 0) {
    console.log(`No *.json manifests in ${dir}`);
    return;
  }

  console.log(`▶ Batch: ${manifestFiles.length} manifests in ${dir}`);
  const results: { file: string; slug: string; ok: boolean; error?: string }[] = [];
  const startTs = Date.now();

  for (const file of manifestFiles) {
    const slug = file.replace(/\\/g, "/").split("/").pop()!.replace(/\.json$/, "");
    console.log(`\n════════════════════════════════════════════════════════════════════`);
    console.log(`▶ [${results.length + 1}/${manifestFiles.length}] ${slug}`);
    console.log(`════════════════════════════════════════════════════════════════════\n`);
    const code = await run("npx", ["tsx", "scripts/build-ranking.ts", "--manifest", file, ...passthrough]);
    results.push({ file, slug, ok: code === 0, error: code === 0 ? undefined : `exit ${code}` });
  }

  const dur = ((Date.now() - startTs) / 60_000).toFixed(1);
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n════════════════════════════════════════════════════════════════════`);
  console.log(`Batch done — ${ok}/${results.length} succeeded in ${dur} min`);
  console.log(`════════════════════════════════════════════════════════════════════`);
  for (const r of results) {
    const mark = r.ok ? "✓" : "✗";
    console.log(`  ${mark} ${r.slug}${r.error ? `  (${r.error})` : ""}`);
  }
  if (ok < results.length) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
