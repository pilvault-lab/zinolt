/**
 * Ranking composition — timing + layout knobs.
 *
 * Composition style: PEDESTAL ELEVATION, confined to the vertical SAFE band.
 *
 * Safe band (portrait/reels):
 *   - Top 18%   → reserved for platform UI (username, timer) + our pinned title.
 *   - Bottom 22%→ reserved for platform UI (caption, action buttons).
 *   - Middle 60% (y = 18% → 78%) → the chart lives here entirely.
 */

export const RK_FPS = 60;
export const RK_WIDTH = 1080;
export const RK_HEIGHT = 1920;

/**
 * Registered composition duration — set to cover the LARGEST supported topN
 * (top-10 = 0.3s + 20s rise + 3s hold + 2.2s CTA ≈ 25.5s). The composition
 * pads to this length; `computeRankingTiming(topN)` returns the actual
 * runtime used by the studio player.
 */
export const RK_TOTAL_SEC = 26;
export const RK_TOTAL_FRAMES = RK_FPS * RK_TOTAL_SEC;

/** Vertical safe band as fractions of frame height. */
export const SAFE_TOP_FRAC = 0.18;
export const SAFE_BOTTOM_FRAC = 0.78;

/** Derived pixel positions of the safe band edges. */
export const SAFE_TOP_Y = Math.round(RK_HEIGHT * SAFE_TOP_FRAC);   // 346
export const SAFE_BOTTOM_Y = Math.round(RK_HEIGHT * SAFE_BOTTOM_FRAC); // 1498
export const SAFE_HEIGHT = SAFE_BOTTOM_Y - SAFE_TOP_Y;             // 1152

/** Default number of ranked entries to show. `topN` prop can override. */
export const RK_DEFAULT_TOP_N = 5;

/** Section boundaries in seconds. Sequential rises take ~2s each × N. */
export const RK_SECTIONS = {
  /** Title fade-in — title stays pinned throughout the whole video. */
  title:  { start: 0.0, end: 0.5 },
  /** Sequential pedestal rises begin here. Length = perPedestalSec × N. */
  rise:   { start: 0.3 },
  /** Winner lock-in — computed at render time from rise end. */
  hold:   { extraSec: 3.0 },
  /** CTA card slides in at the end — held for a full beat. */
  ctaSec: 2.2,
} as const;

export const sec = (s: number) => Math.round(s * RK_FPS);

/** Layout knobs — everything not derived-from-N. */
export const RK_LAYOUT = {
  edgeX: 60,

  // Title — CENTERED, lowered below the corner logo so no collision anywhere.
  // Sits inside the top-18% safe zone.
  titleTop: 210,
  titleSize: 82,

  // Corner watermark — small, top-right.
  cornerLogoHeight: 120,
  cornerLogoTop: 60,
  cornerLogoRight: 52,

  // Chart geometry.
  // Base line sits low in the band, leaving room for the name labels
  // just below it (still inside the safe band).
  baseY: SAFE_BOTTOM_Y - 88,           // 1410
  nameLabelTop: SAFE_BOTTOM_Y - 66,    // just below baseY
  nameLabelHeight: 60,

  // Max bar height chosen so the overshoot spring's peak (~1.2x) stays clear
  // of the (now-lowered) title AND the value counter above the portrait fits.
  maxBarHeight: 700,
  minBarHeight: 220,

  portraitBorder: 3,
  portraitGap: 16,
  valueGap: 10,

  // Winner glow bloom at lock moment.
  winnerGlowBlur: 60,
  winnerGlowOpacity: 0.75,
} as const;

/**
 * Bar/portrait/type sizes derived from N so top-3 through top-10 all fit
 * inside the horizontal safe zone (edgeX to edgeX). Portrait, value counter,
 * name label, and rank-ghost sizes scale down with the bar width so the
 * proportions stay visually correct.
 */
export function computePedestalGeom(topN: number) {
  const available = RK_WIDTH - RK_LAYOUT.edgeX * 2;
  // Gaps shrink with more bars.
  const barGap = topN <= 4 ? 44 : topN <= 5 ? 40 : topN <= 6 ? 34 : topN <= 7 ? 28 : topN <= 8 ? 24 : 20;
  const barWidth = Math.floor((available - barGap * (topN - 1)) / topN);

  // Portrait slightly overhangs the bar for the wider layouts, sits inside
  // for the narrow ones.
  const portraitSize = Math.min(128, Math.round(barWidth * 1.05));
  // Font sizes scale with portrait size.
  const valueSize = Math.max(20, Math.round(portraitSize * 0.34));
  const nameLabelSize = Math.max(14, Math.round(barWidth * 0.20));
  const rankGhostSize = Math.max(52, Math.round(barWidth * 0.6));

  return { barGap, barWidth, portraitSize, valueSize, nameLabelSize, rankGhostSize };
}

/** Sequential rise timing. */
export const RK_RISE = {
  /** Seconds per pedestal (spring uses spring durationInFrames of this). */
  perPedestalSec: 2.0,
} as const;
export const RK_RISE_FRAMES = Math.round(RK_RISE.perPedestalSec * RK_FPS); // 120

/** Depth entrance — subtle 3D. */
export const RK_DEPTH = {
  perspective: 1200,
  entryTranslateZ: -220,
  entryRotateX: 18,
  entryDurFrames: 26,
} as const;

/** Impact recoil for #1 lock-in (applied to whole stage). */
export const RK_IMPACT = {
  peak: 1.03,
  durFrames: 10,
} as const;

/**
 * Compute total render timing given a specific N.
 * Layout: title fade → sequential rises → hold → CTA.
 */
export function computeRankingTiming(topN: number) {
  const riseStartF = sec(RK_SECTIONS.rise.start);
  const riseDurationF = topN * RK_RISE_FRAMES;
  const riseEndF = riseStartF + riseDurationF;
  const lockF = riseEndF;                                      // impact fires at last pedestal's settle
  const holdEndF = riseEndF + sec(RK_SECTIONS.hold.extraSec);  // hold on winner
  const ctaStartF = holdEndF;
  const ctaEndF = ctaStartF + sec(RK_SECTIONS.ctaSec);
  const totalFrames = Math.max(RK_TOTAL_FRAMES, ctaEndF);
  return {
    riseStartF,
    riseEndF,
    lockF,
    holdEndF,
    ctaStartF,
    ctaEndF,
    totalFrames,
  };
}
