/**
 * Yahoo Finance unofficial API isolation layer.
 * Every network call to Yahoo lives here so the day the endpoints break
 * (they will), we swap the guts of this file without touching consumers.
 *
 * DO NOT import Yahoo URLs anywhere else in the codebase.
 */

const YH_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

const commonHeaders = {
  "user-agent": YH_UA,
  accept: "application/json",
};

export type ScreenerQuote = {
  symbol: string;
  shortName: string;
  longName?: string;
  regularMarketPrice: number;
  regularMarketPreviousClose: number;
  regularMarketChange: number;
  regularMarketChangePercent: number;
  regularMarketTime: number; // unix seconds
  marketCap: number;
};

export type IntradayBar = {
  /** Unix seconds. */
  time: number;
  close: number;
};

export type IntradaySeries = {
  symbol: string;
  /** Regular-session bars only, sorted by time asc. */
  bars: IntradayBar[];
  /** Regular-session opening print. */
  regularMarketOpen: number;
  /** Prior day's close. */
  previousClose: number;
  /** Latest close in the series. */
  latestClose: number;
  /** Timestamp of latest bar (unix seconds). */
  latestTime: number;
};

async function yhFetch<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: commonHeaders,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function fetchScreener(
  scrId: "day_gainers" | "day_losers",
  count: number,
): Promise<ScreenerQuote[]> {
  const url =
    `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved` +
    `?scrIds=${scrId}&count=${count}&formatted=false&lang=en-US&region=US`;
  const json = await yhFetch<{
    finance?: { result?: Array<{ quotes?: unknown[] }> };
  }>(url);
  const quotes = json?.finance?.result?.[0]?.quotes ?? [];
  const out: ScreenerQuote[] = [];
  for (const raw of quotes) {
    const q = raw as Partial<ScreenerQuote>;
    if (
      typeof q.symbol !== "string" ||
      typeof q.regularMarketChangePercent !== "number" ||
      typeof q.marketCap !== "number" ||
      typeof q.regularMarketPrice !== "number" ||
      typeof q.regularMarketPreviousClose !== "number" ||
      typeof q.regularMarketTime !== "number"
    ) {
      continue;
    }
    out.push({
      symbol: q.symbol,
      shortName: q.shortName ?? q.longName ?? q.symbol,
      longName: q.longName,
      regularMarketPrice: q.regularMarketPrice,
      regularMarketPreviousClose: q.regularMarketPreviousClose,
      regularMarketChange:
        q.regularMarketChange ?? q.regularMarketPrice - q.regularMarketPreviousClose,
      regularMarketChangePercent: q.regularMarketChangePercent,
      regularMarketTime: q.regularMarketTime,
      marketCap: q.marketCap,
    });
  }
  return out;
}

export async function fetchDayGainers(count = 100): Promise<ScreenerQuote[]> {
  return fetchScreener("day_gainers", count);
}

export async function fetchDayLosers(count = 100): Promise<ScreenerQuote[]> {
  return fetchScreener("day_losers", count);
}

/**
 * Batch quote via Yahoo's v7 spark endpoint. This is the ONE endpoint that
 * still returns useful quote data for arbitrary symbols without a crumb.
 * Returns null entries for symbols Yahoo dropped or rejected.
 */
export type SparkQuote = {
  symbol: string;
  regularMarketPrice: number;
  chartPreviousClose: number;
  regularMarketChangePercent: number;
  regularMarketTime: number;
};

