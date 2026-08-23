import type { ConceptScript, Candle } from "../types";

/**
 * Support & Resistance — why price keeps bouncing.
 *
 * TV chart mode (renderer: "tv") for authentic chart aesthetics.
 * Two candles beats:
 *  1. The chop phase (12 candles bouncing between $100 and $110) reveals
 *     as the narrator sets up the concept.
 *  2. The breakdown + retest (2 candles) reveals when the narrator says
 *     "when support finally breaks" — the visual break lands in sync
 *     with the audio break.
 * Support hline fades as the breakdown happens; a red "NEW RESISTANCE"
 * hline enters at the same price during "it flips."
 */

const NARRATION = [
  // 0-4
  "Why does price keep bouncing?",
  // 5-11
  "Every chart has invisible floors and ceilings.",
  // 12-20
  "When price falls and holds, that level is support.",
  // 21-29
  "When it rises and stalls, that level is resistance.",
  // 30-39
  "The more times a level holds, the stronger it becomes.",
  // 40-46
  "And when support finally breaks, it flips.",
  // 47-52
  "Old support turns into new resistance.",
  // 53-58
  "Find the levels. Watch them work.",
].join(" ");

// Colors mirror the standing TV palette rule.
const GREEN = "#26A69A"; // support
const RED = "#EF5350";   // resistance / flipped

// ─── Chart data ─────────────────────────────────────────────────────────
// Prices in a tight $95–$112 range. Support level: $100. Resistance: $110.
// Bars 0-11 chop and test both levels 3× each. Bars 12-13 are the breakdown
// + retest (revealed later in a second candles beat).

const CHOP: Candle[] = [
  { open: 105, close: 103, high: 106, low: 102 },   // 0
  { open: 103, close: 106, high: 107, low: 102 },   // 1
  { open: 106, close: 102, high: 107, low: 101 },   // 2
  { open: 102, close: 100.5, high: 103, low: 100 }, // 3 approach support
  { open: 100.5, close: 103, high: 103.5, low: 99.8 }, // 4 BOUNCE
  { open: 103, close: 107, high: 108, low: 102.5 }, // 5 rise
  { open: 107, close: 108, high: 110.2, low: 106.5 }, // 6 REJECT
  { open: 108, close: 101, high: 108.5, low: 100.1 }, // 7 BOUNCE
  { open: 101, close: 108, high: 110.3, low: 100.5 }, // 8 REJECT
  { open: 108, close: 101, high: 108.5, low: 99.9 },  // 9 BOUNCE
  { open: 101, close: 108, high: 110.1, low: 100.5 }, // 10 REJECT
  { open: 108, close: 102, high: 108.5, low: 101 },   // 11 drift down
];

const BREAKDOWN: Candle[] = [
  { open: 102, close: 97, high: 102.5, low: 96 },   // 12 BREAKDOWN through $100
  { open: 97, close: 98.5, high: 100, low: 97 },     // 13 retest of $100 from below
];

