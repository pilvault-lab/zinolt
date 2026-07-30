import { NextResponse } from "next/server";
import {
  buildPortfolio,
  type PortfolioResult,
} from "@/lib/time-machine/portfolio";

export const runtime = "nodejs";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type CacheEntry = { at: number; rows: Array<{ date: string; close: number }> };
const priceCache = new Map<string, CacheEntry>();

/**
 * Fetch monthly split-adjusted closes from Yahoo Finance's public chart API.
 * Stooq was the first choice but it now serves a JS-challenge instead of the
 * CSV, so Yahoo is the reliable no-key source.
 */
async function fetchMonthly(
  symbol: string,
): Promise<Array<{ date: string; close: number }> | null> {
  const key = symbol.toUpperCase();
  const cached = priceCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.rows;

  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/` +
    `${encodeURIComponent(key)}?range=25y&interval=1mo`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: {
      // A real UA — Yahoo returns 401 for empty/bot UAs.
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      accept: "application/json",
    },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: { adjclose?: Array<{ adjclose?: Array<number | null> }> };
      }>;
      error?: unknown;
    };
  };
  const r = json.chart?.result?.[0];
  const ts = r?.timestamp;
  const adj = r?.indicators?.adjclose?.[0]?.adjclose;
  if (!ts || !adj || ts.length === 0 || ts.length !== adj.length) return null;

  const rows: Array<{ date: string; close: number }> = [];
  for (let i = 0; i < ts.length; i++) {
    const v = adj[i];
    if (v == null || !Number.isFinite(v)) continue;
    rows.push({
      date: new Date(ts[i] * 1000).toISOString().slice(0, 10),
      close: v,
    });
  }
  if (rows.length === 0) return null;
  priceCache.set(key, { at: Date.now(), rows });
  return rows;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = (url.searchParams.get("ticker") ?? "").trim().toUpperCase();
  const year = Number(url.searchParams.get("year"));
  const amount = Number(url.searchParams.get("amount"));

  if (!/^[A-Z]{1,6}$/.test(symbol)) {
    return NextResponse.json({ error: "invalid_ticker" }, { status: 400 });
  }
  if (!Number.isFinite(year) || year < 1980 || year > new Date().getFullYear()) {
    return NextResponse.json({ error: "invalid_year" }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
    return NextResponse.json({ error: "invalid_amount" }, { status: 400 });
  }

  const rows = await fetchMonthly(symbol);
  if (!rows) {
    return NextResponse.json(
      { error: "ticker_not_found", symbol },
      { status: 404 },
    );
  }

  const built = buildPortfolio(rows, symbol, year, amount);
  if ("error" in built) {
    return NextResponse.json(
      { error: built.error, symbol, year },
      { status: 404 },
    );
  }

  const result: PortfolioResult = built;
  return NextResponse.json(result, {
    headers: {
      // Client-safe cache — data is monthly, refreshed daily is fine.
      "cache-control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
