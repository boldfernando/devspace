import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { shadcnComponentDefinitions } from "@json-render/shadcn/catalog";
import * as z from "zod/v4";

/**
 * DevSpace extensions on top of the shadcn catalog.
 *
 * The upstream catalog has no component for source code, which is the single
 * most common thing a coding agent needs to show. Everything else comes from
 * upstream so the catalog stays in step with the renderer.
 */
const devspaceComponentDefinitions = {
  CodeBlock: {
    props: z.object({
      code: z.string(),
      language: z.string().nullable(),
      filePath: z.string().nullable(),
    }),
    description:
      "A block of source code, a diff, or command output, rendered monospaced with an optional file path caption.",
    example: { code: "npm test", language: "bash", filePath: null },
  },
} as const;

/**
 * Component catalog for agent-generated UI.
 *
 * The catalog is the security boundary: the model may only emit these component
 * names with these props, and the server rejects anything else before it reaches
 * a renderer. No actions are declared, so a rendered control can never stand in
 * for an actual tool authorization.
 */
export const uiCatalog = defineCatalog(schema, {
  components: {
    ...shadcnComponentDefinitions,
    ...devspaceComponentDefinitions,
  },
  actions: {},
});

export type UiCatalog = typeof uiCatalog;
export type UiSpec = UiCatalog["_specType"];

/** Component names contributed by DevSpace rather than by the shadcn catalog. */
export const devspaceComponentNames = Object.keys(devspaceComponentDefinitions);
