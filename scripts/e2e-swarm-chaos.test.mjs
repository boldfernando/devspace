import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test, { after } from "node:test";

const repoRoot = process.env.DEVSPACE_REPO_ROOT ?? process.cwd();
const isolatedTarget = !process.env.CHAOS_TARGET_URL;
const targetPort = boundedInt(process.env.CHAOS_TARGET_PORT, 17692, 1_024, 65_535);
let targetUrl = process.env.CHAOS_TARGET_URL ?? `http://127.0.0.1:${targetPort}`;
const proxyPort = Number(process.env.CHAOS_PROXY_PORT ?? "17791");
const ownerToken = process.env.CHAOS_OWNER_TOKEN ?? "e2e-owner-token-that-is-long-enough";
const targetServerEntrypoint = process.env.CHAOS_SERVER_ENTRYPOINT ?? join(repoRoot, "dist", "server.js");
const reportPath = process.env.CHAOS_REPORT ?? "artifacts/swarm-chaos-report.json";
const agentCount = boundedInt(process.env.CHAOS_AGENT_COUNT, 4, 2, 16);
const maxAttempts = boundedInt(process.env.CHAOS_MAX_ATTEMPTS, 3, 2, 5);
const requestTimeoutMs = boundedInt(process.env.CHAOS_REQUEST_TIMEOUT_MS, 250, 50, 5_000);
const retryDelayMs = boundedInt(process.env.CHAOS_RETRY_DELAY_MS, 25, 0, 1_000);
const scenarios = [
  { name: "timeout", kind: "timeout", persistent: false, retryable: true },
  { name: "429", kind: "status", status: 429, persistent: false, retryable: true },
  { name: "5xx", kind: "status", status: 503, persistent: false, retryable: true },
  { name: "disconnect", kind: "disconnect", persistent: false, retryable: true },
  { name: "persistent-429", kind: "status", status: 429, persistent: true, retryable: true },
  { name: "persistent-5xx", kind: "status", status: 503, persistent: true, retryable: true },
  { name: "persistent-timeout", kind: "timeout", persistent: true, retryable: true },
];

const state = {
  status: "failed",
  realHttpMcp: false,
  targetUrlClass: "loopback",
  agents: [],
  scenarios: [],
  fanout: { requested: 0, succeeded: 0, failed: 0 },
  cleanup: false,
  failClosed: false,
  secretsIncluded: false,
  failureLabels: [],
};
let proxy;
let targetChild;
let targetStateDir;

function boundedInt(value, fallback, minimum, maximum) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRpc(text) {
  const event = String(text).match(/^data:\s*(.+)$/m)?.[1] ?? String(text).trim();
  try {
    return event ? JSON.parse(event) : { raw: "" };
  } catch {
    return { raw: String(text) };
  }
}

function resultText(result) {
  return (result?.content ?? []).map((item) => item.text ?? "").join("\n");
}

function classifyFailure(error) {
  const message = String(error?.name ?? error?.message ?? "error").toLowerCase();
  if (message.includes("timeout") || message.includes("abort")) return "timeout";
  if (message.includes("socket") || message.includes("fetch") || message.includes("econn")) return "disconnect";
  return "unexpected";
}

function recordFailure(scenario, kind) {
  state.failureLabels.push({ scenario, kind });
}

function sanitizedHeaders(headers) {
  const output = {};
  for (const [key, value] of Object.entries(headers)) {
    if (["cookie", "set-cookie", "host", "content-length", "connection", "transfer-encoding"].includes(key.toLowerCase())) continue;
    output[key] = value;
  }
  return output;
}

async function exchangeOAuthToken() {
  const metadataResponse = await fetch(`${targetUrl}/.well-known/oauth-authorization-server`);
  assert.equal(metadataResponse.status, 200);
  const metadata = await metadataResponse.json();
  const redirectUri = `http://127.0.0.1:17689/swarm-chaos/${Date.now()}`;
  const registration = await fetch(metadata.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "devspace-swarm-chaos",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  assert.ok([200, 201].includes(registration.status));
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
    resource: `${targetUrl}/mcp`,
  });
  const authorization = await fetch(`${metadata.authorization_endpoint}?${params}`, { redirect: "manual" });
  assert.equal(authorization.status, 200);
  const form = new URLSearchParams(params);
  form.set("owner_token", ownerToken);
  const approval = await fetch(metadata.authorization_endpoint, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: authorization.headers.get("set-cookie") ?? "",
    },
    body: form.toString(),
  });
  assert.equal(approval.status, 302);
  const code = new URL(approval.headers.get("location")).searchParams.get("code");
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
      resource: `${targetUrl}/mcp`,
    }),
  });
  assert.equal(tokenResponse.status, 200);
  const tokens = await tokenResponse.json();
  assert.ok(tokens.access_token);
  return tokens.access_token;
}

