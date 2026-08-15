import type { ConceptScript } from "../types";
import { fvgConcept } from "./fvg";
import { whatIsTradingConcept } from "./what-is-trading";

export const CONCEPTS: readonly ConceptScript[] = [
  fvgConcept,
  whatIsTradingConcept,
] as const;

export function getConcept(id: string | null | undefined): ConceptScript | undefined {
  if (!id) return undefined;
  return CONCEPTS.find((c) => c.id === id);
}
