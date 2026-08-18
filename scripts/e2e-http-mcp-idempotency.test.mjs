import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { test } from "node:test";

const repoRoot = process.cwd();
const port = Number(process.env.E2E_IDEMPOTENCY_PORT ?? 17689);
const baseUrl = `http://127.0.0.1:${port}`;
const ownerToken = process.env.E2E_IDEMPOTENCY_OWNER_TOKEN ?? "e2e-owner-token-that-is-long-enough";
const entrypoint = join(repoRoot, "dist", "server.js");
const redirectUri = "http://127.0.0.1:17690/callback";

function parseRpc(text) {
  const line = String(text).split(/\r?\n/).find((value) => value.startsWith("data:"));
  const raw = line ? line.slice(5).trim() : String(text).trim();
  try { return JSON.parse(raw); } catch { return { raw }; }
}

async function waitForHealth(child) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return;
    } catch {}
    if (child.exitCode !== null) throw new Error(`server exited with ${child.exitCode}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("server healthz timeout");
}

async function oauthToken() {
  const metadata = await (await fetch(`${baseUrl}/.well-known/oauth-authorization-server`)).json();
  const registration = await fetch(metadata.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "devspace-idempotency-e2e",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  assert.equal(registration.status, 201);
  const client = await registration.json();
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "devspace",
    resource: `${baseUrl}/mcp`,
  });
  const authorizationUrl = `${metadata.authorization_endpoint}?${params}`;
  const formResponse = await fetch(authorizationUrl, { redirect: "manual" });
  assert.equal(formResponse.status, 200);
  const approval = new URLSearchParams(params);
  approval.set("owner_token", ownerToken);
  const approved = await fetch(metadata.authorization_endpoint, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: formResponse.headers.get("set-cookie") ?? "",
    },
    body: approval.toString(),
  });
  assert.equal(approved.status, 302);
  const code = new URL(approved.headers.get("location")).searchParams.get("code");
  const tokenResponse = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: client.client_id,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      resource: `${baseUrl}/mcp`,
    }).toString(),
  });
  assert.equal(tokenResponse.status, 200);
  return (await tokenResponse.json()).access_token;
}

async function mcpRequest(token, sessionId, id, method, params) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const text = await response.text();
  return { response, text, payload: parseRpc(text) };
}

function findWorkspaceId(value) {
  if (!value || typeof value !== "object") return undefined;
  if (typeof value.workspaceId === "string") return value.workspaceId;
  for (const child of Object.values(value)) {
    const found = findWorkspaceId(child);
    if (found) return found;
  }
  return undefined;
}

test("real MCP write_file enforces idempotency replay and conflict", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "devspace-idempotency-e2e-root-"));
  const stateDir = await mkdtemp(join(tmpdir(), "devspace-idempotency-e2e-state-"));
  const child = spawn(process.execPath, [entrypoint], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      DEVSPACE_PUBLIC_BASE_URL: baseUrl,
      DEVSPACE_ALLOWED_ROOTS: workspaceRoot,
      DEVSPACE_STATE_DIR: stateDir,
      DEVSPACE_OAUTH_OWNER_TOKEN: ownerToken,
      DEVSPACE_TEST_MODE: "true",
      DEVSPACE_ENV: "staging",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = [];
  child.stdout.on("data", (chunk) => output.push(String(chunk)));
  child.stderr.on("data", (chunk) => output.push(String(chunk)));
  try {
    await waitForHealth(child);
    const token = await oauthToken();
    const initialized = await mcpRequest(token, undefined, 1, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "devspace-idempotency-e2e", version: "1.0.0" },
    });
    assert.equal(initialized.response.status, 200);
    const sessionId = initialized.response.headers.get("mcp-session-id");
    assert.ok(sessionId);
    await mcpRequest(token, sessionId, 2, "notifications/initialized", {});

    const opened = await mcpRequest(token, sessionId, 3, "tools/call", {
      name: "open_workspace",
      arguments: { path: workspaceRoot },
    });
    assert.equal(opened.response.status, 200);
    const workspaceId = findWorkspaceId(opened.payload);
    assert.ok(workspaceId, "open_workspace must return workspaceId");

    const input = {
      name: "write",
      arguments: {
        workspaceId,
        path: "idempotency-e2e.txt",
        content: "first-content",
        idempotencyKey: "real-mcp-write-key-001",
      },
    };
    const first = await mcpRequest(token, sessionId, 4, "tools/call", input);
    assert.equal(first.response.status, 200);
    assert.doesNotMatch(JSON.stringify(first.payload), /IDEMPOTENCY_/);

    const replay = await mcpRequest(token, sessionId, 5, "tools/call", input);
    assert.equal(replay.response.status, 200);
    assert.deepEqual(replay.payload.result, first.payload.result);
    assert.equal(await readFile(join(workspaceRoot, "idempotency-e2e.txt"), "utf8"), "first-content");

    const conflict = await mcpRequest(token, sessionId, 6, "tools/call", {
      ...input,
      arguments: { ...input.arguments, content: "different-content" },
    });
    assert.equal(conflict.response.status, 200);
    assert.match(JSON.stringify(conflict.payload), /IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD/);

    const concurrentInput = {
      name: "write",
      arguments: {
        workspaceId,
        path: "idempotency-concurrent.txt",
        content: "concurrent-content",
        idempotencyKey: "real-mcp-write-key-002",
      },
    };
    const concurrent = await Promise.all([
      mcpRequest(token, sessionId, 7, "tools/call", concurrentInput),
      mcpRequest(token, sessionId, 8, "tools/call", concurrentInput),
    ]);
    assert.ok(concurrent.every((result) => result.response.status === 200));

    const metricsResponse = await fetch(`${baseUrl}/metrics`);
    assert.equal(metricsResponse.status, 200);
    const metricsText = await metricsResponse.text();
    assert.match(metricsText, /mcp_idempotency_claim_total/);
    assert.match(metricsText, /mcp_idempotency_effect_total/);
    assert.doesNotMatch(metricsText, /real-mcp-write-key-00[12]|concurrent-content/);
    assert.equal(await readFile(join(workspaceRoot, "idempotency-concurrent.txt"), "utf8"), "concurrent-content");
  } finally {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(stateDir, { recursive: true, force: true });
  }
});
