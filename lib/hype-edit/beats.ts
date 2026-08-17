/**
 * Beat grid + transition cycling for Hype Edit.
 *
 * All cuts land on beats derived from a BPM. Cut i occurs at time
 *   t_i = i × (60 / bpm)  seconds (i = 0, 1, 2, …)
 * Frame at cut i is `frames[i % frames.length]` — frames loop until the audio
 * ends.
 */

import type { HypeTransition } from "./transitions-shared";

export function beatIntervalSec(bpm: number): number {
  if (!bpm || bpm <= 0) return 0.5; // safe fallback
  return 60 / bpm;
}

/** Beat times (seconds) that fall within [0, durationSec). */
export function beatsInWindow(bpm: number, durationSec: number): number[] {
  const step = beatIntervalSec(bpm);
  if (durationSec <= 0 || step <= 0) return [];
  const out: number[] = [];
  const max = 4096; // hard cap so a bogus BPM can't blow up
  for (let i = 0; i < max; i++) {
    const t = i * step;
    if (t >= durationSec) break;
    out.push(t);
  }
  return out;
}

/**
 * Which cut (beat) index is active at time `tSec`?
 * Returns -1 before the first cut.
 */
export function cutIndexAt(bpm: number, tSec: number): number {
  const step = beatIntervalSec(bpm);
  if (step <= 0 || tSec < 0) return -1;
  return Math.floor(tSec / step);
}

/**
 * Only frame changes — no scale, fade, or flash between frames. The
 * `mode`/`bpm` params are kept for API symmetry with older call sites.
 */
export function transitionForBeat(
  _bpm: number,
  _beatIndex: number,
  _mode: "auto" | "hard" | "smooth" = "auto",
): HypeTransition {
  return "cut";
}
