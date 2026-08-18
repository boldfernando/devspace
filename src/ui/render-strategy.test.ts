import assert from "node:assert/strict";
import test from "node:test";
import { shouldUpdateToolResultInPlace } from "./render-strategy.js";
import type { ToolResultCard } from "./card-types.js";

const readCard: ToolResultCard = { tool: "read", payload: {} };

test("render strategy preserves a mounted payload for same-tool expanded updates", () => {
  assert.equal(
    shouldUpdateToolResultInPlace(readCard, { tool: "read", payload: {} }, true, true, true),
    true,
  );
});

test("render strategy remounts when tool identity or expansion changes", () => {
  assert.equal(
    shouldUpdateToolResultInPlace(readCard, { tool: "write", payload: {} }, true, true, true),
    false,
  );
  assert.equal(
    shouldUpdateToolResultInPlace(readCard, { tool: "read", payload: {} }, false, true, true),
    false,
  );
});

test("render strategy remounts when no mounted payload exists", () => {
  assert.equal(
    shouldUpdateToolResultInPlace(null, readCard, true, true, true),
    false,
  );
  assert.equal(
    shouldUpdateToolResultInPlace(readCard, { tool: "read", payload: {} }, true, true, false),
    false,
  );
});
