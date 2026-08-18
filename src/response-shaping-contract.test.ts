import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const srcDir = dirname(fileURLToPath(import.meta.url));
const serverSource = readFileSync(join(srcDir, "server.ts"), "utf8");
const uiSource = readFileSync(join(srcDir, "ui", "workspace-app.tsx"), "utf8");

test("MCP response shaping avoids duplicating top-level content in card payloads", () => {
  assert.doesNotMatch(serverSource, /payload:\s*\{\s*content\s*\}/);
  assert.doesNotMatch(serverSource, /payload:\s*\{\s*content:\s*response\.content/);
  assert.match(serverSource, /structuredContent:\s*\{[\s\S]*?result:\s*contentText\(response\.content\)/);
});

test("frontend reconstructs omitted card content from the top-level MCP result", () => {
  assert.match(uiSource, /withContentFallback/);
  assert.match(uiSource, /const nextCard = withContentFallback/);
});
