import type { ConceptScript } from "../types";

/**
 * Fair Value Gap (bullish) — three-candle imbalance.
 *
 * Rendered on a real lightweight-charts canvas (renderer: "tv").
 *
 * Layout rules for clean teaching:
 *  - Candles carry visible wicks on both sides so the descent to C3's low
 *    reads as a real wick, not a phantom line.
 *  - The FVG zone sits in the "future" (past C3) — it doesn't extend back
 *    over the candles that formed it, so nothing overlaps a wick.
 *  - Markers use `labelPos: "above"` on C3 so the "C3 low" label clears the
 *    zone rectangle underneath.
 *  - The return-path arrow terminates INSIDE the zone rectangle.
 */

const NARRATION =
  "A Fair Value Gap is a three-candle pattern where price moves so fast it skips a level. " +
  "Look at candle one's high. Look at candle three's low. " +
  "Everything between? Nobody traded there. That's the gap. " +
  "And price tends to come back and fill it, because that untouched zone is unfinished business.";

// Candles designed so C1.high < C3.low → bullish FVG at 105..108.
// Every candle has meaningful wicks on both sides.
const CANDLES = [
  { open: 101, close: 103, high: 105, low: 98 },   // t=1 — small body, both wicks
  { open: 103, close: 112, high: 114, low: 101 },  // t=2 — impulse, wicks both sides
  { open: 112, close: 114, high: 117, low: 108 },  // t=3 — small body, big lower wick to 108
];

const C1_HIGH = CANDLES[0].high; // 105
const C3_LOW = CANDLES[2].low;   // 108

// Zone sits in the "future" — past C3 (t=3) into empty right-side space.
// Never overlaps any candle, so no wick collision.
const ZONE_T_START = 3.3;
const ZONE_T_END = 5.0;

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
    renderer: "tv",      // TradingView-native candles via lightweight-charts
  },
  // Word indices (0-based, whitespace-split):
  // 0:A 1:Fair 2:Value 3:Gap 4:is 5:a 6:three-candle 7:pattern 8:where
  // 9:price 10:moves 11:so 12:fast 13:it 14:skips 15:a 16:level.
  // 17:Look 18:at 19:candle 20:one's 21:high. 22:Look 23:at 24:candle
  // 25:three's 26:low. 27:Everything 28:between? 29:Nobody 30:traded
  // 31:there. 32:That's 33:the 34:gap. 35:And 36:price 37:tends 38:to
  // 39:come 40:back 41:and 42:fill 43:it, ...
  beats: [
    {
      atWord: 6,
      op: "candles",
      id: "candles",
      candles: CANDLES,
      tStart: 1,
      anim: "draw",
      animDurationSec: 0.9,
    },
    // "candle one's high" — mark C1.high, label to the LEFT so it clears
    // the candles and the future zone on the right.
    {
      atWord: 21,
      op: "marker",
      id: "c1High",
      at: { t: 1, y: C1_HIGH },
      label: "C1 high",
      labelPos: "left",
    },
    // "candle three's low" — mark C3.low. Label sits ABOVE the marker so
    // it doesn't cross the zone rectangle that starts just to the right.
    {
      atWord: 26,
      op: "marker",
      id: "c3Low",
      at: { t: 3, y: C3_LOW },
      label: "C3 low",
      labelPos: "above",
    },
    // "Everything between?" — reveal the gap zone in the future space.
    {
      atWord: 27,
      op: "zone",
      id: "gap",
      y1: C1_HIGH,
      y2: C3_LOW,
      t1: ZONE_T_START,
      t2: ZONE_T_END,
      anim: "fade",
      animDurationSec: 0.6,
    },
    // "That's the gap." — annotate above the C2 impulse candle so the
    // label doesn't collide with the tall body.
    {
      atWord: 32,
      op: "annotation",
      target: "gap",
      text: "Fair Value Gap",
      side: "above",
      offset: 300,
      animDurationSec: 0.9,
    },
    // Pulse the zone as narrator says "price tends to come back".
    {
      atWord: 37,
      op: "pulse",
      target: "gap",
      durationSec: 1.0,
    },
    // "...and fill it" — arrow curves down from top-right into the zone,
    // terminating INSIDE the box (t=3.9 is within 3.3..5, y=106.5 is
    // within 105..108).
    {
      atWord: 42,
      op: "line",
      id: "returnPath",
      points: [
        { t: 4.7, y: 116 },
        { t: 4.5, y: 112 },
        { t: 4.2, y: 109 },
        { t: 3.9, y: (C1_HIGH + C3_LOW) / 2 }, // 106.5 — center of the gap
      ],
      arrowEnd: true,
      anim: "draw",
      animDurationSec: 1.0,
    },
  ],
};
