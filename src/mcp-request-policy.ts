export type McpScope = "read" | "write";

export interface McpRequestLike {
  method: string;
  body?: unknown;
}

const WRITE_TOOL_NAMES = new Set([
  "open_workspace",
  "write",
  "edit",
  "bash",
  "write_stdin",
]);

const READ_TOOL_NAMES = new Set([
  "read",
  "grep",
  "glob",
  "ls",
  "tools/list",
]);

export function requiredScopeForMcpRequest(
  request: McpRequestLike,
): McpScope | undefined {
  if (request.method !== "POST") return undefined;

  const body = asRecord(request.body);
  const method = typeof body.method === "string" ? body.method : "";
  if (method === "initialize" || method === "tools/list") return "read";
  if (method !== "tools/call") return undefined;

  const params = asRecord(body.params);
  const name = typeof params.name === "string" ? params.name : "";
  if (WRITE_TOOL_NAMES.has(name)) return "write";
  if (READ_TOOL_NAMES.has(name)) return "read";
  return name ? "read" : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
