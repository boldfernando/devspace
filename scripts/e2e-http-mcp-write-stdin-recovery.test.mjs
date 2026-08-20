import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import Database from "better-sqlite3";
import { WriteIdempotencyStore } from "../dist/idempotency-store.js";

const repoRoot = process.cwd();
const port = Number(process.env.E2E_WRITE_STDIN_RECOVERY_PORT ?? 17803);
const baseUrl = `http://127.0.0.1:${port}`;
const ownerToken = process.env.E2E_WRITE_STDIN_RECOVERY_OWNER_TOKEN ?? "e2e-write-stdin-recovery-owner-token";
const entrypoint = join(repoRoot, "dist", "server.js");
const redirectUri = `http://127.0.0.1:${port + 1}/callback`;
const reportPath = join(repoRoot, "artifacts", "write-stdin-crash-recovery-report.json");

function parseRpc(text) {
  const line = String(text).split(/\r?\n/).find((value) => value.startsWith("data:"));
  const raw = line ? line.slice(5).trim() : String(text).trim();
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function findValue(value, key, predicate = () => true) {
  if (!value || typeof value !== "object") return undefined;
  if (Object.prototype.hasOwnProperty.call(value, key) && predicate(value[key])) return value[key];
  for (const child of Object.values(value)) {
    const found = findValue(child, key, predicate);
    if (found !== undefined) return found;
  }
  return undefined;
}

function errorText(payload) {
  return JSON.stringify(payload);
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

async function waitForFileContent(path, expected) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      if ((await readFile(path, "utf8")) === expected) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("stdin effect was not observed before crash");
}

async function waitForPending(stateDir, idempotencyKey) {
  const databasePath = join(stateDir, "devspace.sqlite");
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      await access(databasePath);
      const database = new Database(databasePath, { readonly: true });
      try {
        const record = database
          .prepare("select state, pending_until, scope_key from write_idempotency where idempotency_key = ?")
          .get(idempotencyKey);
        if (record) return record;
      } finally {
        database.close();
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("pending idempotency record was not observed");
}

function startServer(workspaceRoot, stateDir, targetPath) {
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
      DEVSPACE_TOOL_MODE: "codex",
      DEVSPACE_TEST_MODE: "true",
      DEVSPACE_ENV: "staging",
      DEVSPACE_STDIN_TARGET: targetPath,
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
      client_name: "devspace-write-stdin-recovery-e2e",
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

test("real MCP write_stdin crash window preserves one observed effect and blocks replay", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "devspace-write-stdin-recovery-root-"));
  const stateDir = await mkdtemp(join(tmpdir(), "devspace-write-stdin-recovery-state-"));
  const targetPath = join(workspaceRoot, "stdin-effect.txt");
  const idempotencyKey = "stdin-crash-key-001";
  const chars = "crash-once\n";
  let firstServer;
  let secondServer;
  try {
    await writeFile(targetPath, "", "utf8");
    firstServer = startServer(workspaceRoot, stateDir, targetPath);
    await waitForHealth(firstServer);
    const credentials = await oauthToken();
    const initialized = await mcpRequest(credentials.accessToken, undefined, 1, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "devspace-write-stdin-recovery-e2e", version: "1.0.0" },
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
    const workspaceId = findValue(opened.payload, "workspaceId", (value) => typeof value === "string");
    assert.ok(workspaceId);

    const processCommand = `${JSON.stringify(process.execPath)} -e "const fs=require('node:fs'); const p=process.env.DEVSPACE_STDIN_TARGET; process.stdin.on('data', d => { fs.appendFileSync(p, d); console.log('ACK:' + d.toString().trim()); }); setTimeout(() => process.exit(0), 5000)"`;
    const started = await mcpRequest(credentials.accessToken, sessionId, 4, "tools/call", {
      name: "exec_command",
      arguments: { workspaceId, cmd: processCommand, yieldTimeMs: 25 },
    });
    assert.equal(started.response.status, 200);
    const processSessionId = findValue(started.payload, "sessionId", (value) => Number.isInteger(value));
    assert.ok(processSessionId);

    const firstWrite = mcpRequest(credentials.accessToken, sessionId, 5, "tools/call", {
      name: "write_stdin",
      arguments: {
        workspaceId,
        sessionId: processSessionId,
        chars,
        idempotencyKey,
        inputSequence: 0,
        yieldTimeMs: 30_000,
      },
    }).catch(() => undefined);

    const pending = await waitForPending(stateDir, idempotencyKey);
    assert.equal(pending.state, "pending");
    await waitForFileContent(targetPath, chars);
    await stopServer(firstServer, "SIGKILL");
    firstServer = undefined;
    await firstWrite;
    await new Promise((resolve) => setTimeout(resolve, 6_000));
    assert.equal(await readFile(targetPath, "utf8"), chars);

    secondServer = startServer(workspaceRoot, stateDir, targetPath);
    await waitForHealth(secondServer);
    const reinitialized = await mcpRequest(credentials.accessToken, undefined, 6, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "devspace-write-stdin-recovery-e2e", version: "1.0.0" },
    });
    assert.equal(reinitialized.response.status, 200);
    const resumedSessionId = reinitialized.response.headers.get("mcp-session-id");
    assert.ok(resumedSessionId);
    await mcpRequest(credentials.accessToken, resumedSessionId, 7, "notifications/initialized", {});
    const reopened = await mcpRequest(credentials.accessToken, resumedSessionId, 8, "tools/call", {
      name: "open_workspace",
      arguments: { path: workspaceRoot },
    });
    const resumedWorkspaceId = findValue(reopened.payload, "workspaceId", (value) => typeof value === "string");
    assert.ok(resumedWorkspaceId);

    const pendingRetry = await mcpRequest(credentials.accessToken, resumedSessionId, 9, "tools/call", {
      name: "write_stdin",
      arguments: {
        workspaceId: resumedWorkspaceId,
        sessionId: processSessionId,
        chars,
        idempotencyKey,
        inputSequence: 0,
        yieldTimeMs: 1,
      },
    });
    assert.equal(pendingRetry.response.status, 200);
    assert.match(errorText(pendingRetry.payload), /IDEMPOTENCY_REQUEST_IN_PROGRESS/);

    const databasePath = join(stateDir, "devspace.sqlite");
    const database = new Database(databasePath);
    let reconciled;
    try {
      const store = new WriteIdempotencyStore(database);
      const stableWorkspaceScope = createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 32);
      const scopeKey = `${credentials.clientId}|${baseUrl}/mcp|${stableWorkspaceScope}|write_stdin|${processSessionId}`;
      reconciled = store.reconcileExpiredPending(scopeKey, idempotencyKey, new Date(Date.now() + 10 * 60_000));
      assert.equal(reconciled?.state, "failed");
      assert.equal(reconciled?.errorCode, "IDEMPOTENCY_AMBIGUOUS_RECONCILED");
    } finally {
      database.close();
    }

    const reconciledRetry = await mcpRequest(credentials.accessToken, resumedSessionId, 10, "tools/call", {
      name: "write_stdin",
      arguments: {
        workspaceId: resumedWorkspaceId,
        sessionId: processSessionId,
        chars,
        idempotencyKey,
        inputSequence: 0,
        yieldTimeMs: 1,
      },
    });
    assert.equal(reconciledRetry.response.status, 200);
    assert.match(errorText(reconciledRetry.payload), /IDEMPOTENCY_REQUEST_FAILED/);
    assert.equal(await readFile(targetPath, "utf8"), chars);

    const metricsText = await (await fetch(`${baseUrl}/metrics`)).text();
    assert.match(metricsText, /mcp_idempotency_claim_total/);
    assert.doesNotMatch(metricsText, /stdin-crash-key-001|crash-once/);

    await writeFile(reportPath, `${JSON.stringify({
      schema: "devspace.write-stdin-crash-recovery.v1",
      status: "passed",
      transport: "real-http-mcp",
      auth: "oauth-authorization-code-pkce-s256",
      effect_observed_before_crash: true,
      pending_preserved: true,
      pending_retry_fail_closed: true,
      explicit_reconciliation: true,
      reconciled_state: reconciled?.state,
      replay_after_reconciliation_blocked: true,
      effect_replayed: false,
      characters_written_once: chars,
      metrics_sanitized: true,
      secrets_included: false,
    }, null, 2)}\n`, "utf8");
  } finally {
    await stopServer(firstServer, "SIGKILL");
    await stopServer(secondServer, "SIGTERM");
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(stateDir, { recursive: true, force: true });
  }
});
