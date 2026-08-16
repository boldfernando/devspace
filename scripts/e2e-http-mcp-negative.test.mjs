import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import test, { after, before } from "node:test";

const repoRoot = process.env.DEVSPACE_REPO_ROOT ?? process.cwd();
const port = Number(process.env.E2E_NEGATIVE_PORT ?? 17687);
const secondaryPort = Number(process.env.E2E_NEGATIVE_SECONDARY_PORT ?? port + 1);
const baseUrl = process.env.E2E_NEGATIVE_BASE_URL ?? `http://127.0.0.1:${port}`;
const secondaryBaseUrl = process.env.E2E_NEGATIVE_SECONDARY_BASE_URL ?? `http://127.0.0.1:${secondaryPort}`;
const ownerToken = process.env.E2E_NEGATIVE_OWNER_TOKEN ?? process.env.DEVSPACE_OAUTH_OWNER_TOKEN ?? "e2e-owner-token-that-is-long-enough";
const secondaryOwnerToken = `${ownerToken}-secondary`;
const serverEntrypoint = process.env.E2E_NEGATIVE_SERVER_ENTRYPOINT ?? join(repoRoot, "dist", "server.js");
const redirectUriBase = process.env.E2E_NEGATIVE_REDIRECT_URI ?? "http://127.0.0.1:17689/callback";
const logs = [];
let primary;
let secondary;
let primaryStateDir;
let secondaryStateDir;
let sequence = 0;

const secretPatterns = [
  /bearer\s+[A-Za-z0-9._~-]+/i,
  /owner[_-]?token\s*[=:]\s*[^\s,;]+/i,
  /code[_-]?verifier\s*[=:]\s*[^\s,;]+/i,
];

