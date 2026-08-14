import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const port = 17677;
const baseUrl = `http://127.0.0.1:${port}`;
const ownerToken = "e2e-owner-token-that-is-long-enough";
const redirectUri = "http://127.0.0.1:17679/callback";

/*
 * OAuth PKCE/MCP E2E contract:
 * 1. Discover the authorization-server metadata.
 * 2. Register a public client with a loopback redirect URI.
 * 3. Generate a random code_verifier and S256 code_challenge.
 * 4. Complete owner authorization and exchange the code for an access token.
 * 5. Send the bearer token to MCP initialize.
 * 6. Reuse the returned mcp-session-id for initialized, tools/list and tools/call.
 * 7. Assert both security rejection and authenticated workspace access.
 */

async function waitForHealth() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { const response = await fetch(`${baseUrl}/healthz`); if (response.ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("server did not become ready");
}

function parseRpc(text) {
  const match = text.match(/data:\s*([\s\S]*)/);
  const data = match?.[1]?.trim() ?? text.trim();
  return JSON.parse(data || text);
}

async function exchangeOAuthToken() {
  const metadata = await (await fetch(`${baseUrl}/.well-known/oauth-authorization-server`)).json();
  const registration = await fetch(metadata.registration_endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "devspace-e2e", redirect_uris: [redirectUri], grant_types: ["authorization_code"], response_types: ["code"], token_endpoint_auth_method: "none" }) });
  assert.ok([200, 201].includes(registration.status));
  const client = await registration.json();
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const params = new URLSearchParams({ response_type: "code", client_id: client.client_id, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: "S256", scope: "devspace", resource: `${baseUrl}/mcp` });
  const authorization = await fetch(`${metadata.authorization_endpoint}?${params}`, { redirect: "manual" });
  assert.equal(authorization.status, 200);
  const form = new URLSearchParams(params);
  form.set("owner_token", ownerToken);
  const approval = await fetch(metadata.authorization_endpoint, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", cookie: authorization.headers.get("set-cookie") ?? "" }, body: form.toString() });
  assert.equal(approval.status, 302);
  const location = new URL(approval.headers.get("location"));
  const code = location.searchParams.get("code");
  assert.ok(code);
  const tokenResponse = await fetch(metadata.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: client.client_id, redirect_uri: redirectUri, code_verifier: verifier, resource: `${baseUrl}/mcp` }).toString() });
  assert.equal(tokenResponse.status, 200);
  const tokens = await tokenResponse.json();
  assert.ok(tokens.access_token);
  return tokens.access_token;
}

async function rpc(accessToken, body, sessionId) {
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${accessToken}` };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  return fetch(`${baseUrl}/mcp`, { method: "POST", headers, body: JSON.stringify(body) });
}

test("real OAuth PKCE flow completes an authenticated MCP handshake", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "devspace-e2e-"));
  const child = spawn(process.execPath, ["dist/server.js"], { cwd: process.cwd(), env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), DEVSPACE_STATE_DIR: stateDir, DEVSPACE_ALLOWED_ROOTS: process.cwd(), DEVSPACE_PUBLIC_BASE_URL: baseUrl, DEVSPACE_OAUTH_OWNER_TOKEN: ownerToken }, stdio: "ignore" });
  try {
    await waitForHealth();
    const unauthenticated = await fetch(`${baseUrl}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 99, method: "initialize", params: {} }) });
    assert.equal(unauthenticated.status, 401);
    const accessToken = await exchangeOAuthToken();
    const initialize = await rpc(accessToken, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "devspace-e2e", version: "1.0.0" } } });
    assert.equal(initialize.status, 200);
    const sessionId = initialize.headers.get("mcp-session-id");
    assert.ok(sessionId);
    const initialized = await rpc(accessToken, { jsonrpc: "2.0", method: "notifications/initialized", params: {} }, sessionId);
    assert.ok([200, 202, 204].includes(initialized.status));
    const tools = await rpc(accessToken, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, sessionId);
    assert.equal(tools.status, 200);
    const payload = parseRpc(await tools.text());
    assert.equal(payload.jsonrpc, "2.0");
    assert.ok(Array.isArray(payload.result?.tools));
    assert.ok(payload.result.tools.some((tool) => tool.name === "open_workspace"));
    const openWorkspace = await rpc(accessToken, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "open_workspace", arguments: { path: process.cwd(), mode: "checkout" } } }, sessionId);
    assert.equal(openWorkspace.status, 200);
    const openPayload = parseRpc(await openWorkspace.text());
    assert.equal(openPayload.error, undefined);
  } finally {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
    await rm(stateDir, { recursive: true, force: true });
  }
});
