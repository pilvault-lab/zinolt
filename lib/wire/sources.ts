// Source registry for The Wire — daily finance/tech aggregator.
// Adding a source = adding a line here. Nothing else.
//
// Verification of every seeded feed lives in scripts/wire-verify.ts.
// Any source that failed on 2026-07-27 is commented out with a note.

export type WireCategory =
  | "markets"
  | "fintech"
  | "tech"
  | "predictions"
  | "culture"
  | "wealth";

export type WireSourceType = "rss" | "reddit" | "hn" | "polymarket";

export type WireSource = {
  name: string;
  category: WireCategory;
  type: WireSourceType;
  url: string;
  enabled: boolean;
  // Extra request headers merged over the fetcher's defaults. Required for
  // sources with strict UA rules — SEC EDGAR, for one, expects a
  // descriptive User-Agent identifying the caller.
  headers?: Record<string, string>;
};

export const WIRE_SOURCES: WireSource[] = [
  // ── Markets: mainstream RSS ────────────────────────────────────────────
  {
    name: "CNBC Markets",
    category: "markets",
    type: "rss",
    url: "https://www.cnbc.com/id/15839069/device/rss/rss.html",
    enabled: true,
  },
  {
    name: "CNBC Finance",
    category: "markets",
    type: "rss",
    url: "https://www.cnbc.com/id/10000664/device/rss/rss.html",
    enabled: true,
  },
  {
    name: "MarketWatch Top Stories",
    category: "markets",
    type: "rss",
    url: "https://feeds.content.dowjones.io/public/rss/mw_topstories",
    enabled: true,
  },
  {
    name: "Yahoo Finance",
    category: "markets",
    type: "rss",
    url: "https://finance.yahoo.com/news/rssindex",
    enabled: true,
  },

  // ── Tech: mainstream RSS ───────────────────────────────────────────────
  {
    name: "TechCrunch",
    category: "tech",
    type: "rss",
    url: "https://techcrunch.com/feed/",
    enabled: true,
  },
  {
    name: "The Verge",
    category: "tech",
    type: "rss",
    url: "https://www.theverge.com/rss/index.xml",
    enabled: true,
  },
  {
    name: "Ars Technica",
    category: "tech",
    type: "rss",
    url: "https://feeds.arstechnica.com/arstechnica/index",
    enabled: true,
  },

  // ── Fintech / crypto RSS ───────────────────────────────────────────────
  {
    name: "CoinDesk",
    category: "fintech",
    type: "rss",
    url: "https://www.coindesk.com/arc/outboundfeeds/rss/",
    enabled: true,
  },
  {
    name: "The Block",
    category: "fintech",
    type: "rss",
    url: "https://www.theblock.co/rss.xml",
    enabled: true,
  },

  // ── Substack RSS (append /feed) ────────────────────────────────────────
  {
    // Byrne Hobart's newsletter moved off the diff.substack.com subdomain to
    // its custom domain — the old URL 400s. Verified 2026-07-27.
    name: "The Diff",
    category: "fintech",
    type: "rss",
    url: "https://www.thediff.co/feed",
    enabled: true,
  },
  {
    name: "Not Boring",
    category: "fintech",
    type: "rss",
    url: "https://www.notboring.co/feed",
    enabled: true,
  },
  {
    name: "Doomberg",
    category: "markets",
    type: "rss",
    url: "https://doomberg.substack.com/feed",
    enabled: true,
  },
  {
    name: "Net Interest",
    category: "fintech",
    type: "rss",
    url: "https://www.netinterest.co/feed",
    enabled: true,
  },
  {
    name: "Apricitas Economics",
    category: "markets",
    type: "rss",
    url: "https://www.apricitas.io/feed",
    enabled: true,
  },
  {
    name: "Noahpinion",
    category: "culture",
    type: "rss",
    url: "https://www.noahpinion.blog/feed",
    enabled: true,
  },

  // ── Reddit JSON (top of day) ───────────────────────────────────────────
  // Reddit closed anonymous JSON/RSS access in 2024 — every variant returns
  // 403 (JSON) or 429 (RSS) regardless of User-Agent. Re-enable when we're
  // willing to run an authenticated OAuth client. Verified dead 2026-07-27.
  {
    name: "r/wallstreetbets",
    category: "markets",
    type: "reddit",
    url: "https://www.reddit.com/r/wallstreetbets/top.json?t=day",
    enabled: false,
  },
  {
    name: "r/stocks",
    category: "markets",
    type: "reddit",
    url: "https://www.reddit.com/r/stocks/top.json?t=day",
    enabled: false,
  },
  {
    name: "r/fintech",
    category: "fintech",
    type: "reddit",
    url: "https://www.reddit.com/r/fintech/top.json?t=day",
    enabled: false,
  },
  {
    name: "r/technology",
    category: "tech",
    type: "reddit",
    url: "https://www.reddit.com/r/technology/top.json?t=day",
    enabled: false,
  },

  // ── Hacker News (Firebase API, top ~30, score > 100) ───────────────────
  {
    name: "Hacker News",
    category: "tech",
    type: "hn",
    url: "https://hacker-news.firebaseio.com/v0/topstories.json",
    enabled: true,
  },

  // ── Polymarket (Gamma API, sorted by 24h volume, top ~15) ──────────────
  {
    name: "Polymarket",
    category: "predictions",
    type: "polymarket",
    url: "https://gamma-api.polymarket.com/markets?closed=false&order=volume24hr&ascending=false&limit=15",
    enabled: true,
  },

  // ── Extra RSS ──────────────────────────────────────────────────────────
  // Markets / finance news
  {
    // Sherwood publishes their feed at /rss.xml (the pretty /feed URL 404s).
    name: "Sherwood News",
    category: "markets",
    type: "rss",
    url: "https://sherwood.news/rss.xml",
    enabled: true,
  },
  {
    // Matt Levine's daily Money Stuff column at Bloomberg Opinion. Bloomberg
    // sometimes 403s anonymous UAs — verify script will flag if this is dead.
    name: "Money Stuff (Matt Levine)",
    category: "markets",
    type: "rss",
    url: "https://www.bloomberg.com/opinion/authors/ARbTQlRLRjE/matthew-s-levine.rss",
    enabled: true,
  },

  // Fintech / payments
  {
    // Ghost publication — /feed 404s, actual RSS is at /archive/rss/.
    name: "Bits About Money",
    category: "fintech",
    type: "rss",
    url: "https://www.bitsaboutmoney.com/archive/rss/",
    enabled: true,
  },

  // Tech / infra / AI
  {
    name: "SemiAnalysis",
    category: "tech",
    type: "rss",
    url: "https://semianalysis.com/feed/",
    enabled: true,
  },
  {
    // Stratechery's free posts (Weekly Article, occasional Interviews).
    name: "Stratechery",
    category: "tech",
    type: "rss",
    url: "https://stratechery.com/feed/",
    enabled: true,
  },
  {
    // Product Hunt has a public RSS at /feed listing top daily launches.
    name: "Product Hunt",
    category: "tech",
    type: "rss",
    url: "https://www.producthunt.com/feed",
    enabled: true,
  },

  // Culture / macro-thought
  {
    name: "Marginal Revolution",
    category: "culture",
    type: "rss",
    url: "https://marginalrevolution.com/feed",
    enabled: true,
  },
  {
    name: "Astral Codex Ten",
    category: "culture",
    type: "rss",
    url: "https://www.astralcodexten.com/feed",
    enabled: true,
  },

  // ── Mainstream business / wealth ──────────────────────────────────────
  // Bloomberg + WSJ headlines flow through public RSS even though the
  // article bodies are paywalled — the row is a "worth going to look"
  // signal, not the full read.
  {
    name: "Fortune",
    category: "wealth",
    type: "rss",
    url: "https://fortune.com/feed/",
    enabled: true,
  },
  {
    name: "Business Insider Markets",
    category: "markets",
    type: "rss",
    url: "https://markets.businessinsider.com/rss/news",
    enabled: true,
  },
  {
    name: "Business Insider",
    category: "wealth",
    type: "rss",
    url: "https://www.businessinsider.com/rss",
    enabled: true,
  },
  {
    name: "Bloomberg Markets",
    category: "markets",
    type: "rss",
    url: "https://feeds.bloomberg.com/markets/news.rss",
    enabled: true,
  },
  {
    // Bloomberg Wealth serves an empty <channel> — the 301 redirect lands
    // at a valid feed URL but with zero items (verified 2026-07-27). Left
    // in place in case Bloomberg starts publishing it again.
    name: "Bloomberg Wealth",
    category: "wealth",
    type: "rss",
    url: "https://feeds.bloomberg.com/wealth/news.rss",
    enabled: false,
  },
  {
    name: "Bloomberg Technology",
    category: "tech",
    type: "rss",
    url: "https://feeds.bloomberg.com/technology/news.rss",
    enabled: true,
  },
  {
    name: "Forbes Business",
    category: "wealth",
    type: "rss",
    url: "https://www.forbes.com/business/feed/",
    enabled: true,
  },
  {
    name: "WSJ Markets",
    category: "markets",
    type: "rss",
    url: "https://feeds.content.dowjones.io/public/rss/RSSMarketsMain",
    enabled: true,
  },
  {
    name: "WSJ Technology",
    category: "tech",
    type: "rss",
    url: "https://feeds.content.dowjones.io/public/rss/RSSWSJD",
    enabled: true,
  },

  // ── Culture / trend trackers ──────────────────────────────────────────
  {
    name: "Rest of World",
    category: "culture",
    type: "rss",
    url: "https://restofworld.org/feed/",
    enabled: true,
  },
  {
    name: "Fast Company",
    category: "culture",
    type: "rss",
    url: "https://www.fastcompany.com/rss",
    enabled: true,
  },
  {
    name: "Morning Brew",
    category: "culture",
    type: "rss",
    url: "https://www.morningbrew.com/feed",
    enabled: true,
  },
  {
    // Pirate Wires' own domain (piratewires.com) 429s aggressively —
    // Cloudflare bot protection. The Substack mirror at
    // piratewires.substack.com serves the same content freely.
    name: "Pirate Wires",
    category: "culture",
    type: "rss",
    url: "https://piratewires.substack.com/feed",
    enabled: true,
  },

  // ── SEC EDGAR Form 4 (insider transactions) — wealth watchlist ────────
  // EDGAR enforces its fair-access policy by rejecting default UAs. Every
  // request must identify the caller with a real contact string — spelled
  // out in https://www.sec.gov/os/accessing-edgar-data. Titles from EDGAR
  // are dry ("4 - Musk Elon"); the row is a nudge to go inspect the filing.
  ...([
    { name: "Tesla", cik: "0001318605" },
    { name: "Amazon", cik: "0001018724" },
    { name: "Meta", cik: "0001326801" },
    { name: "NVIDIA", cik: "0001045810" },
    { name: "Apple", cik: "0000320193" },
  ].map<WireSource>(({ name, cik }) => ({
    name: `SEC Form 4 / ${name}`,
    category: "wealth",
    type: "rss",
    url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=4&dateb=&owner=include&count=20&output=atom`,
    enabled: true,
    headers: { "User-Agent": "Zinolt Wire admin@localhost" },
  }))),
];
