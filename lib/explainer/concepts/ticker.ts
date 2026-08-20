import type { ConceptScript } from "../types";

/**
 * Lesson 7 — What Is a Ticker?
 *
 * Infographic layout, full-bleed. No card frames — naked type only.
 *
 * Timing rule: no two beats occupy the same space at the same time. Every
 * outgoing beat's `until` fires at least one word before the next beat's
 * `atWord`, and exit fades are short (0.15s). Rapid-cadence beats
 * (montage) use hard cuts (exitDurationSec: 0) so they snap.
 */

const NARRATION = [
  // 0-6
  "Apple isn't called Apple on Wall Street.",
  // 7-9
  "It's called AAPL.",
  // 10-20
  "A ticker is a short symbol that identifies a financial instrument.",
  // 21-23
  "Stocks have them.",
  // 24-26
  "Indexes have them.",
  // 27-39
  "And futures have them too, sometimes in a full and a mini version.",
  // 40-45
  "Every chart, every order, every alert.",
  // 46-50
  "It all runs on tickers.",
  // 51-58
  "Learn the symbol before you trade the chart.",
].join(" ");

export const tickerConcept: ConceptScript = {
  id: "ticker",
  label: "What Is a Ticker?",
  narration: NARRATION,
  layout: "infographic",
  beats: [
    // ─── Hook ────────────────────────────────────────────────────────
    // Silent per reel defaults. Fades out on "It's" (word 7) before
    // AAPL enters at word 9. Two-word gap prevents overlap.
    {
      atWord: 0,
      op: "hookText",
      id: "hook",
      text: "Apple isn't “Apple.”",
      at: { x: 0.5, y: 0.42 },
      size: "hero",
      animDurationSec: 0.7,
      easing: "outExpo",
      until: 7,
      exitDurationSec: 0.25,
    },

    // ─── Definition ──────────────────────────────────────────────────
    // Big AAPL symbol + "Apple Inc." subtitle. Naked type, no frame.
    // Fades on "instrument." (word 20), one word before Stocks row.
    {
      atWord: 9,
      op: "symbolCard",
      id: "aaplHero",
      symbol: "AAPL",
      subtitle: "Apple Inc.",
      at: { x: 0.5, y: 0.42 },
      size: "hero",
      animDurationSec: 0.9,
      easing: "outExpo",
      until: 20,
      exitDurationSec: 0.2,
    },
    { atWord: 9, op: "sfx", variant: "click", volume: 0.55 },
    {
      atWord: 10,
      op: "hookText",
      id: "defCaption",
      text: "a symbol that identifies an instrument",
      at: { x: 0.5, y: 0.62 },
      size: "caption",
      animDurationSec: 0.7,
      easing: "outExpo",
      until: 20,
      exitDurationSec: 0.2,
    },

    // ─── Category rows ───────────────────────────────────────────────
    // Each row: label above, symbols below. Rows share the same slot;
    // one word gap between outgoing `until` and incoming `atWord`
    // keeps them fully separated in time.
    {
      atWord: 21,
      op: "row",
      id: "rowStocks",
      title: "Stocks",
      items: [
        { symbol: "AAPL", subtitle: "Apple" },
        { symbol: "TSLA", subtitle: "Tesla" },
      ],
      y: 0.5,
      itemSize: "medium",
      animDurationSec: 0.6,
      easing: "linear",
      until: 23,
      exitDurationSec: 0.2,
    },
    { atWord: 21, op: "sfx", variant: "pop", volume: 0.5 },

    {
      atWord: 24,
      op: "row",
      id: "rowIndexes",
      title: "Indexes",
      items: [{ symbol: "SPX", subtitle: "S&P 500" }],
      y: 0.5,
      itemSize: "medium",
      animDurationSec: 0.6,
      easing: "linear",
      until: 26,
      exitDurationSec: 0.2,
    },
    { atWord: 24, op: "sfx", variant: "pop", volume: 0.5 },

    {
      atWord: 27,
      op: "row",
      id: "rowFutures",
      title: "Futures",
      items: [
        { symbol: "NQ", subtitle: "Nasdaq (full)" },
        { symbol: "MNQ", subtitle: "Nasdaq (mini)" },
      ],
      y: 0.5,
      itemSize: "medium",
      animDurationSec: 0.6,
      easing: "linear",
      until: 39,
      exitDurationSec: 0.2,
    },
    { atWord: 27, op: "sfx", variant: "pop", volume: 0.5 },

    // ─── Montage ─────────────────────────────────────────────────────
    // Same slot at y=0.4, hard-cut between phrases for snap. Anchor
    // ticker sits below at y=0.62 the whole time — different y, no
    // collision with the cycling montage line.
    {
      atWord: 40,
      op: "hookText",
      id: "mChart",
      text: "every chart",
      at: { x: 0.5, y: 0.4 },
      size: "title",
      animDurationSec: 0.35,
      easing: "outExpo",
      until: 42,
      exitDurationSec: 0,
    },
    { atWord: 40, op: "sfx", variant: "tick", volume: 0.5 },
    {
      atWord: 42,
      op: "hookText",
      id: "mOrder",
      text: "every order",
      at: { x: 0.5, y: 0.4 },
      size: "title",
      animDurationSec: 0.35,
      easing: "outExpo",
      until: 44,
      exitDurationSec: 0,
    },
    { atWord: 42, op: "sfx", variant: "tick", volume: 0.5 },
    {
      atWord: 44,
      op: "hookText",
      id: "mAlert",
      text: "every alert",
      at: { x: 0.5, y: 0.4 },
      size: "title",
      animDurationSec: 0.35,
      easing: "outExpo",
      until: 50,
      exitDurationSec: 0.2,
    },
    { atWord: 44, op: "sfx", variant: "tick", volume: 0.5 },
    {
      atWord: 40,
      op: "symbolCard",
      id: "montageAnchor",
      symbol: "AAPL",
      at: { x: 0.5, y: 0.62 },
      size: "medium",
      animDurationSec: 0.6,
      easing: "outExpo",
      until: 50,
      exitDurationSec: 0.2,
    },

    // ─── Close ───────────────────────────────────────────────────────
    // Hero line first, then subtitle drops in below with a beat delay
    // so they don't animate in on top of each other.
    {
      atWord: 51,
      op: "hookText",
      id: "close",
      text: "Learn the symbol.",
      at: { x: 0.5, y: 0.42 },
      size: "hero",
      animDurationSec: 0.8,
      easing: "outExpo",
    },
    {
      atWord: 55,
      op: "hookText",
      id: "closeSub",
      text: "Before you trade the chart.",
      at: { x: 0.5, y: 0.55 },
      size: "title",
      animDurationSec: 0.8,
      easing: "outExpo",
    },
    { atWord: 51, op: "sfx", variant: "swell", volume: 0.45 },
  ],
};