async function waitForTargetHealth() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (targetChild?.exitCode !== null && targetChild?.exitCode !== undefined) {
      throw new Error(`chaos target exited before readiness with code ${targetChild.exitCode}`);
    }
    try {
      if ((await fetch(`${targetUrl}/healthz`)).ok) return;
    } catch {
      // Readiness retry only; functional assertions remain strict.
    }
    await wait(100);
  }
  throw new Error("chaos target readiness timeout");
}

async function startTargetServer() {
  if (!isolatedTarget) return;
  targetStateDir = await mkdtemp(join(tmpdir(), "devspace-swarm-chaos-state-"));
  targetChild = spawn(process.execPath, [targetServerEntrypoint], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(targetPort),
      DEVSPACE_PUBLIC_BASE_URL: targetUrl,
      DEVSPACE_ALLOWED_ROOTS: repoRoot,
      DEVSPACE_STATE_DIR: targetStateDir,
      DEVSPACE_OAUTH_OWNER_TOKEN: ownerToken,
      DEVSPACE_OAUTH_SCOPES: "devspace",
      DEVSPACE_OAUTH_ALLOWED_REDIRECT_HOSTS: "localhost,127.0.0.1",
      DEVSPACE_TOOL_MODE: "codex",
      DEVSPACE_TEST_MODE: "true",
      DEVSPACE_ENV: "staging",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  targetChild.stdout?.resume();
  targetChild.stderr?.resume();
  await waitForTargetHealth();
}

async function stopTargetServer() {
  if (targetChild && targetChild.exitCode === null) {
    targetChild.kill("SIGTERM");
    const exited = await Promise.race([
      new Promise((resolve) => targetChild.once("exit", () => resolve(true))),
      wait(5_000).then(() => false),
    ]);
    if (!exited && targetChild.exitCode === null) targetChild.kill("SIGKILL");
  }
  if (targetStateDir) await rm(targetStateDir, { recursive: true, force: true });
}

function createChaosProxy() {
  const active = { scenario: null, injected: 0 };
  const server = createServer(async (request, response) => {
    const scenario = active.scenario;
    const shouldInject = scenario && (scenario.persistent || active.injected === 0);
    if (shouldInject) {
      active.injected += 1;
      scenario.injections += 1;
      if (scenario.kind === "timeout") {
        await wait(requestTimeoutMs * 2);
        response.destroy();
        return;
      }
      if (scenario.kind === "disconnect") {
        response.destroy();
        return;
      }
      response.statusCode = scenario.status;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ error: "chaos_injected" }));
      return;
    }

    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const headers = sanitizedHeaders(request.headers);
      const upstream = await fetch(`${targetUrl}${request.url}`, {
        method: request.method,
        headers,
        body: request.method === "GET" || request.method === "HEAD" ? undefined : Buffer.concat(chunks),
      });
      response.statusCode = upstream.status;
      upstream.headers.forEach((value, key) => {
        if (!["connection", "transfer-encoding", "content-encoding"].includes(key.toLowerCase())) response.setHeader(key, value);
      });
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch {
      response.destroy();
    }
  });

  return {
    url: `http://127.0.0.1:${proxyPort}`,
    async start() {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(proxyPort, "127.0.0.1", resolve);
      });
    },
    setScenario(scenario) {
      active.scenario = scenario;
      active.injected = 0;
    },
    clearScenario() {
      active.scenario = null;
      active.injected = 0;
    },
    async close() {
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

async function mcpRequest(baseUrl, token, body, sessionId, timeoutMs = requestTimeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    };
    if (sessionId) headers["mcp-session-id"] = sessionId;
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    return { status: response.status, text, payload: parseRpc(text) };
  } finally {
    clearTimeout(timer);
  }
}

async function initialize(baseUrl, token, id) {
  const init = await mcpRequest(baseUrl, token, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: `swarm-chaos-${id}`, version: "1.0.0" } },
  }, undefined, 2_000);
  assert.equal(init.status, 200);
  const sessionId = init.headers?.["mcp-session-id"];
  return { id, sessionId };
}

async function initializeWithSession(baseUrl, token, id) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_000);
  try {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, accept: "application/json, text/event-stream", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: `swarm-chaos-${id}`, version: "1.0.0" } } }),
      signal: controller.signal,
    });
    const text = await response.text();
    assert.equal(response.status, 200);
    const sessionId = response.headers.get("mcp-session-id");
    assert.ok(sessionId);
    const initialized = await mcpRequest(baseUrl, token, { jsonrpc: "2.0", method: "notifications/initialized", params: {} }, sessionId, 2_000);
    assert.ok([200, 202, 204].includes(initialized.status));
    return { id, sessionId };
  } finally {
    clearTimeout(timer);
  }
}

