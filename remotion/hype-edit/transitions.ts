import type React from "react";
import type { HypeTransition } from "@/lib/hype-edit/transitions-shared";

export type ItemEnter = {
  transform: string;
  filter?: string;
  opacity: number;
  overlay?: {
    background: string;
    opacity: number;
    mixBlendMode?: React.CSSProperties["mixBlendMode"];
  } | null;
};

const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export function transitionDurationSec(t: HypeTransition, bpm: number): number {
  // Faster BPM → shorter enter animation so transitions feel snappier.
  const scale = bpm >= 140 ? 0.7 : bpm >= 110 ? 0.85 : 1;
  switch (t) {
    case "cut":
      return 0.001;
    case "scale-punch":
      return 0.18 * scale;
    case "fade":
      return 0.14 * scale;
    case "glitch":
      return 0.14 * scale;
    case "flash":
      return 0.18 * scale;
  }
}

export function computeItemEnter(
  t: HypeTransition,
  elapsedSec: number,
  bpm: number,
): ItemEnter {
  const dur = transitionDurationSec(t, bpm);
  const raw = clamp01(elapsedSec / dur);
  const p = easeOut(raw);
  switch (t) {
    case "cut":
      return { transform: "scale(1)", opacity: 1, overlay: null };
    case "scale-punch": {
      // Zoom-out in place — no translation. 1.14 → 1.0.
      const s = 1.14 - 0.14 * p;
      const blur = (1 - p) * 6;
      return {
        transform: `scale(${s.toFixed(4)})`,
        filter: blur > 0.1 ? `blur(${blur.toFixed(2)}px)` : undefined,
        opacity: 1,
        overlay: null,
      };
    }
    case "fade": {
      // Pure opacity, no motion.
      return { transform: "scale(1)", opacity: p, overlay: null };
    }
    case "glitch": {
      const s = 1 + (1 - p) * 0.03;
      return {
        transform: `scale(${s.toFixed(4)})`,
        opacity: 1,
        overlay: {
          background:
            "linear-gradient(90deg, rgba(255,0,80,0.9), rgba(0,190,255,0.9))",
          opacity: (1 - p) * 0.55,
          mixBlendMode: "screen",
        },
      };
    }
    case "flash": {
      return {
        transform: "scale(1)",
        opacity: 1,
        overlay: { background: "#FFFFFF", opacity: 1 - p },
      };
    }
  }
}
