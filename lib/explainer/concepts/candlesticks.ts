import type { ConceptScript } from "../types";

/**
 * Candlesticks — anatomy of a single candle.
 *
 * TV chart mode. One big bullish hero candle carries the OHLC teaching,
 * then a bearish counterpart appears for the color contrast. Every
 * anatomy beat swaps in/out one word before the next (short exit fades)
 * so nothing overlaps.
 */

const NARRATION = [
  // 0-5
  "What does one candle actually mean?",
  // 6-11
  "This tiny shape holds four numbers.",
  // 12-16
  "The open, where price started.",
  // 17-21
  "The close, where it ended.",
  // 22-25
  "The high, the peak.",
  // 26-30
  "And the low, the dip.",
  // 31-35
  "Green if it closed higher.",
  // 36-40
  "Red if it closed lower.",
  // 41-45
  "One candle, one full story.",
].join(" ");

// Hero bullish candle — chunky 10-unit body, 5-unit wicks on each side.
const HERO_OPEN = 100;
const HERO_CLOSE = 110;
const HERO_HIGH = 115;
const HERO_LOW = 95;

const BULLISH = [{ open: HERO_OPEN, close: HERO_CLOSE, high: HERO_HIGH, low: HERO_LOW }];
// Bearish counterpart — mirror body, symmetric wicks.
const BEARISH = [{ open: 110, close: 100, high: 113, low: 97 }];

export const candlesticksConcept: ConceptScript = {
  id: "candlesticks",
  label: "Candlesticks",
  narration: NARRATION,
  chart: {
    priceMin: 90,
    priceMax: 120,
    timeSteps: 5,
    showPriceAxis: true,
    showGrid: true,
    // SVG renderer — Projector draws both bodies and wicks so they're
    // pixel-aligned by construction (TV canvas auto-positions bars using
    // its own scale which drifts from Projector.x).
    renderer: "svg",
  },
  // Word indices (0-based, whitespace-split):
  // 0:What 1:does 2:one 3:candle 4:actually 5:mean?
  // 6:This 7:tiny 8:shape 9:holds 10:four 11:numbers.
  // 12:The 13:open, 14:where 15:price 16:started.
  // 17:The 18:close, 19:where 20:it 21:ended.
  // 22:The 23:high, 24:the 25:peak.
  // 26:And 27:the 28:low, 29:the 30:dip.
  // 31:Green 32:if 33:it 34:closed 35:higher.
  // 36:Red 37:if 38:it 39:closed 40:lower.
  // 41:One 42:candle, 43:one 44:full 45:story.
  beats: [
    // ─── Hook (silent) ───────────────────────────────────────────────
    {
      atWord: 0,
      op: "hookText",
      id: "hook",
      text: "What does candlesticks actually mean?",
      at: { x: 0.5, y: 0.42 },
      size: "caption",
      animDurationSec: 0.7,
      easing: "outExpo",
      until: 5,
      exitDurationSec: 0.25,
    },

    // ─── Hero candle enters ──────────────────────────────────────────
    {
      atWord: 6,
      op: "candles",
      id: "hero",
      candles: BULLISH,
      tStart: 2,
      anim: "draw",
      animDurationSec: 0.7,
    },
    { atWord: 6, op: "sfx", variant: "pop", volume: 0.55 },
    // Sub-caption below the chart while narrator sets up.
    {
      atWord: 6,
      op: "hookText",
      id: "setupCap",
      text: "one candle = four numbers",
      at: { x: 0.5, y: 0.82 },
      size: "caption",
      animDurationSec: 0.6,
      easing: "outExpo",
      until: 12,
      exitDurationSec: 0.2,
    },

    // ─── OHLC anatomy: one hline at a time, snappy swaps ─────────────
    // Each price level is drawn as a dashed horizontal line across the
    // chart with the label at the left end. `until` fires one word
    // before the next beat's atWord so there's zero overlap.
    {
      atWord: 13,
      op: "hline",
      id: "openLine",
      y: HERO_OPEN,
      label: "OPEN",
      animDurationSec: 0.5,
      easing: "outExpo",
      until: 17,
      exitDurationSec: 0.15,
    },
    { atWord: 13, op: "sfx", variant: "click", volume: 0.55 },

    {
      atWord: 18,
      op: "hline",
      id: "closeLine",
      y: HERO_CLOSE,
      label: "CLOSE",
      animDurationSec: 0.5,
      easing: "outExpo",
      until: 22,
      exitDurationSec: 0.15,
    },
    { atWord: 18, op: "sfx", variant: "click", volume: 0.55 },

    {
      atWord: 23,
      op: "hline",
      id: "highLine",
      y: HERO_HIGH,
      label: "HIGH",
      animDurationSec: 0.5,
      easing: "outExpo",
      until: 26,
      exitDurationSec: 0.15,
    },
    { atWord: 23, op: "sfx", variant: "click", volume: 0.55 },

    {
      atWord: 27,
      op: "hline",
      id: "lowLine",
      y: HERO_LOW,
      label: "LOW",
      animDurationSec: 0.5,
      easing: "outExpo",
      until: 30,
      exitDurationSec: 0.15,
    },
    { atWord: 27, op: "sfx", variant: "click", volume: 0.55 },

    // ─── Color meaning: bullish caption on the hero, then bearish
    //     counterpart enters at t=4 for a side-by-side comparison ───
    {
      atWord: 31,
      op: "hookText",
      id: "greenCap",
      text: "GREEN = closed higher",
      at: { x: 0.5, y: 0.82 },
      size: "caption",
      animDurationSec: 0.5,
      easing: "outExpo",
      until: 35,
      exitDurationSec: 0.2,
    },
    { atWord: 31, op: "sfx", variant: "pop", volume: 0.5 },

    // Bearish candle enters at t=4 (right of hero at t=2). TvChartLayer
    // now handles multiple candles beats and merges them into the same
    // series time-sorted.
    {
      atWord: 36,
      op: "candles",
      id: "bearish",
      candles: BEARISH,
      tStart: 4,
      anim: "draw",
      animDurationSec: 0.6,
    },
    { atWord: 36, op: "sfx", variant: "pop", volume: 0.55 },
    {
      atWord: 36,
      op: "hookText",
      id: "redCap",
      text: "RED = closed lower",
      at: { x: 0.5, y: 0.82 },
      size: "caption",
      animDurationSec: 0.5,
      easing: "outExpo",
      until: 40,
      exitDurationSec: 0.2,
    },

    // ─── Close ───────────────────────────────────────────────────────
    // Positioned in the band above the chart (below the "Candlesticks"
    // title) so it never overlaps the candles that stay visible below.
    {
      atWord: 41,
      op: "hookText",
      id: "close",
      text: "One candle. One full story.",
      at: { x: 0.5, y: 0.22 },
      size: "title",
      animDurationSec: 0.8,
      easing: "outExpo",
    },
    { atWord: 41, op: "sfx", variant: "swell", volume: 0.45 },
  ],
};
