import type { ConceptScript } from "../types";

/**
 * Fair Value Gap (bullish) — three-candle imbalance.
 *
 * The gap is the untraded zone between candle 1's high and candle 3's low
 * when candle 2 leaves a wide impulse between them.
 *
 * Word indices are 0-based over the `narration` split on whitespace.
 * Ranges below are approximate — the TTS will pin them to actual timestamps.
 */

const NARRATION =
  "A Fair Value Gap is a three-candle pattern where price moves so fast it skips a level. " +
  "Look at candle one's high. Look at candle three's low. " +
  "Everything between? Nobody traded there. That's the gap. " +
  "And price tends to come back and fill it, because that untouched zone is unfinished business.";

// Candles designed so C1.high < C3.low → a clean bullish FVG.
// Prices in arbitrary units (chart maps them to screen).
const CANDLES = [
  { open: 100, close: 104, high: 106, low: 99 },   // t=1
  { open: 104, close: 114, high: 115, low: 103 },  // t=2 (impulse)
  { open: 114, close: 116, high: 117, low: 108 },  // t=3
];

const C1_HIGH = CANDLES[0].high; // 106
const C3_LOW = CANDLES[2].low;   // 108

export const fvgConcept: ConceptScript = {
  id: "fvg",
  label: "Fair Value Gap",
  narration: NARRATION,
  chart: {
    priceMin: 96,
    priceMax: 122,
    timeSteps: 5,        // candles at t=1,2,3 leaving margins
    showPriceAxis: true,
    showGrid: true,
  },
  // Narration word indices (0-based, whitespace-split):
  // 0:A 1:Fair 2:Value 3:Gap 4:is 5:a 6:three-candle 7:pattern 8:where
  // 9:price 10:moves 11:so 12:fast 13:it 14:skips 15:a 16:level.
  // 17:Look 18:at 19:candle 20:one's 21:high. 22:Look 23:at 24:candle
  // 25:three's 26:low. 27:Everything 28:between? 29:Nobody 30:traded
  // 31:there. 32:That's 33:the 34:gap. 35:And 36:price 37:tends 38:to
  // 39:come 40:back 41:and 42:fill 43:it, ...
  beats: [
    // Draw candles as narrator says "three-candle pattern"
    {
      atWord: 6,
      op: "candles",
      id: "candles",
      candles: CANDLES,
      tStart: 1,
      anim: "draw",
      animDurationSec: 0.9,
    },
    // Marker on C1 high — lands on the word "high."
    {
      atWord: 21,
      op: "marker",
      id: "c1High",
      at: { t: 1, y: C1_HIGH },
      label: "C1 high",
      labelPos: "left",
    },
    // Marker on C3 low — lands on the word "low."
    {
      atWord: 26,
      op: "marker",
      id: "c3Low",
      at: { t: 3, y: C3_LOW },
      label: "C3 low",
      labelPos: "right",
    },
    // "Everything between?" — reveal the gap zone.
    {
      atWord: 27,
      op: "zone",
      id: "gap",
      y1: C1_HIGH,
      y2: C3_LOW,
      t1: 0.6,
      t2: 4.4,
      anim: "fade",
      animDurationSec: 0.6,
    },
    // "That's the gap." — annotate. Use "above" so the label sits in the
    // empty space above the zone rather than off-screen to the right.
    {
      atWord: 32,
      op: "annotation",
      target: "gap",
      text: "Fair Value Gap",
      side: "above",
      animDurationSec: 0.9,
    },
    // "And price tends to come back..." — pulse the zone.
    {
      atWord: 37,
      op: "pulse",
      target: "gap",
      durationSec: 1.0,
    },
    // "...and fill it" — draw the return path landing in the gap.
    {
      atWord: 42,
      op: "line",
      id: "returnPath",
      points: [
        { t: 3.5, y: 118 },
        { t: 4.0, y: 115 },
        { t: 4.4, y: 111 },
        { t: 4.6, y: (C1_HIGH + C3_LOW) / 2 },
      ],
      anim: "draw",
      animDurationSec: 1.0,
    },
  ],
};
