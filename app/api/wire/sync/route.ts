import { NextResponse } from "next/server";
import { fetchSource } from "@/lib/wire/fetchers";
import { WIRE_SOURCES } from "@/lib/wire/sources";
import { cleanupOld, insertItems } from "@/lib/wire/db";

// node:sqlite + rss-parser both require the full Node runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PerSource = {
  name: string;
  fetched: number;
  new: number;
  error?: string;
};

export async function POST() {
  const enabled = WIRE_SOURCES.filter((s) => s.enabled);

  const results = await Promise.all(
    enabled.map(async (s): Promise<PerSource> => {
      try {
        const items = await fetchSource(s);
        const inserted = insertItems(items);
        return { name: s.name, fetched: items.length, new: inserted };
      } catch (err) {
        return {
          name: s.name,
          fetched: 0,
          new: 0,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  // Best-effort cleanup — a failure here should not fail the sync.
  let deleted = 0;
  try {
    deleted = cleanupOld(14);
  } catch {
    // swallow — the store is still usable
  }

  const totalNew = results.reduce((n, r) => n + r.new, 0);
  return NextResponse.json({ perSource: results, totalNew, deleted });
}
