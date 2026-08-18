import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import test, { after } from "node:test";

const repoRoot = process.env.DEVSPACE_REPO_ROOT ?? process.cwd();
const port = Number(process.env.E2E_PATH_CONTAINMENT_PORT ?? 17688);
const baseUrl = `http://127.0.0.1:${port}`;
const ownerToken = "path-containment-e2e-owner-token-0123456789";
const serverEntrypoint = process.env.E2E_PATH_CONTAINMENT_SERVER_ENTRYPOINT ?? join(repoRoot, "dist", "server.js");
const results = {
  realHttpMcp: false,
  readSymlinkBlocked: false,
  writeSymlinkBlocked: false,
  workingDirectorySymlinkBlocked: false,
  filesystemUnchanged: false,
  cleanup: false,
};
let server;
let rootDir;
let outsideDir;
let stateDir;

async function waitForHealth() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) {
      throw new Error(`server exited before readiness with code ${server.exitCode}`);
    }
    try {
      if ((await fetch(`${baseUrl}/healthz`)).ok) return;
    } catch {
      // Readiness retry only.
    }
    await delay(100);
  }
  throw new Error("path-containment server readiness timeout");
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
      DEVSPACE_TEST_MODE: "true",
      DEVSPACE_ENV: "staging",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.resume();
  server.stderr?.resume();
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    delay(5_000),
  ]);
  if (server.exitCode === null) server.kill("SIGKILL");
}

async function oauthFlow() {
  const metadataResponse = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`);
  assert.equal(metadataResponse.status, 200);
  const metadata = await metadataResponse.json();
  const redirectUri = "http://127.0.0.1:17689/path-containment-callback";
  const registration = await fetch(metadata.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "devspace-path-containment-e2e",
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
  return result.payload.result;
}

function resultText(result) {
  return (result?.content ?? []).map((item) => item.text ?? "").join("\n");
}

test("P1-SEC-002 blocks symlink escape across read, write and process cwd", async () => {
  rootDir = await mkdtemp(join(tmpdir(), "devspace-containment-root-"));
  outsideDir = await mkdtemp(join(tmpdir(), "devspace-containment-outside-"));
  stateDir = await mkdtemp(join(tmpdir(), "devspace-containment-state-"));
  const outsideSecret = join(outsideDir, "secret.txt");
  const outsideWrite = join(outsideDir, "write-target.txt");
  const link = join(rootDir, "outside-link");
  await writeFile(outsideSecret, "outside-secret-content\n");
  await symlink(outsideDir, link, process.platform === "win32" ? "junction" : "dir");

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
        clientInfo: { name: "devspace-containment-e2e", version: "1.0.0" },
      },
    });
    assert.equal(initialized.response.status, 200);
    const sessionId = initialized.response.headers.get("mcp-session-id");
    assert.ok(sessionId);
    const notification = await mcpRequest(token, { jsonrpc: "2.0", method: "notifications/initialized", params: {} }, sessionId);
    assert.ok([200, 202, 204].includes(notification.response.status));

    const workspace = await callTool(token, sessionId, 2, "open_workspace", { path: rootDir, mode: "checkout" });
    const workspaceId = workspace?.structuredContent?.workspaceId;
    assert.ok(workspaceId, "open_workspace must return workspaceId");
    results.realHttpMcp = true;

    const read = await callTool(token, sessionId, 3, "read", {
      workspaceId,
      path: "outside-link/secret.txt",
    });
    assert.equal(read?.isError, true);
    assert.match(resultText(read), /outside allowed roots/i);
    assert.doesNotMatch(resultText(read), /outside-secret-content/);
    results.readSymlinkBlocked = true;

    const write = await callTool(token, sessionId, 4, "write", {
      workspaceId,
      path: "outside-link/write-target.txt",
      content: "must-not-escape",
      idempotencyKey: "containment-write-escape-001",
    });
    assert.equal(write?.isError, true);
    assert.match(resultText(write), /outside allowed roots/i);
    results.writeSymlinkBlocked = true;

    const shell = await callTool(token, sessionId, 5, "bash", {
      workspaceId,
      command: "pwd",
      workingDirectory: "outside-link",
      timeout: 5,
    });
    assert.equal(shell?.isError, true);
    assert.match(resultText(shell), /outside allowed roots/i);
    results.workingDirectorySymlinkBlocked = true;

    assert.equal(await readFile(outsideSecret, "utf8"), "outside-secret-content\n");
    await assertMissing(outsideWrite);
    results.filesystemUnchanged = true;
  } finally {
    await stopServer();
    await rm(rootDir, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
    await rm(stateDir, { recursive: true, force: true });
    results.cleanup = server?.exitCode !== null;
  }
});

async function assertMissing(path) {
  await assert.rejects(readFile(path, "utf8"), (error) => error?.code === "ENOENT");
}

after(async () => {
  const passed = Object.values(results).every(Boolean);
  await writeFile(
    join(repoRoot, "artifacts", "path-containment-report.json"),
    `${JSON.stringify({
      schema: "devspace/path-containment/v1",
      status: passed ? "passed" : "failed",
      real_http_mcp: results.realHttpMcp,
      read_symlink_blocked: results.readSymlinkBlocked,
      write_symlink_blocked: results.writeSymlinkBlocked,
      working_directory_symlink_blocked: results.workingDirectorySymlinkBlocked,
      filesystem_unchanged: results.filesystemUnchanged,
      cleanup: results.cleanup,
      secrets_included: false,
    }, null, 2)}\n`,
    { mode: 0o600 },
  );
});
