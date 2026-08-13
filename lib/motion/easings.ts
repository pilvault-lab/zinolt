/**
 * Motion library — cubic-bezier easings.
 *
 * Each easing exports:
 *   1. `<name>Curve` — the 4-number control-point tuple, for use with
 *      Remotion's `Easing.bezier(...curve)`.
 *   2. `<name>` — a `(t) => number` function backed by `bezier-easing`,
 *      for direct evaluation outside a Remotion context.
 */
import BezierEasing from "bezier-easing";

export type BezierCurve = readonly [number, number, number, number];

/** After Effects "Ease Out" — fast start, smooth landing. */
export const aeEaseOutCurve: BezierCurve = [0.05, 0.9, 0.1, 1.0];

/** Gentle in-and-out (CSS `ease`-alike). */
export const easyEaseCurve: BezierCurve = [0.33, 1, 0.68, 1];

/** Exponential ramp — flat-slow, sharp mid, flat-slow. */
export const expoRampCurve: BezierCurve = [0.87, 0, 0.13, 1];

/** Smooth "cinematic" arrival — long tail, decisive settle. */
export const smoothZCurve: BezierCurve = [0.16, 1, 0.3, 1];

// Callable forms — same names without the "Curve" suffix.
export const aeEaseOut = BezierEasing(...aeEaseOutCurve);
export const easyEase  = BezierEasing(...easyEaseCurve);
export const expoRamp  = BezierEasing(...expoRampCurve);
export const smoothZ   = BezierEasing(...smoothZCurve);

export const EASINGS = {
  aeEaseOut: { fn: aeEaseOut, curve: aeEaseOutCurve },
  easyEase:  { fn: easyEase,  curve: easyEaseCurve  },
  expoRamp:  { fn: expoRamp,  curve: expoRampCurve  },
  smoothZ:   { fn: smoothZ,   curve: smoothZCurve   },
} as const;
export type EasingName = keyof typeof EASINGS;
