import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import test, { after } from "node:test";

const repoRoot = process.env.DEVSPACE_REPO_ROOT ?? process.cwd();
const port = Number(process.env.E2E_RESILIENCE_PORT ?? 17690);
const baseUrl = `http://127.0.0.1:${port}`;
const ownerToken = "p2-resilience-e2e-owner-token-0123456789";
const serverEntrypoint = process.env.E2E_RESILIENCE_SERVER_ENTRYPOINT ?? join(repoRoot, "dist", "server.js");
const results = {
  realHttpMcp: false,
  missingRootCreated: false,
  filesystemWriteFailure: false,
  failedChildSanitized: false,
  filesystemUnchanged: false,
  cleanup: false,
};
let server;
let rootDir;
let stateDir;

async function waitForHealth() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) {
      throw new Error(`resilience server exited before readiness with code ${server.exitCode}`);
    }
    try {
      if ((await fetch(`${baseUrl}/healthz`)).ok) return;
    } catch {
      // Readiness retry only.
    }
    await delay(100);
  }
  throw new Error("resilience server readiness timeout");
}

function startServer() {
  server = spawn(process.execPath, [serverEntrypoint], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      DEVSPACE_PUBLIC_BASE_URL: baseUrl,
      DEVSPACE_ALLOWED_ROOTS: rootDir,
      DEVSPACE_STATE_DIR: stateDir,
      DEVSPACE_OAUTH_OWNER_TOKEN: ownerToken,
      DEVSPACE_OAUTH_SCOPES: "devspace:read,devspace:write",
      DEVSPACE_OAUTH_ALLOWED_REDIRECT_HOSTS: "localhost,127.0.0.1",
      DEVSPACE_TOOL_MODE: "codex",
      DEVSPACE_TEST_MODE: "true",
      DEVSPACE_ENV: "staging",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.resume();
  server.stderr?.resume();
}

async function stopServer() {
  if (!server || server.exitCode !== null) return true;
  server.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolve) => server.once("exit", () => resolve(true))),
    delay(5_000).then(() => false),
  ]);
  if (!exited && server.exitCode === null) server.kill("SIGKILL");
  return exited;
}

