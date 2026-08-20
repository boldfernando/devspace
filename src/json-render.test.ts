import assert from "node:assert/strict";
import { shadcnComponentDefinitions } from "@json-render/shadcn/catalog";
import { uiCatalog, devspaceComponentNames } from "./json-render-catalog.js";
import { MAX_UI_ELEMENTS, uiComponentNames, validateUiSpec } from "./json-render.js";

const validSpec = {
  root: "card",
  elements: {
    card: {
      type: "Card",
      props: { title: "Test results", description: null, maxWidth: null, centered: null, className: null },
      children: ["stack"],
    },
    stack: {
      type: "Stack",
      props: { direction: "vertical", gap: "md", align: null, justify: null, className: null },
      children: ["heading", "table"],
    },
    heading: { type: "Heading", props: { text: "Suites", level: "h2" }, children: [] },
    table: {
      type: "Table",
      props: { columns: ["Suite", "Status"], rows: [["config", "pass"]], caption: null },
      children: [],
    },
  },
};

const accepted = validateUiSpec(validSpec);
assert.equal(accepted.ok, true);
assert.equal(accepted.ok && accepted.elementCount, 4);

// A leaf element may omit `children`; normalization fills it before validation.
assert.equal(
  validateUiSpec({ root: "t", elements: { t: { type: "Text", props: { text: "hi", variant: null } } } }).ok,
  true,
);

// Unknown component names must never render.
const unknownComponent = validateUiSpec({
  root: "a",
  elements: { a: { type: "ScriptTag", props: { src: "https://evil.example/x.js" } } },
});
assert.equal(unknownComponent.ok, false);
assert.ok(!unknownComponent.ok && unknownComponent.issues.length > 0);

// Wrong prop types are rejected rather than coerced. The upstream catalog check
// passes this spec, so the props gate is what keeps it out.
const badProps = validateUiSpec({
  root: "t",
  elements: { t: { type: "Table", props: { columns: "Suite", rows: [], caption: null } } },
});
assert.equal(badProps.ok, false);
assert.ok(!badProps.ok && badProps.issues[0].includes("expected array"));
assert.equal(uiCatalog.validate({ root: "t", elements: { t: { type: "Table", props: { columns: "Suite", rows: [], caption: null }, children: [] } } }).success, true);

// Values outside a component's enum are rejected.
assert.equal(
  validateUiSpec({ root: "h", elements: { h: { type: "Heading", props: { text: "x", level: "h9" } } } }).ok,
  false,
);

// A dangling child reference is a structural error, not a warning.
const dangling = validateUiSpec({
  root: "s",
  elements: {
    s: {
      type: "Stack",
      props: { direction: null, gap: null, align: null, justify: null, className: null },
      children: ["missing"],
    },
  },
});
assert.equal(dangling.ok, false);

assert.equal(validateUiSpec({ root: "x", elements: {} }).ok, false);
assert.equal(validateUiSpec(null).ok, false);
assert.equal(validateUiSpec("<h1>hi</h1>").ok, false);

// Element ceiling holds.
const oversized = {
  root: "root",
  elements: Object.fromEntries([
    [
      "root",
      {
        type: "Stack",
        props: { direction: null, gap: null, align: null, justify: null, className: null },
        children: Array.from({ length: MAX_UI_ELEMENTS }, (_, index) => `t${index}`),
      },
    ],
    ...Array.from(
      { length: MAX_UI_ELEMENTS },
      (_, index) => [`t${index}`, { type: "Text", props: { text: `${index}`, variant: null } }] as const,
    ),
  ]),
};
assert.equal(validateUiSpec(oversized).ok, false);

// The catalog is the published shadcn set plus the DevSpace additions, and it
// declares no actions, so rendered output never carries tool authorization.
const names = uiComponentNames();
const upstreamNames = Object.keys(shadcnComponentDefinitions);
for (const expected of upstreamNames) {
  assert.ok(names.includes(expected), `catalog must expose upstream ${expected}`);
}
for (const expected of devspaceComponentNames) {
  assert.ok(names.includes(expected), `catalog must expose DevSpace ${expected}`);
}
assert.equal(names.length, upstreamNames.length + devspaceComponentNames.length);
assert.deepEqual(uiCatalog.actionNames, []);

console.log(
  `json-render catalog: ${names.length} components (${upstreamNames.length} shadcn + ${devspaceComponentNames.length} devspace), 0 actions, fail-closed validation OK`,
);