export const supportResistanceConcept: ConceptScript = {
  id: "support-resistance",
  label: "Support & Resistance",
  narration: NARRATION,
  chart: {
    priceMin: 94,
    priceMax: 112,
    timeSteps: 15,          // 14 candles + right-side margin
    showPriceAxis: true,
    showGrid: true,
    // SVG renderer — Projector draws bodies AND wicks in the same coord
    // space, so wicks are pixel-centered on their body by construction.
    // TV mode drifts x-position vs the SVG overlay.
    renderer: "svg",
  },
  // Word indices (0-based, whitespace-split):
  // 0:Why 1:does 2:price 3:keep 4:bouncing?
  // 5:Every 6:chart 7:has 8:invisible 9:floors 10:and 11:ceilings.
  // 12:When 13:price 14:falls 15:and 16:holds, 17:that 18:level 19:is 20:support.
  // 21:When 22:it 23:rises 24:and 25:stalls, 26:that 27:level 28:is 29:resistance.
  // 30:The 31:more 32:times 33:a 34:level 35:holds, 36:the 37:stronger 38:it 39:becomes.
  // 40:And 41:when 42:support 43:finally 44:breaks, 45:it 46:flips.
  // 47:Old 48:support 49:turns 50:into 51:new 52:resistance.
  // 53:Find 54:the 55:levels. 56:Watch 57:them 58:work.
  beats: [
    // ─── Hook (silent) ───────────────────────────────────────────────
    {
      atWord: 0,
      op: "hookText",
      id: "hook",
      text: "Why does price keep bouncing?",
      at: { x: 0.5, y: 0.42 },
      size: "title",
      animDurationSec: 0.7,
      easing: "outExpo",
      until: 4,
      exitDurationSec: 0.25,
    },

    // ─── Chart establishment (chop phase) ────────────────────────────
    {
      atWord: 5,
      op: "candles",
      id: "chop",
      candles: CHOP,
      tStart: 0,
      anim: "draw",
      animDurationSec: 2.4,
      easing: "linear",
    },
    { atWord: 5, op: "sfx", variant: "pop", volume: 0.5 },
    {
      atWord: 5,
      op: "hookText",
      id: "setupCap",
      text: "invisible floors and ceilings",
      at: { x: 0.5, y: 0.82 },
      size: "caption",
      animDurationSec: 0.6,
      easing: "outExpo",
      until: 11,
      exitDurationSec: 0.2,
    },

    // ─── SUPPORT ─────────────────────────────────────────────────────
    // Green dashed line at $100. Stays visible through the resistance
    // teach, the "stronger" pulses, and the breakdown — fades on "breaks."
    {
      atWord: 17,
      op: "hline",
      id: "support",
      y: 100,
      label: "SUPPORT",
      color: GREEN,
      animDurationSec: 0.6,
      easing: "outExpo",
      until: 44,
      exitDurationSec: 0.35,
    },
    { atWord: 17, op: "sfx", variant: "click", volume: 0.55 },

    // ─── RESISTANCE ──────────────────────────────────────────────────
    // Red dashed line at $110. Stays on-screen through the flip so the
    // viewer keeps the context of the range.
    {
      atWord: 25,
      op: "hline",
      id: "resistance",
      y: 110,
      label: "RESISTANCE",
      color: RED,
      animDurationSec: 0.6,
      easing: "outExpo",
    },
    { atWord: 25, op: "sfx", variant: "click", volume: 0.55 },

    // ─── "The more times a level holds..." — pulse to reinforce ──────
    { atWord: 30, op: "pulse", target: "support", durationSec: 0.7 },
    { atWord: 30, op: "sfx", variant: "ding", volume: 0.45 },
    { atWord: 33, op: "pulse", target: "resistance", durationSec: 0.7 },
    { atWord: 33, op: "sfx", variant: "ding", volume: 0.45 },
    { atWord: 37, op: "pulse", target: "support", durationSec: 0.7 },
    { atWord: 37, op: "sfx", variant: "ding", volume: 0.45 },

    // ─── BREAKDOWN + RETEST candles reveal ───────────────────────────
    // Second candles beat lets the breakdown land visually AS the
    // narrator says "when support finally breaks."
    {
      atWord: 42,
      op: "candles",
      id: "breakdown",
      candles: BREAKDOWN,
      tStart: 12,
      anim: "draw",
      animDurationSec: 1.4,
    },
    { atWord: 44, op: "sfx", variant: "pop", volume: 0.65 },

    // ─── FLIP: new resistance at the old support price ───────────────
    {
      atWord: 46,
      op: "hline",
      id: "newResistance",
      y: 100,
      label: "NEW RESISTANCE",
      color: RED,
      animDurationSec: 0.6,
      easing: "outExpo",
    },
    { atWord: 46, op: "sfx", variant: "ding", volume: 0.55 },
    // Pulse the flipped level once as narrator says "Old support turns
    // into new resistance."
    { atWord: 48, op: "pulse", target: "newResistance", durationSec: 0.9 },

    // ─── Close (stacked, both in the band above the chart) ───────────
    {
      atWord: 53,
      op: "hookText",
      id: "close1",
      text: "Find the levels.",
      at: { x: 0.5, y: 0.20 },
      size: "title",
      animDurationSec: 0.8,
      easing: "outExpo",
    },
    { atWord: 53, op: "sfx", variant: "swell", volume: 0.45 },
    {
      atWord: 56,
      op: "hookText",
      id: "close2",
      text: "Watch them work.",
      at: { x: 0.5, y: 0.28 },
      size: "title",
      animDurationSec: 0.8,
      easing: "outExpo",
    },
  ],
};
