import { formatSpecIssues, validateSpec } from "@json-render/core";
import { uiCatalog, type UiSpec } from "./json-render-catalog.js";

export interface UiSpecAccepted {
  ok: true;
  spec: UiSpec;
  elementCount: number;
}

export interface UiSpecRejected {
  ok: false;
  issues: string[];
}

export type UiSpecValidation = UiSpecAccepted | UiSpecRejected;

/** Hard ceiling so a single render cannot flood the host with elements. */
export const MAX_UI_ELEMENTS = 200;

function zodIssueMessages(error: unknown): string[] {
  const issues = (error as { issues?: { path?: unknown[]; message?: string }[] } | undefined)?.issues;
  if (!Array.isArray(issues) || issues.length === 0) return ["Spec does not match the component catalog."];

  return issues.map((issue) => {
    const path = Array.isArray(issue.path) && issue.path.length > 0 ? issue.path.join(".") : "spec";
    return `${path}: ${issue.message ?? "invalid"}`;
  });
}

interface PropsSchema {
  safeParse(value: unknown): { success: boolean; error?: unknown };
}

function componentPropsSchema(type: string): PropsSchema | undefined {
  const components = (uiCatalog.data as { components?: Record<string, { props?: unknown }> }).components;
  const props = components?.[type]?.props as PropsSchema | undefined;
  return typeof props?.safeParse === "function" ? props : undefined;
}

function validatePropsAgainstCatalog(elements: Record<string, unknown>): string[] {
  const issues: string[] = [];

  for (const [key, element] of Object.entries(elements)) {
    const node = element as { type?: unknown; props?: unknown };
    if (typeof node.type !== "string") continue;

    const schema = componentPropsSchema(node.type);
    if (!schema) {
      issues.push(`elements.${key}: component "${node.type}" has no props schema.`);
      continue;
    }

    const parsed = schema.safeParse(node.props ?? {});
    if (parsed.success) continue;

    for (const message of zodIssueMessages(parsed.error)) {
      issues.push(`elements.${key}.props.${message}`);
    }
  }

  return issues;
}

/**
 * Every element must carry a `children` array. Filling in the empty case is a
 * deterministic normalization, not a relaxation: the normalized value is what
 * gets validated, and nothing unvalidated is ever returned.
 */
function normalizeChildren(input: unknown): unknown {
  if (typeof input !== "object" || input === null) return input;
  const spec = input as { elements?: unknown };
  if (typeof spec.elements !== "object" || spec.elements === null) return input;

  const elements = Object.fromEntries(
    Object.entries(spec.elements as Record<string, unknown>).map(([key, element]) => {
      if (typeof element !== "object" || element === null) return [key, element];
      const node = element as { children?: unknown };
      return [key, node.children === undefined ? { ...node, children: [] } : node];
    }),
  );

  return { ...spec, elements };
}

/**
 * Validate an agent-produced spec against the catalog.
 *
 * Fail-closed by contract: an invalid spec is rejected with typed issues and
 * never returned for rendering, even partially. Callers must not fall back to
 * the unvalidated payload.
 */
export function validateUiSpec(input: unknown): UiSpecValidation {
  const result = uiCatalog.validate(normalizeChildren(input));
  if (!result.success || !result.data) {
    return { ok: false, issues: zodIssueMessages(result.error) };
  }

  const spec = result.data;
  const elements = (spec as { elements?: Record<string, unknown> }).elements ?? {};
  const elementCount = Object.keys(elements).length;
  if (elementCount === 0) {
    return { ok: false, issues: ["spec.elements: at least one element is required."] };
  }
  if (elementCount > MAX_UI_ELEMENTS) {
    return {
      ok: false,
      issues: [`spec.elements: ${elementCount} elements exceeds the limit of ${MAX_UI_ELEMENTS}.`],
    };
  }

  // Structural pass: catches dangling child references and unreachable elements
  // that the catalog schema alone does not reject.
  const structural = validateSpec(spec as Parameters<typeof validateSpec>[0]);
  const blocking = structural.issues.filter((issue) => issue.severity === "error");
  if (blocking.length > 0) {
    return { ok: false, issues: formatSpecIssues(blocking).split("\n").filter(Boolean) };
  }

  // catalog.validate() checks component names and spec shape but leaves props
  // unchecked, so enforce each component's props schema here.
  const propIssues = validatePropsAgainstCatalog(elements);
  if (propIssues.length > 0) return { ok: false, issues: propIssues };

  return { ok: true, spec, elementCount };
}

/** Component names the model is allowed to emit, for tool descriptions. */
export function uiComponentNames(): string[] {
  return [...uiCatalog.componentNames];
}
