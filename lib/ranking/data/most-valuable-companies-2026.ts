import type { Ranking } from "../types";

/**
 * TOP 10 MOST VALUABLE COMPANIES — August 2026.
 *
 * Source: CompaniesMarketCap (https://companiesmarketcap.com/), accessed
 * 2026-08-13. Market caps in USD trillions.
 *
 * ⚠ Live market data — figures move intraday. Re-fetch before publishing
 *   if the clip will be timestamped.
 */
const ASSET_DIR = "/ranking/assets/most-valuable-companies-2026";

const ranking: Ranking = {
  slug: "most-valuable-companies-2026",
  title: "Top 10 Most Valuable Companies",
  metricLabel: "market cap",
  format: "usd-t",
  asOfDate: "August 2026",
  verifiedOnISO: "2026-08-13",
  sources: [
    "https://companiesmarketcap.com/",
  ],
  // Company logos on a dark circle disappear (Meta blue, Amazon black,
  // Apple dark) — use light circles for logo-heavy rankings.
  portraitBg: "light",
  entries: [
    { rank: 1,  name: "NVIDIA",      value: 5.4, image: `${ASSET_DIR}/01-nvidia.webp`,     note: "NVDA — AI/GPUs" },
    { rank: 2,  name: "Apple",       value: 4.4, image: `${ASSET_DIR}/02-apple.webp`,      note: "AAPL" },
    { rank: 3,  name: "Alphabet",    value: 4.2, image: `${ASSET_DIR}/03-alphabet.webp`,   note: "GOOG" },
    { rank: 4,  name: "Microsoft",   value: 3.7, image: `${ASSET_DIR}/04-microsoft.webp`,  note: "MSFT" },
    { rank: 5,  name: "Amazon",      value: 2.9, image: `${ASSET_DIR}/05-amazon.webp`,     note: "AMZN" },
    { rank: 6,  name: "TSMC",        value: 2.2, image: `${ASSET_DIR}/06-tsmc.webp`,       note: "TSM" },
    { rank: 7,  name: "Broadcom",    value: 2.0, image: `${ASSET_DIR}/07-broadcom.webp`,   note: "AVGO" },
    { rank: 8,  name: "SpaceX",      value: 1.9, image: `${ASSET_DIR}/08-spacex.webp`,     note: "Private — CompaniesMarketCap estimate" },
    { rank: 9,  name: "Saudi Aramco",value: 1.7, image: `${ASSET_DIR}/09-aramco.webp`,     note: "2222.SR" },
    { rank: 10, name: "Meta",        value: 1.5, image: `${ASSET_DIR}/10-meta.webp`,       note: "META" },
  ],
};

export default ranking;
