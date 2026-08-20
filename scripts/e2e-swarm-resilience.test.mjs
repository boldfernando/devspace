import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import test, { after } from "node:test";

const repoRoot = process.env.DEVSPACE_REPO_ROOT ?? process.cwd();
const isolatedServer = !process.env.SWARM_BASE_URL;
const serverPort = boundedInt(process.env.SWARM_ISOLATED_PORT, 17691, 1_024, 65_535);
const baseUrl = process.env.SWARM_BASE_URL ?? `http://127.0.0.1:${serverPort}`;
const ownerToken = process.env.SWARM_OWNER_TOKEN ?? "swarm-e2e-owner-token-that-is-long-enough";
const serverEntrypoint = process.env.SWARM_SERVER_ENTRYPOINT ?? join(repoRoot, "dist", "server.js");
const reportPath = process.env.SWARM_REPORT ?? "artifacts/swarm-resilience-report.json";
const agentCount = boundedInt(process.env.SWARM_AGENT_COUNT, 8, 1, 32);
const rounds = boundedInt(process.env.SWARM_ROUNDS, 6, 1, 50);
const operationTimeoutMs = boundedInt(process.env.SWARM_OPERATION_TIMEOUT_MS, 15_000, 1_000, 120_000);
const profiles = ["planner", "coder", "reviewer", "tester", "security", "docs", "ops", "integrator"];
const agents = Array.from({ length: agentCount }, (_, index) => ({
  id: `agent-${String(index + 1).padStart(2, "0")}`,
  profile: profiles[index % profiles.length],
}));
const results = {
  realHttpMcp: false,
  authClients: 0,
  load: { rounds, requested: 0, succeeded: 0, failed: 0, latenciesMs: [] },
  isolation: { attempts: 0, rejected: 0, failed: 0, statuses: [] },
  closeReplay: { attempts: 0, closed: 0, replayRejected: 0, failed: 0, statuses: [] },
  recovery: { attempts: 0, succeeded: 0, failed: 0, latenciesMs: [] },
  cleanup: false,
};
const failureLabels = [];
let child;
let stateDir;

function boundedInt(value, fallback, minimum, maximum) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
}

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))]);
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

function classifyToolResult(result) {
  const text = resultText(result).toLowerCase();
  if (text.includes("outside allowed roots")) return "outside_root";
  if (text.includes("not found") || text.includes("enoent")) return "not_found";
  if (text.includes("permission")) return "permission_denied";
  return "tool_error";
}

function recordFailure(scenario, status) {
  const safeStatus = typeof status === "number" || typeof status === "string" ? status : "error";
  failureLabels.push({ scenario, status: safeStatus });
}

async function waitForHealth() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error("swarm server exited before readiness");
    }
    try {
      if ((await fetch(`${baseUrl}/healthz`)).ok) return;
    } catch {
      // Readiness retry is allowed; assertions remain strict after readiness.
    }
    await delay(100);
  }
  throw new Error("swarm server readiness timeout");
}

async function maybeStartIsolatedServer() {
  if (!isolatedServer) return;
  stateDir = await mkdtemp(join(tmpdir(), "devspace-swarm-state-"));
  child = spawn(process.execPath, [serverEntrypoint], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(serverPort),
      DEVSPACE_PUBLIC_BASE_URL: baseUrl,
      DEVSPACE_ALLOWED_ROOTS: repoRoot,
      DEVSPACE_STATE_DIR: stateDir,
      DEVSPACE_OAUTH_OWNER_TOKEN: ownerToken,
      DEVSPACE_OAUTH_SCOPES: "devspace",
      DEVSPACE_OAUTH_ALLOWED_REDIRECT_HOSTS: "localhost,127.0.0.1",
      DEVSPACE_TOOL_MODE: "codex",
      DEVSPACE_TEST_MODE: "true",
      DEVSPACE_ENV: "staging",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.resume();
  child.stderr?.resume();
}

async function stopServer() {
  if (!child || child.exitCode !== null) return true;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    delay(5_000).then(() => false),
  ]);
  if (!exited && child.exitCode === null) child.kill("SIGKILL");
  return exited;
}

