/**
 * Motion library — reusable helper functions.
 *
 * These are frame-driven, framework-agnostic. Import into any Remotion
 * composition (or any other place you want AE-flavored motion timing).
 */
import { aeEaseOut } from "./easings";

/**
 * `velocityBlur` — motion blur amount from the frame-over-frame change of
 * a value function. Cheap approximation used for cinematic fast motion at
 * 60fps without expensive per-frame stochastic sampling.
 *
 * @param frame     current frame index
 * @param valueFn   frame -> number; e.g. current Y position of an element
 * @param maxPx     cap on blur pixels (default 12)
 * @param scale     scalar on |v(f)-v(f-1)|, default 0.4
 * @returns         blur pixels, clamped to [0, maxPx]
 */
export function velocityBlur(
  frame: number,
  valueFn: (f: number) => number,
  maxPx = 12,
  scale = 0.4,
): number {
  if (frame <= 0) return 0;
  const now = valueFn(frame);
  const prev = valueFn(frame - 1);
  const delta = Math.abs(now - prev);
  return Math.min(maxPx, delta * scale);
}

/**
 * `staggerDelay` — cascading entrance delay for a list of siblings.
 *   framesPer * index
 *
 * Kept as a one-liner for grep-ability at the call site.
 */
export function staggerDelay(index: number, framesPer = 3): number {
  return Math.max(0, Math.round(index * framesPer));
}

/**
 * `impactPop` — brief scale recoil triggered at a given frame. Useful for
 * "slam" or "lock-in" moments. Rises to `peak` at ~50% of `dur`, returns
 * to 1.0 by frame `triggerFrame + dur`.
 *
 * @returns scale multiplier (1.0 = neutral)
 */
export function impactPop(
  frame: number,
  triggerFrame: number,
  peak = 1.03,
  dur = 8,
): number {
  const local = frame - triggerFrame;
  if (local < 0 || local > dur) return 1;
  // Symmetric ease around midpoint via a squared parabola sampled through aeEaseOut.
  const t = local / dur;
  const parabola = 1 - Math.abs(2 * t - 1); // triangle 0 → 1 → 0
  const eased = aeEaseOut(parabola);
  return 1 + (peak - 1) * eased;
}