export async function fetchSparkBatch(
  symbols: string[],
): Promise<SparkQuote[]> {
  if (symbols.length === 0) return [];
  // Yahoo's spark endpoint hard-limits at 20 symbols per request (400s above).
  const CHUNK = 20;
  const chunks: string[][] = [];
  for (let i = 0; i < symbols.length; i += CHUNK) {
    chunks.push(symbols.slice(i, i + CHUNK));
  }
  type SparkJson = {
    spark?: {
      result?: Array<{
        symbol: string;
        response?: Array<{
          meta?: {
            regularMarketPrice?: number;
            chartPreviousClose?: number;
            regularMarketTime?: number;
          };
        }>;
      }>;
    };
  };
  // Fire chunks in parallel — ~8 chunks for a 150-ticker universe.
  const jsons = await Promise.all(
    chunks.map((chunk) =>
      yhFetch<SparkJson>(
        `https://query1.finance.yahoo.com/v7/finance/spark` +
          `?symbols=${chunk.map(encodeURIComponent).join(",")}` +
          `&interval=1d&range=1d`,
      ),
    ),
  );
  const all: SparkQuote[] = [];
  for (const json of jsons) {
    const results = json?.spark?.result ?? [];
    for (const r of results) {
      const meta = r.response?.[0]?.meta;
      if (
        !meta ||
        typeof meta.regularMarketPrice !== "number" ||
        typeof meta.chartPreviousClose !== "number" ||
        typeof meta.regularMarketTime !== "number"
      ) {
        continue;
      }
      const chgPct =
        ((meta.regularMarketPrice - meta.chartPreviousClose) /
          meta.chartPreviousClose) *
        100;
      all.push({
        symbol: r.symbol,
        regularMarketPrice: meta.regularMarketPrice,
        chartPreviousClose: meta.chartPreviousClose,
        regularMarketChangePercent: chgPct,
        regularMarketTime: meta.regularMarketTime,
      });
    }
  }
  return all;
}

export type DailyBar = { date: string; close: number };

/** 1-year daily closes (split/dividend adjusted via 'close' from Yahoo). */
export async function fetchDaily1y(symbol: string): Promise<DailyBar[] | null> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/` +
    `${encodeURIComponent(symbol)}?interval=1d&range=1y`;
  const json = await yhFetch<{
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: { quote?: Array<{ close?: Array<number | null> }> };
      }>;
    };
  }>(url);
  const r = json?.chart?.result?.[0];
  const ts = r?.timestamp;
  const closes = r?.indicators?.quote?.[0]?.close;
  if (!ts || !closes || ts.length === 0) return null;
  const bars: DailyBar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (c == null || !Number.isFinite(c)) continue;
    bars.push({
      date: new Date(ts[i] * 1000).toISOString().slice(0, 10),
      close: c,
    });
  }
  return bars.length ? bars : null;
}

/** 5-minute intraday bars for the current (or most-recent) session. */
export async function fetchIntraday5m(symbol: string): Promise<IntradaySeries | null> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/` +
    `${encodeURIComponent(symbol)}?interval=5m&range=1d&includePrePost=false`;
  const json = await yhFetch<{
    chart?: {
      result?: Array<{
        meta?: {
          regularMarketPrice?: number;
          previousClose?: number;
          chartPreviousClose?: number;
          regularMarketTime?: number;
        };
        timestamp?: number[];
        indicators?: { quote?: Array<{ close?: Array<number | null> }> };
      }>;
    };
  }>(url);
  const r = json?.chart?.result?.[0];
  const meta = r?.meta;
  const ts = r?.timestamp;
  const closes = r?.indicators?.quote?.[0]?.close;
  if (!meta || !ts || !closes || ts.length === 0) return null;

  const bars: IntradayBar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (c == null || !Number.isFinite(c)) continue;
    bars.push({ time: ts[i], close: c });
  }
  if (bars.length < 2) return null;

  // Regular session opening print = first bar of the session.
  const regularMarketOpen = bars[0].close;
  const previousClose = meta.chartPreviousClose ?? meta.previousClose ?? regularMarketOpen;
  const latestClose = bars[bars.length - 1].close;
  const latestTime = bars[bars.length - 1].time;

  return {
    symbol: symbol.toUpperCase(),
    bars,
    regularMarketOpen,
    previousClose,
    latestClose,
    latestTime,
  };
}
