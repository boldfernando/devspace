import { defineRegistry } from "@json-render/react";
import { shadcnComponents } from "@json-render/shadcn";
import { uiCatalog } from "../json-render-catalog.js";

/**
 * Component implementations for the catalog.
 *
 * The shadcn set ships with the catalog and is used as published; DevSpace only
 * adds implementations for the components it contributes. Every component
 * renders agent-supplied strings through React children, so text is never
 * treated as markup.
 */
export const { registry } = defineRegistry(uiCatalog, {
  components: {
    ...shadcnComponents,
    CodeBlock: ({ props }) => (
      <figure className="my-0 overflow-hidden rounded-lg border border-border bg-muted/40">
        {props.filePath ? (
          <figcaption className="border-b border-border px-3 py-1.5 font-mono text-xs text-muted-foreground">
            {props.filePath}
          </figcaption>
        ) : null}
        <pre className="m-0 overflow-x-auto p-3 text-xs leading-relaxed">
          <code data-language={props.language ?? "text"}>{props.code}</code>
        </pre>
      </figure>
    ),
  },
});
