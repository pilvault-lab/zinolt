/**
 * Caption style + layout knobs. Change everything from one file — the
 * ASS emitter reads only from here.
 */

export const CAPTIONS_CONFIG = {
  /** Never exceed this many words per group. */
  MAX_WORDS_PER_GROUP: 4,
  /** Push the group up to this many words if the natural cut lands on a filler. */
  ORPHAN_EXTEND_TO: 6,

  /** Font. Must be installed in the /public/brand fonts dir. */
  FONTNAME: "Vernavle",
  /** ASS em-height default. Roughly 5.7% of 1920 → ~110px em ≈ 5% cap-height. */
  FONTSIZE_DEFAULT: 110,
  /** Auto-shrink floor when text overflows the target width. */
  FONTSIZE_MIN: 72,
  /** Fraction of 1080 the text row is allowed to occupy before shrinking. */
  TARGET_WIDTH_PCT: 0.85,
  /** Rough average glyph width as a fraction of em (Vernavle-ish). */
  AVG_GLYPH_WIDTH_EM: 0.5,

  /** Text color — pure white. ASS colour is &H<alpha><B><G><R>. */
  PRIMARY_COLOUR: "&H00FFFFFF",

  /** Soft drop shadow — no outline, no box. */
  OUTLINE_PX: 0,
  /** Shadow offset (px). */
  SHADOW_PX: 4,
  /** Shadow blur (applied via inline \blur tag — libass). */
  SHADOW_BLUR: 5,
  /** Shadow colour + alpha (ASS: &H<AA><BB><GG><RR>). AA=00 opaque, FF transparent. */
  SHADOW_COLOUR: "&H50000000", // black, ~69% opacity

  /**
   * Y-position as a fraction of frame height (1920). Anchored via
   * Alignment 5 (middle-center) + \pos(x,y).
   *   full-bleed: 0.45 — just below true center per spec
   *   letterboxed: 0.60 — lower third of the source video band
   */
  FULLBLEED_Y_FRAC: 0.45,
  LETTERBOXED_Y_FRAC: 0.60,

  /** Horizontal anchor — always centered. */
  X_CENTER_FRAC: 0.5,
} as const;

/** Words that must never end a group (looks like an orphaned trailing article/prep/aux). */
export const CAPTION_FILLER_WORDS = new Set([
  "the", "a", "an",
  "to", "of", "in", "on", "at", "by", "for", "from", "with", "into", "onto",
  "and", "or", "but", "so", "if", "as",
  "is", "are", "was", "were", "am", "be", "been", "being",
  "will", "would", "could", "should", "may", "might", "can", "shall",
  "that", "this", "these", "those",
  "my", "your", "his", "her", "our", "their", "its",
  "i", "you", "he", "she", "we", "they", "it",
]);
