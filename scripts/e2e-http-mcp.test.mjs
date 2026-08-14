import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const port = 17677;
const baseUrl = `http://127.0.0.1:${port}`;

async function waitForHealth() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { const response = await fetch(`${baseUrl}/healthz`); if (response.ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("server did not become ready");
}

test("real HTTP flow: health, OAuth metadata and MCP protection", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "devspace-e2e-"));
  const child = spawn(process.execPath, ["dist/server.js"], { cwd: process.cwd(), env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), DEVSPACE_STATE_DIR: stateDir, DEVSPACE_ALLOWED_ROOTS: process.cwd(), DEVSPACE_PUBLIC_BASE_URL: baseUrl, DEVSPACE_OAUTH_OWNER_TOKEN: "e2e-owner-token-that-is-long-enough" }, stdio: "ignore" });
  try {
    await waitForHealth();
    const health = await fetch(`${baseUrl}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, name: "devspace" });
    const metadata = await fetch(`${baseUrl}/.well-known/oauth-protected-resource/mcp`);
    assert.equal(metadata.status, 200);
    const protectedResource = await metadata.json();
    assert.equal(protectedResource.resource, `${baseUrl}/mcp`);
    assert.ok(Array.isArray(protectedResource.authorization_servers));
    const unauthorized = await fetch(`${baseUrl}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) });
    assert.equal(unauthorized.status, 401);
    assert.match(unauthorized.headers.get("www-authenticate") ?? "", /Bearer/i);
  } finally {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
    await rm(stateDir, { recursive: true, force: true });
  }
});
