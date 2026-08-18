export type McpScope = "read" | "write";

export interface McpRequestLike {
  method: string;
  body?: unknown;
}

export type McpRequestPolicyDecision =
  | { kind: "unprotected" }
  | { kind: "scope"; requiredScope: McpScope }
  | { kind: "deny"; reason: "unknown_tool" | "malformed_tool_call" };

const WRITE_TOOL_NAMES = new Set([
  "open_workspace",
  "write",
  "edit",
  "bash",
  "exec_command",
  "write_stdin",
  "apply_patch",
  "download_artifact",
]);

const READ_TOOL_NAMES = new Set([
  "read",
  "grep",
  "glob",
  "ls",
  "show_changes",
]);

export function classifyMcpRequest(
  request: McpRequestLike,
): McpRequestPolicyDecision {
  if (request.method !== "POST") return { kind: "unprotected" };

  const body = asRecord(request.body);
  const method = typeof body.method === "string" ? body.method : "";
  if (method === "initialize" || method === "tools/list") {
    return { kind: "scope", requiredScope: "read" };
  }
  if (method !== "tools/call") return { kind: "unprotected" };

  const params = asRecord(body.params);
  const name = typeof params.name === "string" ? params.name : "";
  if (!name) return { kind: "deny", reason: "malformed_tool_call" };
  if (WRITE_TOOL_NAMES.has(name)) return { kind: "scope", requiredScope: "write" };
  if (READ_TOOL_NAMES.has(name)) return { kind: "scope", requiredScope: "read" };
  return { kind: "deny", reason: "unknown_tool" };
}

/**
 * Compatibility helper for callers that only need the legacy scope value.
 * Callers enforcing authorization should use classifyMcpRequest() so that
 * unknown and malformed tool calls remain fail-closed instead of becoming
 * implicitly readable.
 */
export function requiredScopeForMcpRequest(
  request: McpRequestLike,
): McpScope | undefined {
  const decision = classifyMcpRequest(request);
  return decision.kind === "scope" ? decision.requiredScope : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
