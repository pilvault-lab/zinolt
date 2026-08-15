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

export type BeatAnim = "draw" | "fade" | "pop";

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
  | PulseBeat;

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
  beats: Beat[];
};