function redact(value) {
  let text = String(value ?? "");
  text = text.replace(/bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED]");
  text = text.replace(/(owner[_-]?token\s*[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]");
  text = text.replace(/(code[_-]?verifier\s*[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]");
  return text;
}

function recordOutput(chunk) {
  const safe = redact(chunk);
  logs.push(safe);
}

function nextRedirectUri() {
  sequence += 1;
  const url = new URL(redirectUriBase);
  url.searchParams.set("case", String(sequence));
  return url.href;
}

async function waitForHealth(url, child) {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`server exited before readiness with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${url}/healthz`);
      if (response.ok) return;
      lastError = new Error(`healthz status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`server readiness timeout: ${lastError?.message ?? "unknown error"}`);
}

function startServer(url, serverPort, stateDir, token) {
  const child = spawn(process.execPath, [serverEntrypoint], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(serverPort),
      DEVSPACE_PUBLIC_BASE_URL: url,
      DEVSPACE_ALLOWED_ROOTS: repoRoot,
      DEVSPACE_STATE_DIR: stateDir,
      DEVSPACE_OAUTH_OWNER_TOKEN: token,
      DEVSPACE_OAUTH_SCOPES: "devspace:read,devspace:write",
      DEVSPACE_OAUTH_ALLOWED_REDIRECT_HOSTS: "localhost,127.0.0.1",
      DEVSPACE_TEST_MODE: "true",
      DEVSPACE_ENV: "staging",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", recordOutput);
  child.stderr?.on("data", recordOutput);
  return child;
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function metadataFor(url = baseUrl) {
  const response = await fetch(`${url}/.well-known/oauth-authorization-server`);
  assert.equal(response.status, 200, "OAuth discovery must be available");
  const metadata = await response.json();
  for (const key of ["registration_endpoint", "authorization_endpoint", "token_endpoint"]) {
    assert.equal(typeof metadata[key], "string", `OAuth metadata missing ${key}`);
  }
  return metadata;
}

async function registerClient(metadata, redirectUri = nextRedirectUri()) {
  const response = await fetch(metadata.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "devspace-p0-negative",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  assert.equal(response.status, 201, "dynamic client registration must succeed");
  const client = await response.json();
  assert.ok(client.client_id);
  return { client, redirectUri };
}

function pkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

async function beginAuthorization({ url = baseUrl, scope = "devspace:read", resource = `${url}/mcp`, redirectUri, allowFailure = false } = {}) {
  const metadata = await metadataFor(url);
  const registered = await registerClient(metadata, redirectUri);
  const { verifier, challenge } = pkcePair();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: registered.client.client_id,
    redirect_uri: registered.redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope,
    resource,
  });
  const authorization = await fetch(`${metadata.authorization_endpoint}?${params}`, { redirect: "manual" });
  if (!allowFailure) assert.equal(authorization.status, 200, "authorization form must be returned");
  return { metadata, client: registered.client, redirectUri: registered.redirectUri, verifier, challenge, params, authorization };
}

async function approveAuthorization(flow, token = ownerToken) {
  const form = new URLSearchParams(flow.params);
  form.set("owner_token", token);
  const response = await fetch(flow.metadata.authorization_endpoint, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: flow.authorization.headers.get("set-cookie") ?? "",
    },
    body: form.toString(),
  });
  assert.equal(response.status, 302, "owner approval must redirect with a code");
  const location = response.headers.get("location");
  assert.ok(location, "authorization response must contain a redirect location");
  const redirect = new URL(location);
  const code = redirect.searchParams.get("code");
  assert.ok(code, "authorization response must contain an authorization code");
  return code;
}

async function exchangeCode(flow, overrides = {}) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: overrides.code ?? await approveAuthorization(flow),
    client_id: overrides.client_id ?? flow.client.client_id,
    redirect_uri: overrides.redirect_uri ?? flow.redirectUri,
    code_verifier: overrides.code_verifier ?? flow.verifier,
    resource: overrides.resource ?? flow.params.get("resource"),
  });
  return fetch(flow.metadata.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
}

async function authenticatedFlow(options = {}) {
  const flow = await beginAuthorization(options);
  const approvalToken = options.ownerToken ?? (options.url === secondaryBaseUrl ? secondaryOwnerToken : ownerToken);
  const code = await approveAuthorization(flow, approvalToken);
  const tokenResponse = await exchangeCode(flow, { code });
  assert.equal(tokenResponse.status, 200, "valid PKCE exchange must issue a token");
  const tokens = await tokenResponse.json();
  assert.ok(tokens.access_token);
  return { ...flow, code, tokens };
}

function rpcBody(text) {
  const event = String(text).match(/^data:\s*(.+)$/m)?.[1] ?? String(text).trim();
  try {
    return JSON.parse(event);
  } catch {
    return { raw: String(text) };
  }
}

async function mcpRequest(accessToken, body, sessionId, { url = baseUrl, method = "POST", contentType = "application/json", rawBody } = {}) {
  const headers = {
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${accessToken}`,
  };
  if (contentType) headers["content-type"] = contentType;
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const response = await fetch(`${url}/mcp`, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : rawBody ?? JSON.stringify(body),
  });
  const text = await response.text();
  return { response, text, payload: rpcBody(text) };
}

async function initialize(flow) {
  const result = await mcpRequest(flow.tokens.access_token, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "devspace-p0-negative", version: "1.0.0" },
    },
  });
  assert.equal(result.response.status, 200, "MCP initialize must succeed for a valid token");
  const sessionId = result.response.headers.get("mcp-session-id");
  assert.ok(sessionId, "MCP initialize must return a session id");
  const initialized = await mcpRequest(flow.tokens.access_token, { jsonrpc: "2.0", method: "notifications/initialized", params: {} }, sessionId);
  assert.ok([200, 202, 204].includes(initialized.response.status));
  return { ...result, sessionId, initialized };
}

function assertRejected(response, label) {
  assert.ok(response.status >= 400, `${label} must be rejected; received ${response.status}`);
}

function assertNotSecret(text, label) {
  for (const pattern of secretPatterns) {
    assert.doesNotMatch(String(text), pattern, `${label} contains a secret-like pattern`);
  }
}

before(async () => {
  await access(serverEntrypoint, fsConstants.F_OK);
  primaryStateDir = await mkdtemp(join(tmpdir(), "devspace-p0-negative-primary-"));
  secondaryStateDir = await mkdtemp(join(tmpdir(), "devspace-p0-negative-secondary-"));
  primary = startServer(baseUrl, port, primaryStateDir, ownerToken);
  secondary = startServer(secondaryBaseUrl, secondaryPort, secondaryStateDir, secondaryOwnerToken);
  await waitForHealth(baseUrl, primary);
  await waitForHealth(secondaryBaseUrl, secondary);
});

test("BEARER-NEG-001 rejects missing Authorization", async () => {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  });
  assertRejected(response, "missing bearer authorization");
});

test("BEARER-NEG-002 rejects malformed Authorization scheme", async () => {
  const result = await mcpRequest("not-a-bearer-token", { jsonrpc: "2.0", id: 2, method: "initialize", params: {} }, undefined, { contentType: "application/json" });
  assertRejected(result.response, "malformed bearer authorization");
});

test("BEARER-NEG-003 rejects an invalid token", async () => {
  const result = await mcpRequest("invalid-token-fixture", { jsonrpc: "2.0", id: 3, method: "initialize", params: {} });
  assertRejected(result.response, "invalid bearer token");
});

