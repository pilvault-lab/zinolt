import type { ConceptScript } from "../types";

/**
 * Text-mode concept: paragraph-per-scene, karaoke word-reveal inside each.
 * The narration below uses blank lines to break scenes, which is what the
 * Text mode of Concept Reel keys off.
 */

export const whatIsTradingConcept: ConceptScript = {
  id: "what-is-trading",
  label: "What is Trading?",
  narration: [
    "What is trading?",
    "Trading is exchanging one asset for another, hoping the one you take home is worth more later.",
    "Stocks, crypto, forex — the game is the same.",
    "Buy low. Sell high. Repeat.",
    "The hard part isn't the math. It's holding your nerve when everyone else is panicking.",
  ].join("\n\n"),
  beats: [], // text mode ignores beats
};
