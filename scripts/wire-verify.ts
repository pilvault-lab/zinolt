// Run: npx tsx scripts/wire-verify.ts
// Verifies every seeded source returns real items. Prints a summary and exits
// non-zero if any enabled source fails.

import { fetchSource } from "../lib/wire/fetchers";
import { WIRE_SOURCES } from "../lib/wire/sources";

async function main() {
  const enabled = WIRE_SOURCES.filter((s) => s.enabled);
  console.log(`Verifying ${enabled.length} enabled sources...\n`);

  const results = await Promise.all(
    enabled.map(async (s) => {
      const t0 = Date.now();
      try {
        const items = await fetchSource(s);
        return { s, ok: true, count: items.length, ms: Date.now() - t0 };
      } catch (err) {
        return {
          s,
          ok: false,
          count: 0,
          ms: Date.now() - t0,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  const nameWidth = Math.max(...results.map((r) => r.s.name.length));
  for (const r of results) {
    const mark = r.ok ? (r.count > 0 ? "OK " : "EMPTY") : "FAIL";
    const line =
      `${mark.padEnd(5)}  ` +
      `${r.s.name.padEnd(nameWidth)}  ` +
      `${String(r.count).padStart(3)} items  ` +
      `${String(r.ms).padStart(5)}ms  ` +
      `${r.s.type}`;
    console.log(line);
    if (!r.ok) console.log(`       ↳ ${(r as { error?: string }).error}`);
  }

  const failed = results.filter((r) => !r.ok);
  const empty = results.filter((r) => r.ok && r.count === 0);
  console.log(
    `\nSummary: ${results.length - failed.length - empty.length} live, ${empty.length} empty, ${failed.length} failed`,
  );

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
