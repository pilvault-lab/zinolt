/**
 * Ranking library registry.
 *
 * To add a new ranking: create `lib/ranking/data/{slug}.ts` exporting a
 * `Ranking`, then import + register it here.
 */
import type { Ranking } from "./types";
import richestMen2026 from "./data/richest-men-2026";

export const RANKINGS: readonly Ranking[] = [
  richestMen2026,
] as const;

export const DEFAULT_RANKING_SLUG = RANKINGS[0].slug;

export function getRankingBySlug(slug: string | null | undefined): Ranking {
  return RANKINGS.find((r) => r.slug === slug) ?? RANKINGS[0];
}

export type { Ranking, RankingEntry } from "./types";
