import type { Ranking } from "../types";

/**
 * TOP 10 RICHEST MEN — August 2026.
 *
 * ⚠ NEEDS FACT-CHECK before publish. Numbers below sourced from a SINGLE
 *   secondary aggregator (beinsure.com) on 2026-08-12; NOT yet cross-checked
 *   against Bloomberg Billionaires Index or Forbes Real-Time.
 *
 *   All figures should be considered PROVISIONAL until the user (or a second
 *   pull from Bloomberg/Forbes) has confirmed. Values are especially volatile
 *   near market close; individual entries can move ±5% intraday.
 *
 * Primary source (single-source, needs 2nd confirmation):
 *   https://beinsure.com/world-richest-people/  (accessed 2026-08-12)
 *
 * Portraits: Wikimedia Commons (CC/PD). Ortega has no free portrait — falls
 * back to initials in the composition.
 */
const ASSET_DIR = "/ranking/assets/richest-men-2026";

const ranking: Ranking = {
  slug: "richest-men-2026",
  title: "Top 10 Richest Men",
  metricLabel: "net worth",
  format: "usd-b",
  asOfDate: "August 2026",
  verifiedOnISO: "2026-08-12",
  sources: [
    "https://beinsure.com/world-richest-people/",
    // TODO: add Bloomberg Billionaires Index + Forbes Real-Time cross-check
  ],
  entries: [
    {
      rank: 1, name: "Elon Musk", value: 760,
      image: `${ASSET_DIR}/01-musk.jpg`,
      note: "Tesla + SpaceX. Provisional — verify vs Bloomberg.",
    },
    {
      rank: 2, name: "Larry Page", value: 292,
      image: `${ASSET_DIR}/02-page.jpg`,
      note: "Alphabet/Google co-founder. Provisional.",
    },
    {
      rank: 3, name: "Jeff Bezos", value: 283,
      image: `${ASSET_DIR}/03-bezos.jpg`,
      note: "Amazon. Provisional.",
    },
    {
      rank: 4, name: "Sergey Brin", value: 269,
      image: `${ASSET_DIR}/04-brin.jpg`,
      note: "Alphabet/Google co-founder. Provisional.",
    },
    {
      rank: 5, name: "Michael Dell", value: 244,
      image: `${ASSET_DIR}/05-dell.jpg`,
      note: "Dell Technologies. Provisional.",
    },
    {
      rank: 6, name: "Mark Zuckerberg", value: 202,
      image: `${ASSET_DIR}/06-zuckerberg.jpg`,
      note: "Meta. Provisional.",
    },
    {
      rank: 7, name: "Jensen Huang", value: 193,
      image: `${ASSET_DIR}/07-huang.jpg`,
      note: "NVIDIA. Provisional.",
    },
    {
      rank: 8, name: "Larry Ellison", value: 185,
      image: `${ASSET_DIR}/08-ellison.png`,
      note: "Oracle. Provisional.",
    },
    {
      rank: 9, name: "Steve Ballmer", value: 155,
      image: `${ASSET_DIR}/09-ballmer.jpg`,
      note: "Ex-Microsoft CEO. Provisional. Portrait is a 2007 photo (Ballmer camera-shy).",
    },
    {
      rank: 10, name: "Amancio Ortega", value: 149,
      image: null,
      note: "Inditex/Zara. Provisional. No free-use portrait available on Wikimedia — composition renders initials fallback.",
    },
  ],
};

export default ranking;
