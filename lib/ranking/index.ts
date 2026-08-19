/**
 * Ranking library registry.
 *
 * To add a new ranking: create `lib/ranking/data/{slug}.ts` exporting a
 * `Ranking`, then import + register it here.
 */
import type { Ranking } from "./types";
import richestMen2026 from "./data/richest-men-2026";
import mostValuableCompanies2026 from "./data/most-valuable-companies-2026";
import mostValuableBrands_2026 from "./data/most-valuable-brands-2026";
import biggestBankruptciesEver from "./data/biggest-bankruptcies-ever";
import biggestTechAcquisitions from "./data/biggest-tech-acquisitions";
import highestPaidCeos_2026 from "./data/highest-paid-ceos-2026";
import mostDownloadedAppsAlltime from "./data/most-downloaded-apps-alltime";
import mostProfitableCompanies_2026 from "./data/most-profitable-companies-2026";
import mostValuableSportsTeams from "./data/most-valuable-sports-teams";
import fastestTo_1bValuation from "./data/fastest-to-1b-valuation";
import highestGrossingMovies from "./data/highest-grossing-movies";
import largestIposHistory from "./data/largest-ipos-history";
import mostValuableCarCompanies from "./data/most-valuable-car-companies";
import mostValuableStartups from "./data/most-valuable-startups";

export const RANKINGS: readonly Ranking[] = [
  mostValuableCompanies2026,
  richestMen2026,
  mostValuableBrands_2026,
  biggestBankruptciesEver,
  biggestTechAcquisitions,
  highestPaidCeos_2026,
  mostDownloadedAppsAlltime,
  mostProfitableCompanies_2026,
  mostValuableSportsTeams,
  fastestTo_1bValuation,
  highestGrossingMovies,
  largestIposHistory,
  mostValuableCarCompanies,
  mostValuableStartups,
] as const;

export const DEFAULT_RANKING_SLUG = RANKINGS[0].slug;

export function getRankingBySlug(slug: string | null | undefined): Ranking {
  return RANKINGS.find((r) => r.slug === slug) ?? RANKINGS[0];
}

export type { Ranking, RankingEntry } from "./types";
