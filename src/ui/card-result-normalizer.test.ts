import assert from "node:assert/strict";
import test from "node:test";
import { withContentFallback } from "./card-result-normalizer.js";
import type { ToolResultCard } from "./card-types.js";

const baseCard: ToolResultCard = {
  tool: "read",
  payload: {},
};

test("card result normalizer reuses top-level MCP content without losing payload fields", () => {
  const normalized = withContentFallback(
    { ...baseCard, tool: "write", payload: { patch: "@@ -1 +1 @@" } },
    { content: [{ type: "text", text: "written" }] },
  );

  assert.deepEqual(normalized.payload, {
    patch: "@@ -1 +1 @@",
    content: [{ type: "text", text: "written" }],
  });
});

test("card result normalizer preserves an explicit card payload", () => {
  const card: ToolResultCard = {
    ...baseCard,
    payload: { content: [{ type: "text", text: "authoritative card content" }] },
  };
  const normalized = withContentFallback(card, {
    content: [{ type: "text", text: "transport content" }],
  });

  assert.equal(normalized, card);
});

test("card result normalizer keeps image content available to the lazy renderer", () => {
  const normalized = withContentFallback(baseCard, {
    content: [{ type: "image", data: "encoded", mimeType: "image/png" }],
  });

  assert.deepEqual(normalized.payload?.content, [
    { type: "image", data: "encoded", mimeType: "image/png" },
  ]);
});
