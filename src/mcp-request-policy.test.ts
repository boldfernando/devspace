import assert from "node:assert/strict";
import test from "node:test";
import { classifyMcpRequest, requiredScopeForMcpRequest } from "./mcp-request-policy.js";

test("MCP policy classifies protocol discovery and read calls", () => {
  assert.deepEqual(classifyMcpRequest({ method: "GET" }), { kind: "unprotected" });
  assert.deepEqual(classifyMcpRequest({ method: "POST", body: { method: "initialize" } }), {
    kind: "scope",
    requiredScope: "read",
  });
  assert.deepEqual(classifyMcpRequest({ method: "POST", body: { method: "tools/list" } }), {
    kind: "scope",
    requiredScope: "read",
  });
  assert.equal(requiredScopeForMcpRequest({
    method: "POST",
    body: { method: "tools/call", params: { name: "read" } },
  }), "read");
  assert.equal(requiredScopeForMcpRequest({
    method: "POST",
    body: { method: "tools/call", params: { name: "glob" } },
  }), "read");
  assert.equal(requiredScopeForMcpRequest({
    method: "POST",
    body: { method: "tools/call", params: { name: "show_changes" } },
  }), "read");
});

test("MCP policy classifies every mutating tool as write", () => {
  for (const name of [
    "open_workspace",
    "write",
    "edit",
    "bash",
    "write_stdin",
    "apply_patch",
    "download_artifact",
  ]) {
    assert.equal(requiredScopeForMcpRequest({
      method: "POST",
      body: { method: "tools/call", params: { name } },
    }), "write", name);
  }
});

test("MCP policy denies unknown and malformed tool calls", () => {
  assert.deepEqual(classifyMcpRequest({
    method: "POST",
    body: { method: "tools/call", params: { name: "future_tool" } },
  }), { kind: "deny", reason: "unknown_tool" });
  assert.deepEqual(classifyMcpRequest({
    method: "POST",
    body: { method: "tools/call", params: {} },
  }), { kind: "deny", reason: "malformed_tool_call" });
  assert.deepEqual(classifyMcpRequest({ method: "POST", body: null }), { kind: "unprotected" });
  assert.deepEqual(classifyMcpRequest({
    method: "POST",
    body: { method: "notifications/initialized" },
  }), { kind: "unprotected" });
});