async function discoverAndAuthorize(agent) {
  const metadataResponse = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`);
  assert.equal(metadataResponse.status, 200, "OAuth discovery must succeed");
  const metadata = await metadataResponse.json();
  const redirectUri = `http://127.0.0.1:17689/swarm/${agent.id}`;
  const registration = await fetch(metadata.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: `devspace-swarm-${agent.id}`,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  assert.ok([200, 201].includes(registration.status), "dynamic registration must succeed");
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
  const authorization = await fetch(`${metadata.authorization_endpoint}?${params}`, { redirect: "manual" });
  assert.equal(authorization.status, 200, "authorization form must be available");
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
  assert.equal(approval.status, 302, "owner approval must redirect");
  const code = new URL(approval.headers.get("location")).searchParams.get("code");
  assert.ok(code, "authorization code must be present");
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
  assert.equal(tokenResponse.status, 200, "token exchange must succeed");
  const tokens = await tokenResponse.json();
  assert.ok(tokens.access_token, "access token must be present");
  return { ...agent, token: tokens.access_token, clientId: client.client_id };
}

async function mcpRequest(agent, body, sessionId, method = "POST") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), operationTimeoutMs);
  try {
    const headers = {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${agent.token}`,
      ...(method === "POST" ? { "content-type": "application/json" } : {}),
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    };
    const response = await fetch(`${baseUrl}/mcp`, {
      method,
      headers,
      body: method === "POST" ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    return { response, text, payload: parseRpc(text) };
  } finally {
    clearTimeout(timer);
  }
}

async function initialize(agent) {
  const response = await mcpRequest(agent, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: `devspace-swarm-${agent.id}`, version: "1.0.0" },
    },
  });
  assert.equal(response.response.status, 200, `${agent.id} initialize must succeed`);
  const sessionId = response.response.headers.get("mcp-session-id");
  assert.ok(sessionId, `${agent.id} must receive an MCP session id`);
  const initialized = await mcpRequest(agent, { jsonrpc: "2.0", method: "notifications/initialized", params: {} }, sessionId);
  assert.ok([200, 202, 204].includes(initialized.response.status), `${agent.id} initialized must succeed`);
  return { ...agent, sessionId };
}

async function toolCall(agent, id, name, args) {
  const started = performance.now();
  const response = await mcpRequest(agent, {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args },
  }, agent.sessionId);
  return {
    ...response,
    latencyMs: Math.round(performance.now() - started),
    result: response.payload.result,
  };
}

async function runLoadRound(activeAgents, round) {
  await Promise.all(activeAgents.map(async (agent, index) => {
    const started = performance.now();
    let stage = "list";
    let status = "error";
    results.load.requested += 2;
    try {
      const list = await mcpRequest(agent, { jsonrpc: "2.0", id: 10_000 + round * 100 + index, method: "tools/list", params: {} }, agent.sessionId);
      status = list.response.status;
      assert.equal(list.response.status, 200);
      assert.ok(Array.isArray(list.payload.result?.tools));
      stage = "read";
      const read = await toolCall(agent, 11_000 + round * 100 + index, "read", {
        workspaceId: agent.workspaceId,
        path: "README.md",
        limit: 8,
      });
      status = read.response.status;
      assert.equal(read.response.status, 200);
      if (read.result?.isError === true) status = classifyToolResult(read.result);
      assert.notEqual(read.result?.isError, true);
      results.load.succeeded += 2;
      results.load.latenciesMs.push(Math.round(performance.now() - started));
    } catch {
      results.load.failed += 2;
      recordFailure(`load-round-${round}-${agent.id}-${stage}`, status);
    }
  }));
}

async function exerciseIsolation(activeAgents, challenger) {
  for (let index = 0; index < activeAgents.length; index += 1) {
    const target = activeAgents[index];
    results.isolation.attempts += 1;
    try {
      const response = await mcpRequest(challenger, { jsonrpc: "2.0", id: 20_000 + index, method: "tools/list", params: {} }, target.sessionId);
      results.isolation.statuses.push(response.response.status);
      if ([401, 403].includes(response.response.status)) results.isolation.rejected += 1;
      else {
        results.isolation.failed += 1;
        recordFailure(`isolation-${challenger.id}-to-${target.id}`, response.response.status);
      }
    } catch {
      results.isolation.failed += 1;
      recordFailure(`isolation-${challenger.id}-to-${target.id}`);
    }
  }
}

async function closeAndReplay(activeAgents) {
  for (let index = 0; index < activeAgents.length; index += 1) {
    const agent = activeAgents[index];
    results.closeReplay.attempts += 1;
    try {
      const close = await mcpRequest(agent, {}, agent.sessionId, "DELETE");
      results.closeReplay.statuses.push(close.response.status);
      assert.ok([200, 202, 204].includes(close.response.status));
      results.closeReplay.closed += 1;
      const replay = await mcpRequest(agent, { jsonrpc: "2.0", id: 30_000 + index, method: "tools/list", params: {} }, agent.sessionId);
      results.closeReplay.statuses.push(replay.response.status);
      if ([401, 403, 404].includes(replay.response.status)) results.closeReplay.replayRejected += 1;
      else {
        results.closeReplay.failed += 1;
        recordFailure(`replay-after-close-${agent.id}`, replay.response.status);
      }
    } catch {
      results.closeReplay.failed += 1;
      recordFailure(`close-replay-${agent.id}`);
    }
  }
}

async function recoverAgents(activeAgents) {
  await Promise.all(activeAgents.map(async (agent) => {
    results.recovery.attempts += 1;
    const started = performance.now();
    try {
      const recovered = await initialize(agent);
      const list = await mcpRequest(recovered, { jsonrpc: "2.0", id: 40_000, method: "tools/list", params: {} }, recovered.sessionId);
      assert.equal(list.response.status, 200);
      assert.ok(Array.isArray(list.payload.result?.tools));
      agent.sessionId = recovered.sessionId;
      results.recovery.succeeded += 1;
      results.recovery.latenciesMs.push(Math.round(performance.now() - started));
    } catch {
      results.recovery.failed += 1;
      recordFailure(`recovery-${agent.id}`);
    }
  }));
}

async function closeRemaining(activeAgents) {
  let allClosed = true;
  await Promise.all(activeAgents.map(async (agent) => {
    if (!agent.sessionId) return;
    try {
      const response = await mcpRequest(agent, {}, agent.sessionId, "DELETE");
      if (![200, 202, 204, 404].includes(response.response.status)) allClosed = false;
    } catch {
      allClosed = false;
    }
  }));
  return allClosed;
}

test("SWARM-RESILIENCE-001 validates concurrent authenticated agents and recovery", async () => {
  const authorized = [];
  try {
    await maybeStartIsolatedServer();
    await waitForHealth();
    const primary = await discoverAndAuthorize(agents[0]);
    const challenger = await discoverAndAuthorize({ id: "isolation-client", profile: "security" });
    authorized.push(primary, challenger);
    results.authClients = 2;
    const activeAgents = await Promise.all(agents.map((agent) => initialize({ ...agent, token: primary.token, clientId: primary.clientId })));
    const workspaceResults = await Promise.all(activeAgents.map((agent, index) => toolCall(agent, 50_000 + index, "open_workspace", { path: repoRoot, mode: "checkout" })));
    for (let index = 0; index < workspaceResults.length; index += 1) {
      const result = workspaceResults[index];
      assert.equal(result.response.status, 200);
      assert.notEqual(result.result?.isError, true);
      const text = resultText(result.result);
      const workspaceId = result.result?.structuredContent?.workspaceId ?? text.match(/\b(ws_[A-Za-z0-9_-]+)/i)?.[1];
      if (!workspaceId) {
        const keys = result.result && typeof result.result === "object" ? Object.keys(result.result).sort().join(",") : typeof result.result;
        const contentCount = Array.isArray(result.result?.content) ? result.result.content.length : -1;
        recordFailure(`workspace-id-${activeAgents[index].id}`, `shape:${keys};content:${contentCount}`);
      }
      assert.ok(workspaceId, `workspaceId must be returned for ${activeAgents[index].id}`);
      activeAgents[index].workspaceId = workspaceId;
    }
    results.realHttpMcp = true;

    for (let round = 1; round <= rounds; round += 1) await runLoadRound(activeAgents, round);
    await exerciseIsolation(activeAgents, challenger);
    await closeAndReplay(activeAgents);
    await recoverAgents(activeAgents);
    results.cleanup = await closeRemaining(activeAgents);

    assert.equal(results.load.failed, 0, "all multi-agent load operations must pass");
    assert.equal(results.isolation.failed, 0, "all cross-session attempts must fail closed");
    assert.equal(results.isolation.rejected, results.isolation.attempts, "all cross-session attempts must be rejected");
    assert.equal(results.closeReplay.failed, 0, "all close/replay operations must pass");
    assert.equal(results.closeReplay.replayRejected, results.closeReplay.attempts, "all replays after close must be rejected");
    assert.equal(results.recovery.failed, 0, "all recovered agents must reconnect successfully");
    assert.equal(results.cleanup, true, "all remaining agent sessions must close");
  } finally {
    await stopServer();
    if (stateDir) await rm(stateDir, { recursive: true, force: true });
  }
});

after(async () => {
  const report = {
    schema: "devspace/swarm-resilience/v1",
    status: results.realHttpMcp && failureLabels.length === 0 && results.cleanup ? "passed" : "failed",
    base_url_class: "loopback",
    agent_count: agentCount,
    agent_profiles: agents.map(({ id, profile }) => ({ id, profile })),
    rounds,
    auth_clients: results.authClients,
    load: {
      requested_operations: results.load.requested,
      succeeded_operations: results.load.succeeded,
      failed_operations: results.load.failed,
      p50_ms: percentile(results.load.latenciesMs, 0.5),
      p95_ms: percentile(results.load.latenciesMs, 0.95),
      p99_ms: percentile(results.load.latenciesMs, 0.99),
      max_ms: percentile(results.load.latenciesMs, 1),
    },
    isolation: results.isolation,
    close_replay: results.closeReplay,
    recovery: {
      attempts: results.recovery.attempts,
      succeeded: results.recovery.succeeded,
      failed: results.recovery.failed,
      p50_ms: percentile(results.recovery.latenciesMs, 0.5),
      p95_ms: percentile(results.recovery.latenciesMs, 0.95),
      p99_ms: percentile(results.recovery.latenciesMs, 0.99),
    },
    cleanup: results.cleanup,
    failed_scenarios: failureLabels,
    secrets_included: false,
  };
  await writeFile(join(repoRoot, reportPath), `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  console.log(JSON.stringify({ schema: report.schema, status: report.status, agents: report.agent_count, load: report.load, isolation: report.isolation, close_replay: report.close_replay, recovery: report.recovery, cleanup: report.cleanup }));
});
