/**
 * Declarative diagram scripts for Concept Reels.
 *
 * A `ConceptScript` is: narration text + a list of Beats. Each Beat fires at
 * a word index in the narration — the TTS gives us word-level timestamps, so
 * a beat that fires at `atWord: 12` will land exactly when the narrator says
 * the 13th word.
 *
 * Primitives are simple by design. If you need a diagram the primitives can't
 * express, add a new primitive rather than an escape hatch.
 */

/** One "OHLC" candle on a chart. Prices in data units (whatever the chart configures). */
export type Candle = { open: number; close: number; high: number; low: number };

/** Data-space point on a chart. */
export type ChartPoint = { t: number; y: number };

/** Screen-space point (for `label`, `arrow` in absolute coords). */
export type ScreenPoint = { x: number; y: number };

export type BeatAnim = "draw" | "fade" | "pop" | "slideUp" | "slideDown";

/**
 * Easing curves — After-Effects grade motion. Applied to the raw entry
 * progress before it drives visual state. Default is "outExpo" (fast in,
 * gentle settle) which reads as premium on almost every primitive.
 */
export type Easing =
  | "linear"
  | "outExpo"
  | "outQuint"
  | "outBack"
  | "inCubic"
  | "inOutQuart";

/** Base fields shared by every beat. */
type BeatBase = {
  /** Word index in the narration that triggers this beat (0-based). */
  atWord: number;
  /** Optional identifier so later beats can reference this primitive (e.g. pulse). */
  id?: string;
  /** Animation used when this beat first appears. Default: "draw" for shapes, "fade" for text. */
  anim?: BeatAnim;
  /** How long the entry animation runs (seconds). Default 0.5. */
  animDurationSec?: number;
  /**
   * Easing applied to the entry progress. Default "outExpo". Set "linear"
   * for beats that already drive their own timing curve (e.g. per-letter
   * stagger in `symbolCard`).
   */
  easing?: Easing;
  /**
   * Word index at which this primitive fades out. Omit to keep it on-screen
   * for the rest of the reel. Ignored for `sfx` and `pulse` beats.
   */
  until?: number;
  /**
   * How long the exit fade runs (seconds). Default 0.15 — snappy exits so
   * successive beats don't visibly overlap when sequenced back-to-back.
   * Keep this short and use ease "inCubic" for a natural drop-off.
   */
  exitDurationSec?: number;
};

export type CandlesBeat = BeatBase & {
  op: "candles";
  /** Candle data. Chart maps timeIndex → x, price → y. */
  candles: Candle[];
  /** Starting time index (default 0). */
  tStart?: number;
};

export type HLineBeat = BeatBase & {
  op: "hline";
  /** Price level. */
  y: number;
  /** Optional label rendered at the right end. */
  label?: string;
};

export type VLineBeat = BeatBase & {
  op: "vline";
  /** Time index. */
  t: number;
  label?: string;
};

export type LineBeat = BeatBase & {
  op: "line";
  points: ChartPoint[];
  /** Draw an arrowhead at the terminal point once the line finishes drawing. */
  arrowEnd?: boolean;
};

export type ZoneBeat = BeatBase & {
  op: "zone";
  /** Price range (y1 < y2, but engine tolerates either order). */
  y1: number;
  y2: number;
  /** Time-index range on the chart. */
  t1: number;
  t2: number;
  label?: string;
  /** Fill tint. Default: white 12%. */
  color?: string;
};

export type MarkerBeat = BeatBase & {
  op: "marker";
  at: ChartPoint;
  label?: string;
  /** Where the label sits relative to the marker. Default "above". */
  labelPos?: "above" | "below" | "left" | "right";
};

export type ArrowBeat = BeatBase & {
  op: "arrow";
  from: ChartPoint;
  to: ChartPoint;
  /** Curve style. Default "straight". */
  curve?: "straight" | "arc";
};

export type AnnotationBeat = BeatBase & {
  op: "annotation";
  /** id of a previously-added primitive whose center we anchor to. */
  target: string;
  text: string;
  /** Where the annotation text sits relative to the target. Default "above". */
  side?: "above" | "below" | "left" | "right";
};

export type LabelBeat = BeatBase & {
  op: "label";
  /** Screen-space in composition coordinates (1080×1920). */
  at: ScreenPoint;
  text: string;
  /** Font size. Default 42. */
  size?: number;
};

