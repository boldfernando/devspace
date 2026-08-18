import assert from "node:assert/strict";
import test from "node:test";
import { requiredScopeForMcpRequest } from "./mcp-request-policy.js";

test("MCP policy classifies protocol discovery and read calls", () => {
  assert.equal(requiredScopeForMcpRequest({ method: "GET" }), undefined);
  assert.equal(requiredScopeForMcpRequest({ method: "POST", body: { method: "initialize" } }), "read");
  assert.equal(requiredScopeForMcpRequest({ method: "POST", body: { method: "tools/list" } }), "read");
  assert.equal(requiredScopeForMcpRequest({
    method: "POST",
    body: { method: "tools/call", params: { name: "read" } },
  }), "read");
  assert.equal(requiredScopeForMcpRequest({
    method: "POST",
    body: { method: "tools/call", params: { name: "glob" } },
  }), "read");
});

test("MCP policy classifies all mutating process and workspace calls as write", () => {
  for (const name of ["open_workspace", "write", "edit", "bash", "write_stdin"]) {
    assert.equal(requiredScopeForMcpRequest({
      method: "POST",
      body: { method: "tools/call", params: { name } },
    }), "write", name);
  }
});

test("MCP policy fails closed to read for unknown named tools and ignores malformed bodies", () => {
  assert.equal(requiredScopeForMcpRequest({
    method: "POST",
    body: { method: "tools/call", params: { name: "future_tool" } },
  }), "read");
  assert.equal(requiredScopeForMcpRequest({ method: "POST", body: null }), undefined);
  assert.equal(requiredScopeForMcpRequest({ method: "POST", body: { method: "notifications/initialized" } }), undefined);
});