async function resilientCall(baseUrl, token, sessionId) {
  const started = Date.now();
  const attempts = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await mcpRequest(baseUrl, token, { jsonrpc: "2.0", id: 10_000 + attempt, method: "tools/list", params: {} }, sessionId);
      attempts.push(result.status);
      if (result.status >= 200 && result.status < 300 && !result.payload.error) {
        return { recovered: true, failClosed: false, attempts: attempt, status: result.status, elapsedMs: Date.now() - started, statuses: attempts };
      }
      if (![408, 425, 429, 500, 502, 503, 504].includes(result.status)) {
        return { recovered: false, failClosed: true, attempts: attempt, status: result.status, elapsedMs: Date.now() - started, statuses: attempts };
      }
    } catch (error) {
      attempts.push(classifyFailure(error));
    }
    if (attempt < maxAttempts) await wait(retryDelayMs * attempt);
  }
  return { recovered: false, failClosed: true, attempts: maxAttempts, status: "exhausted", elapsedMs: Date.now() - started, statuses: attempts };
}

async function closeSession(baseUrl, token, sessionId) {
  const response = await fetch(`${baseUrl}/mcp`, { method: "DELETE", headers: { authorization: `Bearer ${token}`, "mcp-session-id": sessionId } });
  return [200, 202, 204, 404].includes(response.status);
}

test("SWARM-CHAOS-001 validates network fault recovery and fail-closed behavior", async () => {
  let token;
  const sessions = [];
  try {
    await startTargetServer();
    token = await exchangeOAuthToken();
    proxy = createChaosProxy();
    await proxy.start();
    state.realHttpMcp = true;
    for (let index = 0; index < agentCount; index += 1) {
      const session = await initializeWithSession(proxy.url, token, `agent-${index + 1}`);
      sessions.push(session);
      state.agents.push({ id: session.id, session_created: true });
    }

    const primary = sessions[0];
    for (const definition of scenarios) {
      const scenario = { ...definition, injections: 0 };
      proxy.setScenario(scenario);
      const outcome = await resilientCall(proxy.url, token, primary.sessionId);
      proxy.clearScenario();
      const transient = !definition.persistent;
      const passed = transient ? outcome.recovered === true : outcome.recovered === false && outcome.failClosed === true;
      state.scenarios.push({
        name: definition.name,
        injected_kind: definition.kind,
        injected_status: definition.status ?? null,
        persistent: definition.persistent,
        injections: scenario.injections,
        attempts: outcome.attempts,
        statuses: outcome.statuses,
        recovered: outcome.recovered,
        fail_closed: outcome.failClosed,
        passed,
      });
      assert.equal(passed, true, `${definition.name} oracle must pass`);
    }

    const recovery = await resilientCall(proxy.url, token, primary.sessionId);
    assert.equal(recovery.recovered, true, "session must recover after chaos sequence");

    const fanout = await Promise.all(sessions.map(async (session) => {
      state.fanout.requested += 1;
      const result = await resilientCall(proxy.url, token, session.sessionId);
      if (result.recovered) state.fanout.succeeded += 1;
      else state.fanout.failed += 1;
      return result;
    }));
    assert.equal(fanout.filter((result) => result.recovered).length, sessions.length);
    state.failClosed = state.scenarios.filter((scenario) => scenario.persistent).every((scenario) => scenario.fail_closed);
    assert.equal(state.failClosed, true);
  } finally {
    state.cleanup = true;
    for (const session of sessions) {
      try {
        if (!(await closeSession(proxy.url, token, session.sessionId))) state.cleanup = false;
      } catch {
        state.cleanup = false;
      }
    }
    if (proxy) await proxy.close();
    await stopTargetServer();
  }
  assert.equal(state.cleanup, true);
});

after(async () => {
  await mkdir(join(process.cwd(), "artifacts"), { recursive: true });
  const report = {
    schema: "devspace/swarm-chaos/v1",
    status: state.realHttpMcp && state.cleanup && state.failClosed && state.failureLabels.length === 0 && state.scenarios.every((scenario) => scenario.passed) ? "passed" : "failed",
    target_url_class: state.targetUrlClass,
    agent_count: agentCount,
    max_attempts: maxAttempts,
    request_timeout_ms: requestTimeoutMs,
    retry_delay_ms: retryDelayMs,
    agents: state.agents,
    scenarios: state.scenarios,
    fanout: state.fanout,
    fail_closed: state.failClosed,
    cleanup: state.cleanup,
    failed_scenarios: state.failureLabels,
    secrets_included: false,
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  console.log(JSON.stringify({ schema: report.schema, status: report.status, scenarios: report.scenarios, fanout: report.fanout, fail_closed: report.fail_closed, cleanup: report.cleanup, secrets_included: report.secrets_included }));
});
