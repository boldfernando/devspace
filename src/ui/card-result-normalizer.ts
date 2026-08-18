import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ToolContent, ToolResultCard } from "./card-types.js";

export function withContentFallback(
  nextCard: ToolResultCard,
  result: Pick<CallToolResult, "content">,
): ToolResultCard {
  if (nextCard.payload?.content || result.content.length === 0) return nextCard;

  const content: ToolContent[] = result.content
    .filter((item) => item.type === "text" || item.type === "image")
    .map((item) => item.type === "text"
      ? { type: "text", text: item.text }
      : { type: "image", data: item.data, mimeType: item.mimeType });

  if (content.length === 0) return nextCard;

  return {
    ...nextCard,
    payload: {
      ...nextCard.payload,
      content,
    },
  };
}
