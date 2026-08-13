/**
 * Motion library — spring presets for use with Remotion's `spring()`.
 *
 * Named by feel, not by physics. Reach for the preset that describes what
 * you want the element to DO, not the one you can most closely math out.
 */
import type { SpringConfig } from "remotion";

/** Snappy UI settles — fast in, tight settle, tiny overshoot. */
export const snappyUI: SpringConfig = { mass: 0.3, damping: 14, stiffness: 200, overshootClamping: false };

/** Overshoots the target and returns — for entrances that need weight. */
export const overshoot: SpringConfig = { mass: 0.5, damping: 10, stiffness: 120, overshootClamping: false };

/** Bouncy — comedic recoil for slams / drops. Use sparingly. */
export const bounce: SpringConfig = { mass: 0.8, damping: 8, stiffness: 100, overshootClamping: false };

/** Silky settle — for values coming to rest without visible ring. */
export const settle: SpringConfig = { mass: 0.6, damping: 12, stiffness: 140, overshootClamping: false };

export const SPRINGS = { snappyUI, overshoot, bounce, settle } as const;
export type SpringName = keyof typeof SPRINGS;
