import type { ToolResultCard } from "./card-types.js";

export function shouldUpdateToolResultInPlace(
  previousCard: ToolResultCard | null,
  nextCard: ToolResultCard,
  previousExpanded: boolean,
  nextExpanded: boolean,
  hasMountedPayload: boolean,
): boolean {
  return Boolean(
    previousCard &&
      previousCard.tool === nextCard.tool &&
      previousExpanded &&
      nextExpanded &&
      hasMountedPayload,
  );
}
