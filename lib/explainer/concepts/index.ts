import type { ConceptScript } from "../types";
import { candlesticksConcept } from "./candlesticks";
import { fvgConcept } from "./fvg";
import { tickerConcept } from "./ticker";
import { whatIsTradingConcept } from "./what-is-trading";

export const CONCEPTS: readonly ConceptScript[] = [
  candlesticksConcept,
  fvgConcept,
  tickerConcept,
  whatIsTradingConcept,
] as const;

export function getConcept(id: string | null | undefined): ConceptScript | undefined {
  if (!id) return undefined;
  return CONCEPTS.find((c) => c.id === id);
}
