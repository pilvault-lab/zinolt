import type { WireSource } from "../sources";
import { makeSnippet, toIso, type WireItem } from "../types";

// Polymarket Gamma API market payload. Only the fields we use are typed;
// the response has many more we ignore.
type GammaMarket = {
  id?: string;
  slug?: string;
  question?: string;
  description?: string;
  volume24hr?: number | string;
  outcomes?: string | string[];
  outcomePrices?: string | string[];
  startDate?: string;
  endDate?: string;
  closed?: boolean;
};

function parseMaybeJsonArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (!trimmed) return [];
    try {
      const p = JSON.parse(trimmed);
      return Array.isArray(p) ? p.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function formatOdds(m: GammaMarket): string {
  const outcomes = parseMaybeJsonArray(m.outcomes);
  const prices = parseMaybeJsonArray(m.outcomePrices);
  if (outcomes.length === 0 || prices.length === 0) return "";
  // Binary market — surface just the Yes price for brevity.
  if (outcomes.length === 2) {
    const yesIdx = outcomes.findIndex((o) => o.toLowerCase() === "yes");
    const idx = yesIdx >= 0 ? yesIdx : 0;
    const pct = Math.round(Number(prices[idx]) * 100);
    if (Number.isFinite(pct)) return `${outcomes[idx]} ${pct}%`;
    return "";
  }
  // Multi-outcome — top 2 by price.
  const paired = outcomes
    .map((o, i) => ({ o, p: Number(prices[i] ?? 0) }))
    .filter((x) => Number.isFinite(x.p))
    .sort((a, b) => b.p - a.p)
    .slice(0, 2);
  return paired.map((x) => `${x.o} ${Math.round(x.p * 100)}%`).join(" · ");
}

export async function fetchPolymarket(source: WireSource): Promise<WireItem[]> {
  const res = await fetch(source.url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`polymarket ${res.status} ${res.statusText}`);
  const json = (await res.json()) as GammaMarket[] | { data?: GammaMarket[] };
  const markets: GammaMarket[] = Array.isArray(json)
    ? json
    : (json?.data ?? []);

  const items: WireItem[] = [];
  for (const m of markets) {
    const question = (m.question ?? "").trim();
    if (!question || !m.slug) continue;
    const odds = formatOdds(m);
    const title = odds ? `${question} — ${odds}` : question;
    const url = `https://polymarket.com/event/${m.slug}`;
    const vol = typeof m.volume24hr === "string" ? Number(m.volume24hr) : m.volume24hr;
    items.push({
      url,
      title,
      snippet: makeSnippet(m.description ?? ""),
      sourceName: source.name,
      category: source.category,
      publishedAt: toIso(m.startDate),
      score: typeof vol === "number" && Number.isFinite(vol) ? Math.round(vol) : undefined,
    });
  }
  return items;
}
