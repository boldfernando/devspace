import assert from "node:assert/strict";
import type { Spec } from "@json-render/core";
import { JSONUIProvider, Renderer } from "@json-render/react";
import { renderToStaticMarkup } from "react-dom/server";
import { validateUiSpec } from "../json-render.js";
import { registry } from "./json-render-registry.js";

function render(spec: unknown): string {
  const validation = validateUiSpec(spec);
  assert.equal(validation.ok, true);
  if (!validation.ok) throw new Error("unreachable");
  return renderToStaticMarkup(
    <JSONUIProvider registry={registry}>
      <Renderer spec={validation.spec as Spec} registry={registry} />
    </JSONUIProvider>,
  );
}

const html = render({
  root: "card",
  elements: {
    card: {
      type: "Card",
      props: { title: "Audit", description: "Latest run", maxWidth: null, centered: null, className: null },
      children: ["stack"],
    },
    stack: {
      type: "Stack",
      props: { direction: "vertical", gap: "md", align: null, justify: null, className: null },
      children: ["heading", "table", "badge", "alert", "code", "text", "separator", "progress"],
    },
    heading: { type: "Heading", props: { text: "Results", level: "h2" } },
    table: {
      type: "Table",
      props: { columns: ["File", "Status"], rows: [["src/server.ts", "clean"]], caption: "Per file" },
    },
    badge: { type: "Badge", props: { text: "20 passed", variant: "secondary" } },
    alert: { type: "Alert", props: { title: "Heads up", message: "Two skills were fixed.", type: "warning" } },
    code: { type: "CodeBlock", props: { code: "npm test", language: "bash", filePath: "package.json" } },
    text: { type: "Text", props: { text: "Done.", variant: "muted" } },
    separator: { type: "Separator", props: { orientation: null } },
    progress: { type: "Progress", props: { value: 100, max: null, label: "Coverage" } },
  },
});

// Upstream shadcn components render their content.
assert.match(html, /Audit/);
assert.match(html, /Results/);
assert.match(html, /src\/server\.ts/);
assert.match(html, /Per file/);
assert.match(html, /20 passed/);
assert.match(html, /Heads up/);
assert.match(html, /Done\./);
assert.match(html, /Coverage/);
assert.match(html, /<table/);

// The DevSpace CodeBlock renders monospaced with its file caption.
assert.match(html, /<code[^>]*data-language="bash"[^>]*>npm test<\/code>/);
assert.match(html, /<figcaption[^>]*>package\.json<\/figcaption>/);

// Tailwind utility classes must survive into the markup, otherwise the panel
// would render unstyled against the design tokens.
assert.match(html, /class="[^"]*rounded-lg[^"]*"/);

// Agent-supplied strings are text, never markup.
const injected = render({
  root: "t",
  elements: { t: { type: "Text", props: { text: "<img src=x onerror=alert(1)>", variant: null } } },
});
assert.doesNotMatch(injected, /<img/);
assert.match(injected, /&lt;img/);

const injectedCode = render({
  root: "c",
  elements: { c: { type: "CodeBlock", props: { code: "</code><script>alert(1)</script>", language: null, filePath: null } } },
});
assert.doesNotMatch(injectedCode, /<script>/);

// Interactive components carry events upstream, but with no action handlers
// wired a rendered control cannot dispatch anything.
const button = render({
  root: "b",
  elements: { b: { type: "Button", props: { label: "Approve", variant: null, size: null, disabled: null, className: null } } },
});
assert.match(button, /Approve/);
assert.doesNotMatch(button, /href=/);

console.log("json-render registry renders the shadcn set plus CodeBlock and escapes agent text");
