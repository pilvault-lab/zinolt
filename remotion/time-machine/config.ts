/**
 * Single source of truth for the Time Machine composition.
 * Every timing, spring, and size lives here so motion iteration
 * happens in ONE place, not spread across the composition.
 */

export const TM_FPS = 60;
export const TM_WIDTH = 1080;
export const TM_HEIGHT = 1920;

// Total 30s at 60fps = 1800 frames.
export const TM_TOTAL_SEC = 30;
export const TM_TOTAL_FRAMES = TM_FPS * TM_TOTAL_SEC;

/** Section boundaries in seconds — see spec. */
export const TM_SECTIONS = {
  hook: { start: 0.0, end: 2.5 },
  ride: { start: 2.5, end: 22.0 },
  payoff: { start: 22.0, end: 27.0 },
  cta: { start: 27.0, end: 30.0 },
} as const;

export const sec = (s: number) => Math.round(s * TM_FPS);

/** Spring presets. Damping+stiffness picked for AE-grade
 *  overshoot-and-settle (not sluggish, not bouncy). */
export const TM_SPRINGS = {
  /** Big overshoot for headline entrances. */
  bounce: { damping: 12, stiffness: 90, mass: 0.7 },
  /** Snappy for word stagger — quick settle, tiny overshoot. */
  snap:   { damping: 14, stiffness: 200, mass: 0.5 },
  /** Silky for the big payoff number scaling in. */
  silk:   { damping: 18, stiffness: 70, mass: 1.0 },
} as const;

/**
 * Time warp: given linear ride progress t ∈ [0,1], returns the
 * fraction of the data series to show. Constraint: at t=0.6, we
 * must have covered 60% of the *linear* series but only 80% of
 * the *value growth* — equivalently, in raw index terms we want
 * the payoff to occupy the final ~40% of on-screen time.
 *
 * Uses dataProgress = t^0.437 which satisfies 0.6^0.437 ≈ 0.8.
 * Reads as: fast start, gentle late build-up.
 */
export const TM_RIDE_WARP_POWER = 0.437;
export const warpRide = (t: number) =>
  Math.max(0, Math.min(1, Math.pow(t, TM_RIDE_WARP_POWER)));

/** Sizes in composition pixels (1080x1920 canvas). */
export const TM_SIZES = {
  hookHeadline: 88,
  hookAmount: 132,
  hookYear: 96,
  counterHuge: 220,     // the ride counter — biggest thing on screen
  counterPayoff: 220,   // the frozen payoff number (kept ≤ counterHuge so it can't overflow 1080 width)
  // Chart is vertically centered in the 1920 canvas: 720 tall, top=600 → bottom=1320.
  chartHeight: 720,
  chartTop: 600,
  chartPadX: 90,
  // Counter sits above the chart, hugging the top safe area.
  counterTop: 230,
  milestoneLabel: 32,
  ctaBody: 68,
  ctaFoot: 44,
  logoHeightHook: 220,
  // Persistent Vernavle mark, top-right. Offset below top crop safe area.
  cornerLogoHeight: 240,
  cornerLogoTop: 100,
  cornerLogoRight: 60,
  gridOpacity: 0.08,
  glowBlur: 26,
} as const;

export const TM_STROKE = {
  line: 6,
  gridMajor: 1.5,
} as const;