export type BracketBeat = BeatBase & {
  op: "bracket";
  /** Price range measured. */
  y1: number;
  y2: number;
  /** Time index the bracket sits at (right side of chart by default). */
  t: number;
  label?: string;
};

export type PulseBeat = BeatBase & {
  op: "pulse";
  target: string;
  /** Pulse duration in seconds. Default 0.6. */
  durationSec?: number;
};

/* ─── Infographic primitives (non-chart layouts) ─────────────────────────── */

/**
 * Screen-space anchor used by infographic beats. Coordinates are fractions
 * of the 1080×1920 composition (0..1), so beats stay resolution-agnostic and
 * relative to the safe area. `y: 0.45` sits above center to clear the
 * concept-clip caption zone.
 */
export type FracPoint = { x: number; y: number };

/** Hero hook line — the big pattern-break opener. Center-aligned by default. */
export type HookTextBeat = BeatBase & {
  op: "hookText";
  text: string;
  /** Fractional position (default {x:0.5, y:0.45}). */
  at?: FracPoint;
  /** Visual weight. "hero" is the opening line; "caption" is a supporting line. */
  size?: "hero" | "title" | "caption";
};

/** Framed ticker tile. Symbol is monospace, subtitle is optional smaller text. */
export type SymbolCardBeat = BeatBase & {
  op: "symbolCard";
  symbol: string;
  subtitle?: string;
  /** Fractional position of the card center (default {x:0.5, y:0.5}). */
  at?: FracPoint;
  /** "hero" fills the middle band; "medium" for row items; "small" for footnotes. */
  size?: "hero" | "medium" | "small";
  /** Enable per-letter stagger reveal for the symbol. Default true. */
  letterStagger?: boolean;
};

/** Row of symbol cards with an optional group label. Handles stagger internally. */
export type RowBeat = BeatBase & {
  op: "row";
  /** Group label rendered above the row (e.g. "Stocks", "Futures"). */
  title?: string;
  items: Array<{ symbol: string; subtitle?: string }>;
  /** Fractional Y for the row's vertical center (default 0.5). */
  y?: number;
  /** Stagger between item entries in seconds (default 0.09). */
  staggerSec?: number;
  /** Card size for row items (default "medium"). */
  itemSize?: "medium" | "small";
};

/**
 * Sound-effect beat. Fires at `atWord` and plays the audio asset associated
 * with `variant`. Playback is gated by the composition's SFX_MANIFEST — if
 * a variant isn't registered (asset not yet dropped in), the beat is a
 * silent no-op. This keeps scripts declarative without breaking preview.
 */
export type SfxVariant =
  | "click"
  | "pop"
  | "tick"
  | "ding"
  | "swell"
  | "whoosh";
export type SfxBeat = BeatBase & {
  op: "sfx";
  variant: SfxVariant;
  /** Volume 0..1. Default 0.6. */
  volume?: number;
};

export type Beat =
  | CandlesBeat
  | HLineBeat
  | VLineBeat
  | LineBeat
  | ZoneBeat
  | MarkerBeat
  | ArrowBeat
  | AnnotationBeat
  | LabelBeat
  | BracketBeat
  | PulseBeat
  | HookTextBeat
  | SymbolCardBeat
  | RowBeat
  | SfxBeat;

export type ChartConfig = {
  /** Price range covered by the y-axis. */
  priceMin: number;
  priceMax: number;
  /** Number of time slots on the x-axis (candles/points sit at integer t). */
  timeSteps: number;
  /** Show y-axis price labels on the right. Default true. */
  showPriceAxis?: boolean;
  /** Show a subtle grid. Default true. */
  showGrid?: boolean;
};

export type ConceptScript = {
  id: string;
  label: string;
  /** Narration read by the TTS. Word indices in beats align with this text. */
  narration: string;
  /** Chart viewport. Omit for pure-text/label scripts. */
  chart?: ChartConfig;
  /**
   * "chart" (default) shows the concept label as a top title band and draws
   * the chart frame. "infographic" hides both — the beats own the frame.
   * Use "infographic" for typography-driven lessons like tickers, definitions,
   * or side-by-side comparisons.
   */
  layout?: "chart" | "infographic";
  beats: Beat[];
};
