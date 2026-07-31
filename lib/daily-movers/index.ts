import {
  fetchIntraday5m,
  fetchSparkBatch,
  type SparkQuote,
} from "../market-data";
import { DAILY_MOVERS_UNIVERSE, universeMap } from "./universe";

export type MoverPoint = {
  /** Minutes elapsed since regular session open. */
  minute: number;
  /** % change from the regular-session opening print. */
  pct: number;
};

export type Mover = {
  symbol: string;
  name: string;
  changePercent: number;
  price: number;
  previousClose: number;
  /** Intraday % from open. */
  intraday: MoverPoint[];
  sessionTime: number;
};

export type DailyMoversPayload = {
  dateLabel: string;
  sessionDate: string;
  picks: Mover[];
  /** Larger pool for editorial swap (top 10 by |%|). */
  pool: Array<{
    symbol: string;
    shortName: string;
    regularMarketChangePercent: number;
  }>;
  stale: boolean;
};

const PICK_COUNT = 5;
const POOL_SIZE = 10;

function formatDateLabel(unixSec: number): { label: string; iso: string } {
  const d = new Date(unixSec * 1000);
  const weekday = d
    .toLocaleDateString("en-US", { weekday: "short", timeZone: "America/New_York" })
    .toUpperCase();
  const month = d
    .toLocaleDateString("en-US", { month: "short", timeZone: "America/New_York" })
    .toUpperCase();
  const day = d.toLocaleDateString("en-US", {
    day: "numeric",
    timeZone: "America/New_York",
  });
  const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  return { label: `${weekday} · ${month} ${day}`, iso };
}

/**
 * Build the payload used by the composition.
 *  - overrideSymbols: user-picked (intersected with universe), up to 5
 */
export async function buildDailyMovers(
  overrideSymbols?: string[],
): Promise<DailyMoversPayload | { error: "no_data" }> {
  const universeSymbols = DAILY_MOVERS_UNIVERSE.map((t) => t.symbol);
  const quotes = await fetchSparkBatch(universeSymbols);
  if (quotes.length === 0) return { error: "no_data" };

  const ranked = [...quotes].sort(
    (a, b) =>
      Math.abs(b.regularMarketChangePercent) -
      Math.abs(a.regularMarketChangePercent),
  );

  let pickQuotes: SparkQuote[];
  if (overrideSymbols && overrideSymbols.length > 0) {
    const wanted = new Set(overrideSymbols.map((s) => s.toUpperCase()));
    pickQuotes = ranked.filter((q) => wanted.has(q.symbol)).slice(0, PICK_COUNT);
    if (pickQuotes.length < PICK_COUNT) {
      for (const q of ranked) {
        if (pickQuotes.length >= PICK_COUNT) break;
        if (!pickQuotes.some((p) => p.symbol === q.symbol)) pickQuotes.push(q);
      }
    }
  } else {
    pickQuotes = ranked.slice(0, PICK_COUNT);
  }

  // 5m intraday only — no 1y daily anymore.
  const intraSeries = await Promise.all(
    pickQuotes.map((q) => fetchIntraday5m(q.symbol)),
  );

  const picks: Mover[] = [];
  for (let i = 0; i < pickQuotes.length; i++) {
    const q = pickQuotes[i];
    const s = intraSeries[i];
    if (!s || s.bars.length < 2) continue;
    const openTime = s.bars[0].time;
    // Baseline = PREVIOUS CLOSE (not session open). This guarantees the
    // final intraday bar equals the headline `changePercent`, so the chart's
    // final ordering matches the headline ranking (e.g. CORT +27.29% will
    // finish above NBIS +27.13% even if NBIS rallied more intraday-from-open).
    // Consequence: first bar isn't 0 — it's the opening gap.
    const prevClose = q.chartPreviousClose;
    const intraday: MoverPoint[] = s.bars.map((b) => ({
      minute: Math.round((b.time - openTime) / 60),
      pct: ((b.close - prevClose) / prevClose) * 100,
    }));
    const u = universeMap.get(q.symbol);
    picks.push({
      symbol: q.symbol,
      name: u?.shortName ?? q.symbol,
      changePercent: q.regularMarketChangePercent,
      price: q.regularMarketPrice,
      previousClose: q.chartPreviousClose,
      intraday,
      sessionTime: s.latestTime,
    });
  }
  if (picks.length === 0) return { error: "no_data" };

  const anchorTime = picks[0].sessionTime;
  const { label, iso } = formatDateLabel(anchorTime);
  const stale = Date.now() - anchorTime * 1000 > 1000 * 60 * 60 * 20;

  return {
    dateLabel: label,
    sessionDate: iso,
    picks,
    pool: ranked.slice(0, POOL_SIZE).map((q) => ({
      symbol: q.symbol,
      shortName: universeMap.get(q.symbol)?.shortName ?? q.symbol,
      regularMarketChangePercent: q.regularMarketChangePercent,
    })),
    stale,
  };
}
