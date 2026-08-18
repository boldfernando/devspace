import assert from "node:assert/strict";
import test from "node:test";
import { logEvent, sanitizeLogFields, stableLogHash } from "./logger.js";

test("logger sanitization retains safe dimensions and hashes identifying values", () => {
  const fields = sanitizeLogFields({
    tool: "read_file",
    reason: "insufficient_scope",
    status: 403,
    durationMs: 12,
    requestId: "request-123",
    path: "C:\\private\\secret.txt",
    workspaceId: "workspace-secret",
    ip: "127.0.0.1",
    commandPreview: "cat secret.txt",
    token: "access-token",
    payload: { secret: "value" },
    error: "raw filesystem path",
  });

  assert.equal(fields.tool, "read_file");
  assert.equal(fields.reason, "insufficient_scope");
  assert.equal(fields.status, 403);
  assert.equal(fields.durationMs, 12);
  assert.equal(fields.requestId, "request-123");
  assert.equal(fields.pathHash, stableLogHash("C:\\private\\secret.txt"));
  assert.equal(fields.workspaceIdHash, stableLogHash("workspace-secret"));
  assert.equal(fields.ipHash, stableLogHash("127.0.0.1"));
  assert.equal("commandPreview" in fields, false);
  assert.equal("token" in fields, false);
  assert.equal("payload" in fields, false);
  assert.equal("error" in fields, false);
});

test("logger event remains structural when fields contain event-like input", () => {
  const originalLog = console.log;
  const lines: string[] = [];
  console.log = (line?: unknown) => lines.push(String(line));
  try {
    logEvent({
      level: "info",
      format: "json",
      requests: true,
      assets: true,
      toolCalls: true,
      shellCommands: true,
      trustProxy: false,
    }, "info", "auth_denied", { event: "spoofed", tool: "read" });
  } finally {
    console.log = originalLog;
  }
  assert.equal(JSON.parse(lines[0] ?? "{}").event, "auth_denied");
});

test("logger hashing is deterministic and bounded", () => {
  const hash = stableLogHash("same-value");
  assert.equal(hash, stableLogHash("same-value"));
  assert.equal(hash.length, 16);
  assert.match(hash, /^[0-9a-f]+$/);
});
