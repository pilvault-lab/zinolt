import type { WireSource } from "../sources";
import { makeSnippet, toIso, type WireItem } from "../types";

// Kalshi's v2 trade-api events endpoint. Nested markets give us pricing
// and 24h volume; we roll those up per event and take the top N by volume.
// Public — no auth required for read-only market data.
type KalshiMarket = {
  ticker?: string;
  title?: string;
  yes_sub_title?: string;
  no_sub_title?: string;
  last_price_dollars?: string;
  yes_bid_dollars?: string;
  yes_ask_dollars?: string;
  volume_24h_fp?: string;
  volume_fp?: string;
  status?: string;
};

type KalshiEvent = {
  event_ticker?: string;
  series_ticker?: string;
  title?: string;
  sub_title?: string;
  category?: string;
  markets?: KalshiMarket[];
};

type KalshiEventsResponse = {
  events?: KalshiEvent[];
  cursor?: string;
};

// Skip sports/entertainment — this feed is meant for finance + world + macro
// signal. Kalshi assigns each event a top-level category; the exact strings
// come straight from the API.
const SKIP_CATEGORIES = new Set(["Sports", "Entertainment"]);

const TOP_N = 15;

function num(s: string | undefined): number {
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function formatOdds(m: KalshiMarket): string {
  // Kalshi prices are 0-1 dollars. Prefer last_price, fall back to yes_bid.
  const last = num(m.last_price_dollars);
  const bid = num(m.yes_bid_dollars);
  const p = last > 0 ? last : bid;
  if (p <= 0) return "";
  const pct = Math.round(p * 100);
  const label = m.yes_sub_title?.trim() || "Yes";
  return `${label} ${pct}%`;
}

export async function fetchKalshi(source: WireSource): Promise<WireItem[]> {
  // Widen the initial fetch beyond TOP_N so we can filter categories and
  // still hit the target after skips.
  const url = new URL(source.url);
  url.searchParams.set("limit", "100");
  url.searchParams.set("with_nested_markets", "true");

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`kalshi ${res.status} ${res.statusText}`);
  const json = (await res.json()) as KalshiEventsResponse;
  const events = json.events ?? [];

  // Roll up 24h volume across nested markets per event, then take the top.
  type Ranked = {
    event: KalshiEvent;
    volume24h: number;
    topMarket: KalshiMarket | null;
  };
  const ranked: Ranked[] = [];
  for (const e of events) {
    if (e.category && SKIP_CATEGORIES.has(e.category)) continue;
    if (!e.title || !e.event_ticker) continue;

    const markets = e.markets ?? [];
    if (markets.length === 0) continue;

    const activeMarkets = markets.filter((m) => m.status === "active");
    if (activeMarkets.length === 0) continue;

    const volume24h = activeMarkets.reduce(
      (n, m) => n + num(m.volume_24h_fp),
      0,
    );
    // Pick the market with the highest last_price to display odds for —
    // that's typically the "leading" outcome in a multi-market event.
    const topMarket =
      activeMarkets
        .slice()
        .sort((a, b) => num(b.last_price_dollars) - num(a.last_price_dollars))[0] ??
      null;

    ranked.push({ event: e, volume24h, topMarket });
  }

  ranked.sort((a, b) => b.volume24h - a.volume24h);
  const top = ranked.slice(0, TOP_N);

  return top.map(({ event, volume24h, topMarket }) => {
    const odds = topMarket ? formatOdds(topMarket) : "";
    const question = event.title!.trim();
    const title = odds ? `${question} — ${odds}` : question;
    // Kalshi's public URLs use the lowercased event ticker. This resolves
    // to the event page or to its series page as a fallback.
    const eventUrl = `https://kalshi.com/markets/${event.event_ticker!.toLowerCase()}`;
    return {
      url: eventUrl,
      title,
      snippet: makeSnippet(event.sub_title ?? event.category ?? ""),
      sourceName: source.name,
      category: source.category,
      // Kalshi doesn't expose an event "created" timestamp on the events
      // endpoint, so use "now" so recent syncs surface these fresh.
      publishedAt: toIso(new Date()),
      score: Math.round(volume24h),
    };
  });
}
