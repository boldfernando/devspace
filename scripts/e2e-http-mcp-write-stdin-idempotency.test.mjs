import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { test } from "node:test";

const repoRoot = process.cwd();
const port = Number(process.env.E2E_WRITE_STDIN_PORT ?? 17793);
const baseUrl = `http://127.0.0.1:${port}`;
const ownerToken = process.env.E2E_WRITE_STDIN_OWNER_TOKEN ?? "e2e-write-stdin-owner-token-long-enough";
const entrypoint = join(repoRoot, "dist", "server.js");
const redirectUri = `http://127.0.0.1:${port + 1}/callback`;
const reportPath = join(repoRoot, "artifacts", "write-stdin-idempotency-report.json");

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

function recordCase(cases, id, status, details = {}) {
  cases.push({ id, status, ...details });
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
  const metadataResponse = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`);
  assert.equal(metadataResponse.status, 200);
  const metadata = await metadataResponse.json();
  const registration = await fetch(metadata.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "devspace-write-stdin-e2e",
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

test("real MCP write_stdin enforces idempotency and monotonic input sequences", async () => {
  const cases = [];
  const workspaceRoot = await mkdtemp(join(tmpdir(), "devspace-write-stdin-e2e-root-"));
  const stateDir = await mkdtemp(join(tmpdir(), "devspace-write-stdin-e2e-state-"));
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
      DEVSPACE_TOOL_MODE: "codex",
      DEVSPACE_TEST_MODE: "true",
      DEVSPACE_ENV: "staging",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = [];
  child.stdout.on("data", (chunk) => output.push(String(chunk)));
  child.stderr.on("data", (chunk) => output.push(String(chunk)));
  let status = "failed";
  let failureType;
  try {
    await waitForHealth(child);
    recordCase(cases, "SETUP-001", "passed", { server: "real-http-mcp", toolMode: "codex" });

    const token = await oauthToken();
    recordCase(cases, "OAUTH-001", "passed", { flow: "authorization_code_pkce_s256" });
    const initialized = await mcpRequest(token, undefined, 1, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "devspace-write-stdin-e2e", version: "1.0.0" },
    });
    assert.equal(initialized.response.status, 200);
    const sessionId = initialized.response.headers.get("mcp-session-id");
    assert.ok(sessionId);
    await mcpRequest(token, sessionId, 2, "notifications/initialized", {});
    recordCase(cases, "MCP-001", "passed", { authenticatedSession: true });

    const opened = await mcpRequest(token, sessionId, 3, "tools/call", {
      name: "open_workspace",
      arguments: { path: workspaceRoot },
    });
    assert.equal(opened.response.status, 200);
    const workspaceId = findValue(opened.payload, "workspaceId", (value) => typeof value === "string");
    assert.ok(workspaceId);
    recordCase(cases, "WORKSPACE-001", "passed", { workspaceOpened: true });

    const processCommand = `${JSON.stringify(process.execPath)} -e "process.stdin.on('data', data => console.log('echo:' + data.toString().trim())); setTimeout(() => process.exit(0), 1500)"`;
    const started = await mcpRequest(token, sessionId, 4, "tools/call", {
      name: "exec_command",
      arguments: { workspaceId, cmd: processCommand, yieldTimeMs: 25 },
    });
    assert.equal(started.response.status, 200);
    const processSessionId = findValue(started.payload, "sessionId", (value) => Number.isInteger(value));
    assert.ok(processSessionId);
    recordCase(cases, "PROC-001", "passed", { processStarted: true });

    const firstInput = {
      name: "write_stdin",
      arguments: {
        workspaceId,
        sessionId: processSessionId,
        chars: "alpha\n",
        idempotencyKey: "stdin-key-001",
        inputSequence: 0,
        yieldTimeMs: 250,
      },
    };
    const first = await mcpRequest(token, sessionId, 5, "tools/call", firstInput);
    assert.equal(first.response.status, 200);
    assert.doesNotMatch(errorText(first.payload), /IDEMPOTENCY_|PROCESS_INPUT_SEQUENCE_/);
    const firstResult = first.payload.result;
    assert.match(JSON.stringify(firstResult), /echo:alpha/);
    recordCase(cases, "IDEMP-P1-009-A", "passed", { sequence: 0, effect: "one_owner" });

    const replay = await mcpRequest(token, sessionId, 6, "tools/call", firstInput);
    assert.equal(replay.response.status, 200);
    assert.deepEqual(replay.payload.result, firstResult);
    recordCase(cases, "IDEMP-P1-009-B", "passed", { replay: true, duplicateEffect: false });

    const conflict = await mcpRequest(token, sessionId, 7, "tools/call", {
      name: "write_stdin",
      arguments: {
        workspaceId,
        sessionId: processSessionId,
        chars: "different\n",
        idempotencyKey: "stdin-key-001",
        inputSequence: 0,
        yieldTimeMs: 1,
      },
    });
    assert.equal(conflict.response.status, 200);
    assert.match(errorText(conflict.payload), /IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD/);
    recordCase(cases, "IDEMP-P1-009-C", "passed", { rejection: "payload_conflict" });

    const gap = await mcpRequest(token, sessionId, 8, "tools/call", {
      name: "write_stdin",
      arguments: {
        workspaceId,
        sessionId: processSessionId,
        chars: "gap\n",
        idempotencyKey: "stdin-key-002",
        inputSequence: 2,
        yieldTimeMs: 1,
      },
    });
    assert.equal(gap.response.status, 200);
    assert.match(errorText(gap.payload), /PROCESS_INPUT_SEQUENCE_GAP/);
    recordCase(cases, "IDEMP-P1-009-D", "passed", { rejection: "PROCESS_INPUT_SEQUENCE_GAP" });

    const sequenceReplay = await mcpRequest(token, sessionId, 9, "tools/call", {
      name: "write_stdin",
      arguments: {
        workspaceId,
        sessionId: processSessionId,
        chars: "replay\n",
        idempotencyKey: "stdin-key-003",
        inputSequence: 0,
        yieldTimeMs: 1,
      },
    });
    assert.equal(sequenceReplay.response.status, 200);
    assert.match(errorText(sequenceReplay.payload), /PROCESS_INPUT_SEQUENCE_REPLAY/);
    recordCase(cases, "IDEMP-P1-009-E", "passed", { rejection: "PROCESS_INPUT_SEQUENCE_REPLAY" });

    const missingKey = await mcpRequest(token, sessionId, 10, "tools/call", {
      name: "write_stdin",
      arguments: {
        workspaceId,
        sessionId: processSessionId,
        chars: "no-key\n",
        inputSequence: 1,
        yieldTimeMs: 1,
      },
    });
    assert.equal(missingKey.response.status, 200);
    assert.match(errorText(missingKey.payload), /IDEMPOTENCY_KEY_REQUIRED_FOR_WRITE_STDIN/);
    recordCase(cases, "IDEMP-P1-009-F", "passed", { rejection: "missing_idempotency_key" });

    const missingSequence = await mcpRequest(token, sessionId, 11, "tools/call", {
      name: "write_stdin",
      arguments: {
        workspaceId,
        sessionId: processSessionId,
        chars: "no-sequence\n",
        idempotencyKey: "stdin-key-004",
        yieldTimeMs: 1,
      },
    });
    assert.equal(missingSequence.response.status, 200);
    assert.match(errorText(missingSequence.payload), /PROCESS_INPUT_SEQUENCE_REQUIRED/);
    recordCase(cases, "IDEMP-P1-009-G", "passed", { rejection: "missing_input_sequence" });

    const secondInput = await mcpRequest(token, sessionId, 12, "tools/call", {
      name: "write_stdin",
      arguments: {
        workspaceId,
        sessionId: processSessionId,
        chars: "beta\n",
        idempotencyKey: "stdin-key-005",
        inputSequence: 1,
        yieldTimeMs: 250,
      },
    });
    assert.equal(secondInput.response.status, 200);
    assert.doesNotMatch(errorText(secondInput.payload), /IDEMPOTENCY_|PROCESS_INPUT_SEQUENCE_/);
    assert.match(errorText(secondInput.payload), /echo:beta/);
    recordCase(cases, "IDEMP-P1-009-H", "passed", { sequence: 1, effect: "ordered_second_chunk" });

    const poll = await mcpRequest(token, sessionId, 13, "tools/call", {
      name: "write_stdin",
      arguments: { workspaceId, sessionId: processSessionId, yieldTimeMs: 3_000 },
    });
    assert.equal(poll.response.status, 200);
    assert.doesNotMatch(errorText(poll.payload), /IDEMPOTENCY_KEY_REQUIRED|PROCESS_INPUT_SEQUENCE_REQUIRED/);
    const pollRunning = findValue(poll.payload, "running", (value) => typeof value === "boolean");
    assert.equal(pollRunning, false);
    recordCase(cases, "IDEMP-P1-009-I", "passed", { pollWithoutKey: true, processExited: true });

    const metricsResponse = await fetch(`${baseUrl}/metrics`);
    assert.equal(metricsResponse.status, 200);
    const metricsText = await metricsResponse.text();
    assert.match(metricsText, /mcp_idempotency_claim_total/);
    assert.match(metricsText, /mcp_idempotency_effect_total/);
    assert.doesNotMatch(metricsText, /stdin-key-00[1-6]|alpha|beta|no-key|no-sequence/);
    recordCase(cases, "IDEMP-P1-009-J", "passed", { metricsSanitized: true });
    status = "passed";
  } catch (error) {
    failureType = error instanceof Error ? error.name : "unknown";
    throw error;
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await new Promise((resolve) => child.once("exit", resolve));
    }
    let cleanupError;
    for (const temporaryPath of [workspaceRoot, stateDir]) {
      try {
        await rm(temporaryPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      } catch (error) {
        cleanupError ??= error instanceof Error ? error : new Error(String(error));
      }
    }
    await mkdir(join(repoRoot, "artifacts"), { recursive: true });
    const combinedOutput = output.join("");
    const secretLeakDetected = [ownerToken, /Bearer\s+[A-Za-z0-9._~-]{20,}/i].some((pattern) =>
      typeof pattern === "string" ? combinedOutput.includes(pattern) : pattern.test(combinedOutput),
    );
    const report = {
      schema_version: 1,
      status,
      task: "P1-IDEMP-009",
      secondary_task: "P2-PROC-001",
      transport: "real-http-mcp",
      auth: "oauth-authorization-code-pkce-s256",
      tool_mode: "codex",
      cases,
      failure_type: failureType,
      secret_leak_detected: secretLeakDetected,
      raw_output_persisted: false,
      cleanup_error: cleanupError ? "temporary_resource_cleanup_failed" : undefined,
    };
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    if (secretLeakDetected) throw new Error("secret-like value detected in captured server output");
    if (cleanupError && status === "passed") throw cleanupError;
  }
});

