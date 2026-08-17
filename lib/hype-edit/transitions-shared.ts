/**
 * Transition ids shared between the beat scheduler (lib) and the renderer
 * (remotion). Kept in lib so both trees can import without a circular ref.
 */
export const HYPE_TRANSITIONS = [
  "cut",
  "scale-punch",
  "fade",
  "glitch",
  "flash",
] as const;
export type HypeTransition = (typeof HYPE_TRANSITIONS)[number];
