/**
 * Single source of truth for the Daily Movers composition.
 * One race chart + side ticker stack → horizontal reflow at the close.
 */

export const DM_FPS = 60;
export const DM_WIDTH = 1080;
export const DM_HEIGHT = 1920;

export const DM_PICK_COUNT = 5;

/** Section durations in seconds. Total = 23. */
export const DM_DUR = {
  race: 15.0,     // chart draws + leaderboard reshuffles
  hold: 0.5,      // freeze — no stamp, just a beat
  reflow: 1.5,    // vertical stack → horizontal strip (staggered springs)
  rest: 3.0,      // strip fully settled + names readable, chart still bright
  cta: 3.0,       // dim chart + strip, "Follow @vernavle" springs in
} as const;

export const DM_TOTAL_SEC =
  DM_DUR.race + DM_DUR.hold + DM_DUR.reflow + DM_DUR.rest + DM_DUR.cta;
export const DM_TOTAL_FRAMES = Math.round(DM_TOTAL_SEC * DM_FPS);

export const sec = (s: number) => Math.round(s * DM_FPS);

export const DM_SPRINGS = {
  bounce: { damping: 12, stiffness: 90, mass: 0.7 },
  snap:   { damping: 14, stiffness: 200, mass: 0.5 },
  silk:   { damping: 18, stiffness: 70, mass: 1.0 },
  /** Row reshuffle during the race — snappy with a touch of overshoot. */
  reshuffle: { damping: 14, stiffness: 140, mass: 0.6 },
  /** Vertical→horizontal reflow — same energy but longer settle so the
   *  travel reads before it comes to rest. */
  reflow:    { damping: 15, stiffness: 110, mass: 0.7 },
} as const;

/**
 * FIXED PLOT BAND — the chart's plot area is a stable vertical band in
 * every render. Extreme days compress into it, calm days fill it. Header
 * sits above the band, time marker below, ticker stack centered on it.
 * Defined as fractions of frame height so the band is a design constant.
 */
export const DM_CHART_TOP_FRAC    = 0.28;   // shifted up so post-transition
export const DM_CHART_BOTTOM_FRAC = 0.64;   // horizontal strip sits higher

/** X-scale runway for the synthetic origin — 7% of plot width before the
 *  9:30 opening print. Gap-move draws as a steep diagonal, not vertical. */
export const DM_LAUNCH_RUNWAY_FRAC = 0.07;

/** Y-scale padding on top/bottom of the data range, as a fraction of that
 *  range. Prevents the extremes from kissing the band edges. */
export const DM_Y_PADDING_FRAC = 0.12;

// Derived from fractions — safe to import and use as concrete pixel values.
export const DM_CHART_TOP    = Math.round(DM_HEIGHT * DM_CHART_TOP_FRAC);
export const DM_CHART_BOTTOM = Math.round(DM_HEIGHT * DM_CHART_BOTTOM_FRAC);
export const DM_CHART_HEIGHT = DM_CHART_BOTTOM - DM_CHART_TOP;
export const DM_CHART_CENTER_Y = Math.round((DM_CHART_TOP + DM_CHART_BOTTOM) / 2);

export const DM_SIZES = {
  // Header — snug above the plot band.
  headerHeadline: 42,
  headerDate: 30,
  // Header is a CENTERED stack (headline on top, date beneath). Sits so
  // the whole block ends ~24px above the chart top.
  headerTop: DM_CHART_TOP - 110,

  // Chart plot area. Extra L/R margin so leading dots + line ends don't
  // kiss the frame / ticker-stack edges.
  chartLeftX: 70,
  chartRightX: 760,
  chartTop: DM_CHART_TOP,
  chartHeight: DM_CHART_HEIGHT,

  // Time indicator under the plot band.
  timeIndicator: 28,
  timeIndicatorY: DM_CHART_BOTTOM + 42,

  // Leaderboard (vertical mode) — VERTICALLY CENTERED on the plot band.
  lbRight: 40,
  lbWidth: 240,
  lbRowHeight: 130,
  lbTop: DM_CHART_CENTER_Y - (5 * 130) / 2, // 5 rows tall, centered
  lbPillWidth: 6,
  lbTicker: 40,
  lbPct: 38,
  lbRowGap: 10,

  // Horizontal strip — sits below the plot band + time indicator.
  stripTop: DM_CHART_BOTTOM + 130,
  stripItemW: 190,
  stripGap: 10,
  stripPillWidth: 6,
  stripPillHeight: 44,
  stripTicker: 32,
  stripPct: 32,
  stripName: 18,

  // CTA
  ctaHeadline: 60,
  ctaSub: 32,
  ctaChartOpacity: 0.15,

  // Persistent corner mark — doubled in size, dropped a few px to clear
  // the top crop safe area on IG/TikTok.
  cornerLogoHeight: 192,
  cornerLogoTop: 108,
  cornerLogoRight: 50,

  // Glow
  glowBlur: 22,
  glowBlurStrong: 30,
} as const;

export const DM_STROKE = {
  line: 8,        // was 6 — thicker so lines read as individual over black
  zeroLine: 1.5,
} as const;

/**
 * VIVID electric palette. Each hue is tuned to punch on pure black.
 * The glow uses the SAME hue (never white) — this is what makes lines
 * feel physical on OLED. Fixed assignment to picks[0..4].
 */
export const DM_PALETTE: readonly string[] = [
  "#2E7CF6", // electric blue
  "#2AF598", // neon green
  "#FFB020", // hot amber
  "#8A5CFF", // vivid violet
  "#FF3D8A", // magenta
] as const;

/** Copy — kept here so it's a one-file change. */
export const DM_COPY = {
  headerHeadline: "TODAY'S HIGHEST STOCK MOVERS",
  ctaHeadline: "Follow @vernavle",
  ctaSub: "for market visuals",
} as const;