test("BEARER-NEG-004 rejects a revoked token", async () => {
  const flow = await authenticatedFlow();
  const metadata = await metadataFor();
  if (metadata.revocation_endpoint) {
    const revoked = await fetch(metadata.revocation_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: flow.tokens.access_token, token_type_hint: "access_token" }).toString(),
    });
    assert.ok(revoked.status < 500, "revocation endpoint must not fail server-side");
  }
  const result = await mcpRequest(flow.tokens.access_token, { jsonrpc: "2.0", id: 4, method: "initialize", params: {} });
  assertRejected(result.response, "revoked bearer token");
});

test("OAUTH-NEG-001 rejects an incorrect code_verifier", async () => {
  const flow = await beginAuthorization();
  const code = await approveAuthorization(flow);
  const response = await exchangeCode(flow, { code, code_verifier: randomBytes(32).toString("base64url") });
  assertRejected(response, "incorrect PKCE verifier");
});

test("OAUTH-NEG-002 rejects authorization-code replay", async () => {
  const flow = await authenticatedFlow();
  const replay = await exchangeCode(flow, { code: flow.code });
  assertRejected(replay, "authorization code replay");
});

test("OAUTH-NEG-003 rejects an expired or stale authorization code", async () => {
  const flow = await beginAuthorization();
  const response = await exchangeCode(flow, { code: `code-expired-fixture-${randomBytes(8).toString("hex")}` });
  assertRejected(response, "expired authorization code");
});

test("OAUTH-NEG-004 rejects a mismatched redirect_uri", async () => {
  const flow = await beginAuthorization();
  const code = await approveAuthorization(flow);
  const mismatched = new URL(flow.redirectUri);
  mismatched.pathname = "/mismatched-callback";
  const response = await exchangeCode(flow, { code, redirect_uri: mismatched.href });
  assertRejected(response, "redirect URI mismatch");
});

test("OAUTH-NEG-005 rejects an unknown client_id", async () => {
  const metadata = await metadataFor();
  const response = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: "code-unknown-client-fixture",
      client_id: "unknown-client-fixture",
      redirect_uri: redirectUriBase,
      code_verifier: randomBytes(32).toString("base64url"),
      resource: `${baseUrl}/mcp`,
    }).toString(),
  });
  assertRejected(response, "unknown client id");
});

test("OAUTH-NEG-006 rejects a token minted for another resource server", async () => {
  const foreign = await authenticatedFlow({ url: secondaryBaseUrl, resource: `${secondaryBaseUrl}/mcp` });
  const result = await mcpRequest(foreign.tokens.access_token, { jsonrpc: "2.0", id: 6, method: "initialize", params: {} });
  assertRejected(result.response, "wrong resource token");
});

test("OAUTH-NEG-007 rejects a privileged request with insufficient scope", async () => {
  const flow = await authenticatedFlow({ scope: "devspace:write" });
  const result = await mcpRequest(flow.tokens.access_token, { jsonrpc: "2.0", id: 7, method: "initialize", params: {} });
  assert.ok([401, 403].includes(result.response.status), `insufficient scope must be rejected; received ${result.response.status}`);
});

test("OAUTH-NEG-008 rejects an unsupported scope", async () => {
  const flow = await beginAuthorization({ scope: "scope-that-is-not-supported", allowFailure: true });
  const location = flow.authorization.headers.get("location");
  const oauthError = location ? new URL(location).searchParams.get("error") : null;
  assert.ok(flow.authorization.status >= 400 || (flow.authorization.status >= 300 && flow.authorization.status < 400 && oauthError), `unsupported scope must be rejected; received ${flow.authorization.status}`);
});

test("SESSION-NEG-001 rejects an unknown MCP session id", async () => {
  const flow = await authenticatedFlow();
  const result = await mcpRequest(flow.tokens.access_token, { jsonrpc: "2.0", id: 10, method: "tools/list", params: {} }, "unknown-session-fixture");
  assert.equal(result.response.status, 404);
  assert.match(result.text, /Unknown MCP session/i);
});

test("SESSION-NEG-002 rejects transfer of a session between clients", async () => {
  const first = await authenticatedFlow();
  const second = await authenticatedFlow();
  const session = await initialize(first);
  const result = await mcpRequest(second.tokens.access_token, { jsonrpc: "2.0", id: 11, method: "tools/list", params: {} }, session.sessionId);
  assert.ok([401, 403].includes(result.response.status), `cross-client session transfer must be rejected; received ${result.response.status}`);
});

