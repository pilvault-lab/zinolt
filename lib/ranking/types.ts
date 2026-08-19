/**
 * Ranking template — data types.
 *
 * One data file per ranking under `lib/ranking/data/{slug}.ts`.
 * Composition (see remotion/ranking/) consumes a Ranking and produces a
 * 9:16 ascending-podium reveal.
 */

export type RankingEntry = {
  /** 1 = winner (top of frame at end); 10 = bottom of the stack. */
  rank: number;
  name: string;
  /** Numeric metric — the composition counts up to this value. */
  value: number;
  /**
   * Portrait or logo. Public-static path (e.g. `/ranking/assets/richest-men-2026/01-musk.jpg`).
   * If null, the composition renders initials in a circle.
   */
  image: string | null;
  /**
   * Optional accent color used only when composition's COLOR_MODE = "accent".
   * Mono mode ignores it. Hex string, e.g. "#E11D48".
   */
  color?: string;
  /**
   * Per-entry override for the portrait-circle background. Falls back to
   * the ranking-level `portraitBg` when unset. Use "light" for entries whose
   * logo/image is dark and would disappear on the default dark circle.
   */
  portraitBg?: "dark" | "light";
  /**
   * Optional per-entry notes (source, caveats). Not rendered.
   * Use this to record where the value came from + confidence.
   */
  note?: string;
};

export type Ranking = {
  /** URL slug — must match filename in `lib/ranking/data/`. */
  slug: string;
  /** Big hook headline shown on the title card. Uppercased in the composition. */
  title: string;
  /** Small label under the number, e.g. "net worth". */
  metricLabel: string;
  /**
   * Value formatter: choose a canonical format applied by the composition.
   *   "usd-t"  → "$X.XT"           (1 decimal — for trillions)
   *   "usd-b"  → "$XXXB"           (integer)
   *   "usd-b1" → "$X.XB"           (1 decimal — movies at $2.9B vs $2.7B)
   *   "usd-m"  → "$XXXM"           (integer)
   *   "usd"    → "$X,XXX,XXX"      (integer)
   *   "num-b"  → "X.XB"            (1 decimal, no $ — counts like downloads)
   *   "int"    → "12,345"
   *   "pct"    → "12%"
   */
  format: "usd-t" | "usd-b" | "usd-b1" | "usd-m" | "usd" | "num-b" | "int" | "pct";
  /** Human-readable "as of" date, e.g. "August 2026". Rendered on title card. */
  asOfDate: string;
  /**
   * ISO date the numbers were last verified. Used ONLY for maintenance
   * (not rendered).
   */
  verifiedOnISO?: string;
  /**
   * Source URL(s) for auditor traceability. Not rendered.
   */
  sources?: string[];
  /**
   * Portrait-circle background for all entries in this ranking. Use "light"
   * when logos/images are dark and would disappear on a dark circle
   * (typical for company logos: Meta, Amazon, Apple). Use "dark" (default)
   * for people-portrait rankings.
   *
   * Per-entry `portraitBg` overrides this.
   */
  portraitBg?: "dark" | "light";
  /**
   * Ordered #1 through #N. The composition sorts by `rank` so order in
   * the array doesn't matter, but keeping them in rank order is nicer to read.
   */
  entries: RankingEntry[];
};
