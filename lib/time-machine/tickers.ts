export type Ticker = {
  /** Uppercase symbol, no exchange suffix (added by data layer). */
  symbol: string;
  /** Display name for the tile / composition. */
  name: string;
  /** Path under /public. Missing file falls back to text wordmark. */
  logo: string;
};

export const CURATED_TICKERS: readonly Ticker[] = [
  { symbol: "NVDA", name: "NVIDIA",    logo: "/time-machine/logos/NVDA.svg" },
  { symbol: "AAPL", name: "Apple",     logo: "/time-machine/logos/AAPL.svg" },
  { symbol: "TSLA", name: "Tesla",     logo: "/time-machine/logos/TSLA.svg" },
  { symbol: "AMZN", name: "Amazon",    logo: "/time-machine/logos/AMZN.svg" },
  { symbol: "MSFT", name: "Microsoft", logo: "/time-machine/logos/MSFT.svg" },
  { symbol: "GOOG", name: "Google",    logo: "/time-machine/logos/GOOG.svg" },
  { symbol: "META", name: "Meta",      logo: "/time-machine/logos/META.svg" },
  { symbol: "NFLX", name: "Netflix",   logo: "/time-machine/logos/NFLX.svg" },
  { symbol: "AMD",  name: "AMD",       logo: "/time-machine/logos/AMD.svg"  },
  { symbol: "PLTR", name: "Palantir",  logo: "/time-machine/logos/PLTR.svg" },
  { symbol: "SHOP", name: "Shopify",   logo: "/time-machine/logos/SHOP.svg" },
  { symbol: "COST", name: "Costco",    logo: "/time-machine/logos/COST.svg" },
  { symbol: "LLY",  name: "Eli Lilly", logo: "/time-machine/logos/LLY.svg"  },
  { symbol: "SMCI", name: "Super Micro", logo: "/time-machine/logos/SMCI.svg" },
  { symbol: "HOOD", name: "Robinhood", logo: "/time-machine/logos/HOOD.svg" },
] as const;

export const TIME_MACHINE_YEARS: readonly number[] = Array.from(
  { length: 2022 - 2000 + 1 },
  (_, i) => 2000 + i,
);

export const TIME_MACHINE_AMOUNTS: readonly number[] = [100, 500, 1000, 10000];
export const DEFAULT_AMOUNT = 1000;
export const DEFAULT_YEAR = 2016;
export const DEFAULT_SYMBOL = "NVDA";

export function findCuratedTicker(symbol: string): Ticker | undefined {
  const s = symbol.trim().toUpperCase();
  return CURATED_TICKERS.find((t) => t.symbol === s);
}
