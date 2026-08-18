import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { access, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import Database from "better-sqlite3";
import { WriteIdempotencyStore } from "../dist/idempotency-store.js";

const repoRoot = process.cwd();
const port = Number(process.env.E2E_IDEMPOTENCY_RECOVERY_PORT ?? 17691);
const baseUrl = `http://127.0.0.1:${port}`;
const ownerToken = process.env.E2E_IDEMPOTENCY_RECOVERY_OWNER_TOKEN ?? "e2e-owner-token-that-is-long-enough";
const entrypoint = join(repoRoot, "dist", "server.js");
const redirectUri = `http://127.0.0.1:${port + 1}/callback`;
const reportPath = join(repoRoot, "artifacts", "idempotency-recovery-report.json");

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

function startServer(workspaceRoot, stateDir, effectDelayMs) {
  return spawn(process.execPath, [entrypoint], {
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
      DEVSPACE_TEST_IDEMPOTENCY_EFFECT_DELAY_MS: String(effectDelayMs),
      DEVSPACE_TEST_IDEMPOTENCY_PENDING_LEASE_MS: "1000",
    },
    stdio: ["ignore", "ignore", "ignore"],
  });
}

async function stopServer(child, signal = "SIGTERM") {
  if (!child || child.exitCode !== null) return;
  child.kill(signal);
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function oauthToken() {
  const metadata = await (await fetch(`${baseUrl}/.well-known/oauth-authorization-server`)).json();
  const registration = await fetch(metadata.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "devspace-idempotency-recovery-e2e",
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
  const formResponse = await fetch(`${metadata.authorization_endpoint}?${params}`, { redirect: "manual" });
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
  return { accessToken: (await tokenResponse.json()).access_token, clientId: client.client_id };
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

async function waitForPending(stateDir, idempotencyKey) {
  const databasePath = join(stateDir, "devspace.sqlite");
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      await access(databasePath);
      const database = new Database(databasePath, { readonly: true });
      try {
        const record = database.prepare("select state, pending_until from write_idempotency where idempotency_key = ?").get(idempotencyKey);
        if (record) return record;
      } finally {
        database.close();
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("pending idempotency record was not observed");
}

test("real MCP crash drill preserves pending, returns ambiguous, and requires explicit reconciliation", async () => {
  const workspaceRoot = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(tmpdir(), "devspace-recovery-e2e-root-")));
  const stateDir = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(tmpdir(), "devspace-recovery-e2e-state-")));
  const targetPath = join(workspaceRoot, "crash-recovery.txt");
  const idempotencyKey = "real-mcp-recovery-key-001";
  let firstServer;
  let secondServer;
  try {
    firstServer = startServer(workspaceRoot, stateDir, 30_000);
    await waitForHealth(firstServer);
    const credentials = await oauthToken();
    const initialized = await mcpRequest(credentials.accessToken, undefined, 1, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "devspace-idempotency-recovery-e2e", version: "1.0.0" },
    });
    assert.equal(initialized.response.status, 200);
    const sessionId = initialized.response.headers.get("mcp-session-id");
    assert.ok(sessionId);
    await mcpRequest(credentials.accessToken, sessionId, 2, "notifications/initialized", {});
    const opened = await mcpRequest(credentials.accessToken, sessionId, 3, "tools/call", {
      name: "open_workspace",
      arguments: { path: workspaceRoot },
    });
    assert.equal(opened.response.status, 200);
    const workspaceId = findWorkspaceId(opened.payload);
    assert.ok(workspaceId);

    const firstWrite = mcpRequest(credentials.accessToken, sessionId, 4, "tools/call", {
      name: "write",
      arguments: {
        workspaceId,
        path: "crash-recovery.txt",
        content: "must-not-be-replayed",
        idempotencyKey,
      },
    }).catch(() => undefined);
    const pending = await waitForPending(stateDir, idempotencyKey);
    assert.equal(pending.state, "pending");
    await stopServer(firstServer, "SIGKILL");
    firstServer = undefined;
    await firstWrite;
    await assert.rejects(readFile(targetPath, "utf8"));

    secondServer = startServer(workspaceRoot, stateDir, 0);
    await waitForHealth(secondServer);
    const reinitialized = await mcpRequest(credentials.accessToken, undefined, 5, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "devspace-idempotency-recovery-e2e", version: "1.0.0" },
    });
    assert.equal(reinitialized.response.status, 200);
    const resumedSessionId = reinitialized.response.headers.get("mcp-session-id");
    assert.ok(resumedSessionId);
    await mcpRequest(credentials.accessToken, resumedSessionId, 6, "notifications/initialized", {});
    const reopened = await mcpRequest(credentials.accessToken, resumedSessionId, 7, "tools/call", {
      name: "open_workspace",
      arguments: { path: workspaceRoot },
    });
    const resumedWorkspaceId = findWorkspaceId(reopened.payload);
    assert.ok(resumedWorkspaceId);
    assert.notEqual(resumedWorkspaceId, workspaceId, "restart may issue a new session workspace id; idempotency scope must remain stable");

    const ambiguous = await mcpRequest(credentials.accessToken, resumedSessionId, 8, "tools/call", {
      name: "write",
      arguments: {
        workspaceId: resumedWorkspaceId,
        path: "crash-recovery.txt",
        content: "must-not-be-replayed",
        idempotencyKey,
      },
    });
    assert.equal(ambiguous.response.status, 200);
    assert.match(JSON.stringify(ambiguous.payload), /IDEMPOTENCY_REQUEST_AMBIGUOUS/);
    await assert.rejects(readFile(targetPath, "utf8"));

    const database = new Database(join(stateDir, "devspace.sqlite"));
    let reconciled;
    try {
      const store = new WriteIdempotencyStore(database);
      const stableWorkspaceScope = createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 32);
      const scopeKey = `${credentials.clientId}|${baseUrl}/mcp|${stableWorkspaceScope}|write`;
      reconciled = store.reconcileExpiredPending(scopeKey, idempotencyKey, new Date(Date.now() + 10_000));
      assert.equal(reconciled?.state, "failed");
      assert.equal(reconciled?.errorCode, "IDEMPOTENCY_AMBIGUOUS_RECONCILED");
    } finally {
      database.close();
    }

    const afterReconcile = await mcpRequest(credentials.accessToken, resumedSessionId, 9, "tools/call", {
      name: "write",
      arguments: {
        workspaceId: resumedWorkspaceId,
        path: "crash-recovery.txt",
        content: "must-not-be-replayed",
        idempotencyKey,
      },
    });
    assert.equal(afterReconcile.response.status, 200);
    assert.match(JSON.stringify(afterReconcile.payload), /IDEMPOTENCY_REQUEST_FAILED/);
    await assert.rejects(readFile(targetPath, "utf8"));

    const metricsText = await (await fetch(`${baseUrl}/metrics`)).text();
    assert.match(metricsText, /mcp_idempotency_recovery_total/);
    assert.match(metricsText, /mcp_idempotency_ambiguous_total/);
    await mkdir(dirname(reportPath), { recursive: true });
    await import("node:fs/promises").then(({ writeFile }) => writeFile(reportPath, `${JSON.stringify({
      schema: "devspace.idempotency-recovery.v1",
      status: "passed",
      real_http_mcp: true,
      restart_recovered: true,
      pending_preserved: true,
      ambiguous_fail_closed: true,
      explicit_reconciliation: true,
      retry_after_reconciliation_blocked: true,
      effect_replayed: false,
      secrets_included: false,
    }, null, 2)}\n`, "utf8"));
  } finally {
    await stopServer(firstServer, "SIGKILL");
    await stopServer(secondServer, "SIGTERM");
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(stateDir, { recursive: true, force: true });
  }
});