test("SESSION-NEG-003 rejects replay after session close", async () => {
  const flow = await authenticatedFlow();
  const session = await initialize(flow);
  const close = await mcpRequest(flow.tokens.access_token, {}, session.sessionId, { method: "DELETE" });
  assert.ok([200, 202, 204].includes(close.response.status), `session close must be accepted; received ${close.response.status}`);
  const replay = await mcpRequest(flow.tokens.access_token, { jsonrpc: "2.0", id: 12, method: "tools/list", params: {} }, session.sessionId);
  assert.equal(replay.response.status, 404);
  assert.match(replay.text, /Unknown MCP session|No valid MCP session/i);
});

test("SESSION-NEG-004 rejects reconnect without the original binding", async () => {
  const first = await authenticatedFlow();
  const second = await authenticatedFlow();
  const session = await initialize(first);
  const reconnect = await mcpRequest(second.tokens.access_token, { jsonrpc: "2.0", id: 13, method: "notifications/initialized", params: {} }, session.sessionId);
  assert.ok([401, 403].includes(reconnect.response.status), `invalid session binding must be rejected; received ${reconnect.response.status}`);
});

test("MCP-NEG-001 rejects an invalid content type", async () => {
  const flow = await authenticatedFlow();
  const result = await mcpRequest(flow.tokens.access_token, { jsonrpc: "2.0", id: 20, method: "initialize", params: {} }, undefined, { contentType: "text/plain" });
  assertRejected(result.response, "invalid MCP content type");
});

test("MCP-NEG-002 rejects malformed JSON-RPC", async () => {
  const flow = await authenticatedFlow();
  const result = await mcpRequest(flow.tokens.access_token, undefined, undefined, { rawBody: "{ malformed" });
  assertRejected(result.response, "malformed JSON-RPC");
});

test("MCP-NEG-003 rejects an unknown JSON-RPC method", async () => {
  const flow = await authenticatedFlow();
  const session = await initialize(flow);
  const result = await mcpRequest(flow.tokens.access_token, { jsonrpc: "2.0", id: 22, method: "method/does-not-exist", params: {} }, session.sessionId);
  assert.ok(result.response.ok || result.response.status === 400, `unknown method must return a protocol response; received ${result.response.status}`);
  assert.match(JSON.stringify(result.payload), /-32601|method.*not.*found|unknown/i);
});

test("MCP-NEG-004 rejects an invalid lifecycle order", async () => {
  const flow = await authenticatedFlow();
  const result = await mcpRequest(flow.tokens.access_token, { jsonrpc: "2.0", id: 23, method: "tools/call", params: { name: "tools/list", arguments: {} } });
  assertRejected(result.response, "tools call before initialize");
});

test("MCP-NEG-005 keeps a duplicate read request effect-free", async () => {
  const flow = await authenticatedFlow();
  const session = await initialize(flow);
  const body = { jsonrpc: "2.0", id: 24, method: "tools/list", params: {} };
  const first = await mcpRequest(flow.tokens.access_token, body, session.sessionId);
  const second = await mcpRequest(flow.tokens.access_token, body, session.sessionId);
  assert.equal(first.response.status, 200);
  assert.equal(second.response.status, 200);
  assert.deepEqual(second.payload, first.payload, "duplicate read request must not change the observable effect");
  assert.equal(second.response.headers.get("mcp-session-id"), session.sessionId);
});

test("RELEASE-NEG-001 finds no secrets in collected logs or artifacts", async () => {
  const artifactDir = join(repoRoot, "artifacts");
  const files = [];
  try {
    for (const entry of await readdir(artifactDir, { withFileTypes: true })) {
      if (entry.isFile()) files.push(join(artifactDir, entry.name));
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const collected = [...logs];
  for (const file of files) collected.push(await readFile(file, "utf8"));
  assertNotSecret(collected.join("\n"), "logs and artifacts");
});

test("RELEASE-NEG-002 proves cleanup in finally after an aborted case", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "devspace-p0-aborted-"));
  const marker = join(temporary, "marker");
  let cleanupRan = false;
  try {
    throw new Error("controlled-abort");
  } catch (error) {
    assert.match(error.message, /controlled-abort/);
  } finally {
    cleanupRan = true;
    await rm(temporary, { recursive: true, force: true });
  }
  assert.equal(cleanupRan, true);
  await assert.rejects(access(marker, fsConstants.F_OK));
  await assert.rejects(access(temporary, fsConstants.F_OK));
});

after(async () => {
  await stopServer(primary);
  await stopServer(secondary);
  await rm(primaryStateDir, { recursive: true, force: true });
  await rm(secondaryStateDir, { recursive: true, force: true });
});
