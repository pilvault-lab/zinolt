import { NextResponse } from "next/server";
import { buildDailyMovers, type DailyMoversPayload } from "@/lib/daily-movers";

export const runtime = "nodejs";

type CacheEntry = { at: number; payload: DailyMoversPayload };
const cache = new Map<string, CacheEntry>();

const CACHE_TTL_MS = 15 * 60 * 1000;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const overrideParam = url.searchParams.get("symbols");
  const overrideSymbols = overrideParam
    ? overrideParam
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter((s) => /^[A-Z.\-]{1,8}$/.test(s))
        .slice(0, 5)
    : undefined;

  const cacheKey = overrideSymbols ? `o:${overrideSymbols.join(",")}` : "auto";
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json(cached.payload, {
      headers: { "x-cache": "hit" },
    });
  }

  const built = await buildDailyMovers(overrideSymbols);
  if ("error" in built) {
    return NextResponse.json(
      { error: built.error, hint: "Yahoo spark returned no quotes." },
      { status: 502 },
    );
  }

  cache.set(cacheKey, { at: Date.now(), payload: built });
  return NextResponse.json(built, { headers: { "x-cache": "miss" } });
}
