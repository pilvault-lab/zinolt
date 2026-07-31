/**
 * Curated Daily Movers universe.
 *
 * Seed = S&P 100 + culturally prominent names (fintech, meme, EV, AI,
 * crypto-adjacent). Edit freely — add/remove tickers, refine shortNames.
 *
 * Rules:
 *  - Symbol must be a valid Yahoo Finance ticker (BRK-B not BRK.B).
 *  - shortName is what appears under the ticker on the card; keep concise
 *    (fits in ~32 chars comfortably at the card's typography).
 */

export type UniverseTicker = {
  symbol: string;
  shortName: string;
};

export const DAILY_MOVERS_UNIVERSE: readonly UniverseTicker[] = [
  // ─── Mega-cap tech ───
  { symbol: "AAPL",  shortName: "Apple" },
  { symbol: "MSFT",  shortName: "Microsoft" },
  { symbol: "NVDA",  shortName: "NVIDIA" },
  { symbol: "GOOGL", shortName: "Alphabet" },
  { symbol: "GOOG",  shortName: "Alphabet C" },
  { symbol: "AMZN",  shortName: "Amazon" },
  { symbol: "META",  shortName: "Meta" },
  { symbol: "TSLA",  shortName: "Tesla" },
  { symbol: "AVGO",  shortName: "Broadcom" },
  { symbol: "ORCL",  shortName: "Oracle" },
  { symbol: "CRM",   shortName: "Salesforce" },
  { symbol: "ADBE",  shortName: "Adobe" },
  { symbol: "NFLX",  shortName: "Netflix" },
  { symbol: "AMD",   shortName: "AMD" },
  { symbol: "INTC",  shortName: "Intel" },
  { symbol: "IBM",   shortName: "IBM" },
  { symbol: "CSCO",  shortName: "Cisco" },
  { symbol: "QCOM",  shortName: "Qualcomm" },
  { symbol: "TXN",   shortName: "Texas Instruments" },
  { symbol: "MU",    shortName: "Micron" },
  { symbol: "AMAT",  shortName: "Applied Materials" },
  { symbol: "LRCX",  shortName: "Lam Research" },
  { symbol: "KLAC",  shortName: "KLA" },
  { symbol: "ADI",   shortName: "Analog Devices" },
  { symbol: "PANW",  shortName: "Palo Alto Networks" },

  // ─── Financials ───
  { symbol: "JPM",  shortName: "JPMorgan" },
  { symbol: "BAC",  shortName: "Bank of America" },
  { symbol: "WFC",  shortName: "Wells Fargo" },
  { symbol: "C",    shortName: "Citigroup" },
  { symbol: "GS",   shortName: "Goldman Sachs" },
  { symbol: "MS",   shortName: "Morgan Stanley" },
  { symbol: "BLK",  shortName: "BlackRock" },
  { symbol: "BX",   shortName: "Blackstone" },
  { symbol: "SPGI", shortName: "S&P Global" },
  { symbol: "V",    shortName: "Visa" },
  { symbol: "MA",   shortName: "Mastercard" },
  { symbol: "AXP",  shortName: "American Express" },
  { symbol: "PGR",  shortName: "Progressive" },
  { symbol: "CB",   shortName: "Chubb" },

  // ─── Healthcare / pharma / biotech ───
  { symbol: "LLY",  shortName: "Eli Lilly" },
  { symbol: "UNH",  shortName: "UnitedHealth" },
  { symbol: "JNJ",  shortName: "Johnson & Johnson" },
  { symbol: "MRK",  shortName: "Merck" },
  { symbol: "ABBV", shortName: "AbbVie" },
  { symbol: "PFE",  shortName: "Pfizer" },
  { symbol: "TMO",  shortName: "Thermo Fisher" },
  { symbol: "ABT",  shortName: "Abbott" },
  { symbol: "DHR",  shortName: "Danaher" },
  { symbol: "AMGN", shortName: "Amgen" },
  { symbol: "GILD", shortName: "Gilead" },
  { symbol: "VRTX", shortName: "Vertex" },
  { symbol: "REGN", shortName: "Regeneron" },
  { symbol: "ISRG", shortName: "Intuitive Surgical" },
  { symbol: "BSX",  shortName: "Boston Scientific" },
  { symbol: "MDT",  shortName: "Medtronic" },
  { symbol: "ELV",  shortName: "Elevance Health" },
  { symbol: "CI",   shortName: "Cigna" },

  // ─── Consumer ───
  { symbol: "WMT",  shortName: "Walmart" },
  { symbol: "COST", shortName: "Costco" },
  { symbol: "HD",   shortName: "Home Depot" },
  { symbol: "LOW",  shortName: "Lowe's" },
  { symbol: "PG",   shortName: "P&G" },
  { symbol: "KO",   shortName: "Coca-Cola" },
  { symbol: "PEP",  shortName: "PepsiCo" },
  { symbol: "MCD",  shortName: "McDonald's" },
  { symbol: "SBUX", shortName: "Starbucks" },
  { symbol: "NKE",  shortName: "Nike" },
  { symbol: "TJX",  shortName: "TJX" },
  { symbol: "TGT",  shortName: "Target" },
  { symbol: "DIS",  shortName: "Disney" },
  { symbol: "CMCSA",shortName: "Comcast" },
  { symbol: "PM",   shortName: "Philip Morris" },
  { symbol: "MO",   shortName: "Altria" },
  { symbol: "CL",   shortName: "Colgate" },
  { symbol: "MDLZ", shortName: "Mondelez" },

  // ─── Industrials / defense / transport ───
  { symbol: "CAT",  shortName: "Caterpillar" },
  { symbol: "DE",   shortName: "John Deere" },
  { symbol: "BA",   shortName: "Boeing" },
  { symbol: "LMT",  shortName: "Lockheed Martin" },
  { symbol: "RTX",  shortName: "RTX" },
  { symbol: "HON",  shortName: "Honeywell" },
  { symbol: "GE",   shortName: "GE Aerospace" },
  { symbol: "UNP",  shortName: "Union Pacific" },
  { symbol: "UPS",  shortName: "UPS" },
  { symbol: "FDX",  shortName: "FedEx" },
  { symbol: "ETN",  shortName: "Eaton" },
  { symbol: "ITW",  shortName: "Illinois Tool Works" },

  // ─── Energy / materials ───
  { symbol: "XOM",  shortName: "ExxonMobil" },
  { symbol: "CVX",  shortName: "Chevron" },
  { symbol: "COP",  shortName: "ConocoPhillips" },
  { symbol: "SLB",  shortName: "Schlumberger" },
  { symbol: "OXY",  shortName: "Occidental" },
  { symbol: "LIN",  shortName: "Linde" },
  { symbol: "SHW",  shortName: "Sherwin-Williams" },
  { symbol: "NEM",  shortName: "Newmont" },

  // ─── Utilities / telco / REIT ───
  { symbol: "NEE",  shortName: "NextEra Energy" },
  { symbol: "SO",   shortName: "Southern Company" },
  { symbol: "DUK",  shortName: "Duke Energy" },
  { symbol: "T",    shortName: "AT&T" },
  { symbol: "VZ",   shortName: "Verizon" },
  { symbol: "PLD",  shortName: "Prologis" },
  { symbol: "EQIX", shortName: "Equinix" },
  { symbol: "AMT",  shortName: "American Tower" },

  // ─── Culture / meme / fintech / AI / EV ───
  { symbol: "PLTR", shortName: "Palantir" },
  { symbol: "HOOD", shortName: "Robinhood" },
  { symbol: "COIN", shortName: "Coinbase" },
  { symbol: "SMCI", shortName: "Super Micro" },
  { symbol: "RDDT", shortName: "Reddit" },
  { symbol: "SOFI", shortName: "SoFi" },
  { symbol: "RIVN", shortName: "Rivian" },
  { symbol: "LCID", shortName: "Lucid" },
  { symbol: "RBLX", shortName: "Roblox" },
  { symbol: "U",    shortName: "Unity" },
  { symbol: "NET",  shortName: "Cloudflare" },
  { symbol: "DDOG", shortName: "Datadog" },
  { symbol: "SNOW", shortName: "Snowflake" },
  { symbol: "SHOP", shortName: "Shopify" },
  { symbol: "ABNB", shortName: "Airbnb" },
  { symbol: "DASH", shortName: "DoorDash" },
  { symbol: "UBER", shortName: "Uber" },
  { symbol: "LYFT", shortName: "Lyft" },
  { symbol: "SPOT", shortName: "Spotify" },
  { symbol: "PYPL", shortName: "PayPal" },
  { symbol: "SNAP", shortName: "Snap" },
  { symbol: "PINS", shortName: "Pinterest" },
  { symbol: "MSTR", shortName: "MicroStrategy" },
  { symbol: "GME",  shortName: "GameStop" },
  { symbol: "AMC",  shortName: "AMC" },
  { symbol: "ARM",  shortName: "ARM Holdings" },
  { symbol: "DELL", shortName: "Dell" },
  { symbol: "CRWD", shortName: "CrowdStrike" },
  { symbol: "ZS",   shortName: "Zscaler" },
  { symbol: "OKTA", shortName: "Okta" },
  { symbol: "MDB",  shortName: "MongoDB" },
  { symbol: "HUBS", shortName: "HubSpot" },
  { symbol: "TEAM", shortName: "Atlassian" },
  { symbol: "ROKU", shortName: "Roku" },
  { symbol: "DOCU", shortName: "DocuSign" },
  { symbol: "TWLO", shortName: "Twilio" },
  { symbol: "PATH", shortName: "UiPath" },
  { symbol: "NIO",  shortName: "NIO" },
  { symbol: "XPEV", shortName: "XPeng" },
  { symbol: "LI",   shortName: "Li Auto" },
  { symbol: "MARA", shortName: "MARA Holdings" },
  { symbol: "RIOT", shortName: "Riot Platforms" },
  { symbol: "IREN", shortName: "IREN" },
  { symbol: "DKNG", shortName: "DraftKings" },
  { symbol: "PENN", shortName: "PENN Entertainment" },
  { symbol: "W",    shortName: "Wayfair" },
  { symbol: "ETSY", shortName: "Etsy" },
  { symbol: "PTON", shortName: "Peloton" },
  { symbol: "PLUG", shortName: "Plug Power" },
  { symbol: "BE",   shortName: "Bloom Energy" },
  { symbol: "NBIS", shortName: "Nebius Group" },
  { symbol: "ALNY", shortName: "Alnylam Pharma" },
  { symbol: "CORT", shortName: "Corcept Therapeutics" },
];

export const universeMap = new Map(
  DAILY_MOVERS_UNIVERSE.map((t) => [t.symbol, t] as const),
);

export function shortNameOf(symbol: string): string {
  return universeMap.get(symbol.toUpperCase())?.shortName ?? symbol;
}