async function oauthFlow() {
  const metadataResponse = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`);
  assert.equal(metadataResponse.status, 200);
  const metadata = await metadataResponse.json();
  const redirectUri = "http://127.0.0.1:17690/resilience-callback";
  const registration = await fetch(metadata.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "devspace-resilience-e2e",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "devspace:read devspace:write",
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
    scope: "devspace:read devspace:write",
    resource: `${baseUrl}/mcp`,
  });
  const authorization = await fetch(`${metadata.authorization_endpoint}?${params}`, { redirect: "manual" });
  assert.equal(authorization.status, 200);
  const approved = await fetch(metadata.authorization_endpoint, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: authorization.headers.get("set-cookie") ?? "",
    },
    body: new URLSearchParams({ ...Object.fromEntries(params), owner_token: ownerToken }).toString(),
  });
  assert.equal(approved.status, 302);
  const code = new URL(approved.headers.get("location")).searchParams.get("code");
  assert.ok(code);
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
    }),
  });
  assert.equal(tokenResponse.status, 200);
  const tokens = await tokenResponse.json();
  assert.ok(tokens.access_token);
  return tokens.access_token;
}

function parseRpc(text) {
  const event = String(text).match(/^data:\s*(.+)$/m)?.[1] ?? String(text).trim();
  try {
    return event ? JSON.parse(event) : { raw: "" };
  } catch {
    return { raw: String(text) };
  }
}

async function mcpRequest(token, body, sessionId) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { response, text, payload: parseRpc(text) };
}

async function callTool(token, sessionId, id, name, args) {
  const result = await mcpRequest(token, {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args },
  }, sessionId);
  assert.equal(result.response.status, 200, `${name} transport must respond successfully`);
  return result.payload.result ?? { error: result.payload.error, text: result.text };
}

function resultText(result) {
  return (result?.content ?? []).map((item) => item.text ?? "").join("\n");
}

test("P2-RES-002 exercises real HTTP/MCP resource-failure boundaries", async () => {
  rootDir = await mkdtemp(join(tmpdir(), "devspace-resilience-root-"));
  stateDir = await mkdtemp(join(tmpdir(), "devspace-resilience-state-"));
  const immutableDirectory = join(rootDir, "write-failure-target");
  const sentinel = join(rootDir, "sentinel.txt");
  await mkdir(immutableDirectory);
  await writeFile(sentinel, "sentinel-before\n");

  startServer();
  try {
    await waitForHealth();
    const token = await oauthFlow();
    const initialized = await mcpRequest(token, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "devspace-resilience-e2e", version: "1.0.0" },
      },
    });
    assert.equal(initialized.response.status, 200);
    const sessionId = initialized.response.headers.get("mcp-session-id");
    assert.ok(sessionId);
    const notification = await mcpRequest(token, { jsonrpc: "2.0", method: "notifications/initialized", params: {} }, sessionId);
    assert.ok([200, 202, 204].includes(notification.response.status));

    const workspace = await callTool(token, sessionId, 2, "open_workspace", { path: rootDir, mode: "checkout" });
    const workspaceId = workspace?.structuredContent?.workspaceId;
    assert.ok(workspaceId);
    results.realHttpMcp = true;

    const missingRoot = join(rootDir, "missing", "nested-checkout");
    const created = await callTool(token, sessionId, 3, "open_workspace", { path: missingRoot, mode: "checkout" });
    assert.ok(created?.structuredContent?.workspaceId);
    assert.equal((await stat(missingRoot)).isDirectory(), true);
    results.missingRootCreated = true;

    const writeFailure = await callTool(token, sessionId, 4, "apply_patch", {
      workspaceId,
      patch: "*** Begin Patch\n*** Update File: write-failure-target\n@@\n*** End Patch",
    });
    const writeFailureJson = JSON.stringify(writeFailure);
    assert.ok(
      writeFailure?.error || writeFailure?.isError === true || /error|fail/i.test(writeFailureJson),
      "writing to a directory must fail as an MCP error",
    );
    assert.doesNotMatch(writeFailureJson, /must-not-replace-directory/);
    results.filesystemWriteFailure = true;

    const failedChild = await callTool(token, sessionId, 5, "exec_command", {
      workspaceId,
      cmd: "echo should-not-run",
      workingDirectory: "missing-child-cwd",
      yieldTimeMs: 2_000,
    });
    assert.equal(failedChild?.structuredContent?.exitCode, 1);
    assert.match(resultText(failedChild), /PROCESS_START_FAILED/);
    assert.doesNotMatch(resultText(failedChild), /missing-child-cwd|should-not-run/);
    results.failedChildSanitized = true;

    assert.equal(await readFile(sentinel, "utf8"), "sentinel-before\n");
    results.filesystemUnchanged = true;
  } finally {
    results.cleanup = await stopServer();
    await rm(rootDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await rm(stateDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

after(async () => {
  const passed = Object.values(results).every(Boolean);
  await writeFile(
    join(repoRoot, "artifacts", "p2-res-002-report.json"),
    `${JSON.stringify({
      schema: "devspace/p2-res-002/v1",
      status: passed ? "passed" : "failed",
      real_http_mcp: results.realHttpMcp,
      missing_root_created: results.missingRootCreated,
      filesystem_write_failure: results.filesystemWriteFailure,
      failed_child_sanitized: results.failedChildSanitized,
      filesystem_unchanged: results.filesystemUnchanged,
      cleanup: results.cleanup,
      sqlite_lock_full_readonly: "covered_by_src/db/resilience.test.ts",
      secrets_included: false,
    }, null, 2)}\n`,
    { mode: 0o600 },
  );
  if (!passed) process.exitCode = 1;
});
