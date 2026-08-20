import type { Spec } from "@json-render/core";
import { JSONUIProvider, Renderer } from "@json-render/react";
import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { validateUiSpec } from "../json-render.js";
import { registry } from "./json-render-registry.js";

export interface RenderPayload {
  title?: string;
  spec: unknown;
}

const roots = new WeakMap<Element, Root>();
const validatedSpecs = new WeakMap<object, Spec>();

/** Re-validate a host-supplied spec before it reaches the renderer. */
export function isRenderableSpec(spec: unknown): boolean {
  const validation = validateUiSpec(spec);
  if (!validation.ok) return false;
  if (typeof spec === "object" && spec !== null) {
    validatedSpecs.set(spec, validation.spec as Spec);
  }

  return true;
}

export function renderSpec(container: Element, payload: RenderPayload): void {
  const validated =
    typeof payload.spec === "object" && payload.spec !== null
      ? validatedSpecs.get(payload.spec)
      : undefined;

  const validation = validated ? undefined : validateUiSpec(payload.spec);
  if (!validated && (!validation || !validation.ok)) return;
  const spec = validated ?? ((validation as { spec: unknown }).spec as Spec);

  let root = roots.get(container);
  if (!root) {
    container.replaceChildren();
    root = createRoot(container);
    roots.set(container, root);
  }

  root.render(
    <StrictMode>
      <article className="jr-surface">
        {payload.title ? <h1 className="jr-surface-title">{payload.title}</h1> : null}
        <JSONUIProvider registry={registry}>
          <Renderer spec={spec} registry={registry} />
        </JSONUIProvider>
      </article>
    </StrictMode>,
  );
}

export function unmountSpec(container: Element): void {
  const root = roots.get(container);
  if (!root) return;

  root.unmount();
  roots.delete(container);
}
