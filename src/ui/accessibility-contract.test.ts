import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string): string => readFileSync(join(here, name), "utf8");

test("workspace shell exposes accessible disclosure and live-status contracts", () => {
  const source = read("workspace-app.tsx");

  assert.match(source, /ariaControls: expandable \? detailsId : undefined/);
  assert.match(source, /role: "region"/);
  assert.match(source, /role: tone === "error" \? "alert" : "status"/);
  assert.match(source, /ariaLive: tone === "error" \? "assertive" : "polite"/);
  assert.match(source, /tabIndex: 0/);
  assert.match(source, /await import\("@modelcontextprotocol\/ext-apps"\)/);
  assert.match(source, /Try connecting to the host again/);
  assert.match(source, /This tool result could not be displayed/);
  assert.match(source, /Workflow progress/);
  assert.match(source, /role: "progressbar"/);
  assert.match(source, /journey-progress-details/);
  assert.match(source, /journey-milestone/);
  assert.match(source, /shouldUpdateToolResultInPlace/);
  assert.match(source, /updateRenderedCardInPlace/);
  assert.match(source, /withContentFallback/);
});

test("React payload renderers use stable memoized boundaries", () => {
  const workspace = read("workspace-app.tsx");
  const heavy = read("heavy-payload.tsx");
  const review = read("review-payload.tsx");
  const diff = read("diff-payload.tsx");
  const file = read("file-payload.tsx");

  assert.match(workspace, /journeyProgressContainer\?\.isConnected/);
  assert.match(heavy, /memo\(function HeavyPayload/);
  assert.match(heavy, /payloadOptionsEqual/);
  assert.match(review, /memo\(function ReviewPayload/);
  assert.match(review, /reviewOptionsEqual/);
  assert.match(diff, /memo\(function DiffPayload/);
  assert.match(diff, /useMemo\(\(\) =>/);
  assert.match(file, /memo\(function FilePayload/);
  assert.match(file, /\[path, themeType\]/);
});

test("review payload exposes file list and per-file diff relationships", () => {
  const source = read("review-payload.tsx");

  assert.match(source, /role="list"/);
  assert.match(source, /role="listitem"/);
  assert.match(source, /aria-controls=\{fileId\}/);
  assert.match(source, /aria-label=\{`Diff for \$\{fileLabel\}`\}/);
  assert.match(source, /tabIndex=\{0\}/);
});

test("lazy payload renderers provide accessible output and status semantics", () => {
  const heavyPayload = read("heavy-payload.tsx");
  const filePayload = read("file-payload.tsx");

  assert.match(heavyPayload, /aria-live=\{tone === "error" \? "assertive" : "polite"\}/);
  assert.match(heavyPayload, /aria-label=\{`\$\{card\.tool\} output/);
  assert.match(filePayload, /role="region"/);
  assert.match(filePayload, /aria-label=\{`File contents for \$\{path\}`\}/);
});

test("stylesheet protects keyboard focus, reduced motion, forced colors, and touch targets", () => {
  const css = read("workspace-app.css");

  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /forced-colors: active/);
  assert.match(css, /\.review-more[\s\S]*?min-height: 44px/);
  assert.match(css, /\.review-diff-file-header[\s\S]*?min-height: 44px/);
  assert.match(css, /\.workspace-instruction-header[\s\S]*?min-height: 44px/);
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /@media \(max-width: 400px\)/);
  assert.match(css, /@media \(min-width: 900px\)/);
  assert.match(css, /max-height: min\(520px, 62vh\)/);
  assert.match(css, /\.connection-retry[\s\S]*?min-height: 44px/);
  assert.match(css, /@media \(max-width: 400px\)[\s\S]*?\.connection-retry[\s\S]*?width: 100%/);
  assert.match(css, /\.journey-progress[\s\S]*?border-radius: 10px/);
  assert.match(css, /\.journey-progress-track[\s\S]*?height: 6px/);
  assert.match(css, /\.journey-progress-toggle[\s\S]*?min-height: 32px/);
  assert.match(css, /\.tool-label[\s\S]*?color: var\(--color-text-secondary, #c7c7ce\)/);
  assert.match(css, /\.header-meta[\s\S]*?color: var\(--color-text-secondary, #c7c7ce\)/);
});

test("generative UI shell keeps status messaging and lazy loading contracts", () => {
  const app = read("json-render-app.tsx");

  assert.match(app, /setAttribute\("role", "status"\)/);
  assert.match(app, /setAttribute\("aria-live", "polite"\)/);
  assert.match(app, /await import\("@modelcontextprotocol\/ext-apps"\)/);
  assert.match(app, /await import\("\.\/json-render-renderer\.js"\)/);
  assert.match(app, /Could not connect to the host/);
  assert.match(app, /does not match the component catalog/);
  // The heavy renderer must stay out of the shell's static imports.
  assert.doesNotMatch(app, /^import .*react-dom/m);
  assert.doesNotMatch(app, /^import .*@json-render\/react/m);
});

test("generative UI uses the published shadcn set and adds only figure semantics", () => {
  const registry = read("json-render-registry.tsx");

  // The shadcn implementations ship with the catalog and are used as published,
  // so DevSpace does not reimplement their markup or their accessibility.
  assert.match(registry, /shadcnComponents/);
  assert.match(registry, /\.\.\.shadcnComponents/);
  assert.match(registry, /<figure/);
  assert.match(registry, /<figcaption/);
  assert.match(registry, /<code/);
});
