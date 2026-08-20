import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const port = 17681;
const baseUrl = `http://127.0.0.1:${port}`;
const redirectUri = "http://127.0.0.1:17682/callback";

async function waitForHealth(child) {
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    if (child.exitCode !== null) throw new Error("monitor_contract_server_exited");
    try {
      if ((await fetch(`${baseUrl}/healthz`)).status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("monitor_contract_server_not_ready");
}

function formBody(values) {
  return new URLSearchParams(values).toString();
}

async function issueAccessToken(ownerToken) {
  const metadata = await (await fetch(`${baseUrl}/.well-known/oauth-authorization-server`)).json();
  const registration = await fetch(metadata.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "monitor-contract",
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
  const authorization = await fetch(`${metadata.authorization_endpoint}?${params}`, { redirect: "manual" });
  assert.equal(authorization.status, 200);
  params.set("owner_token", ownerToken);
  const approval = await fetch(metadata.authorization_endpoint, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: authorization.headers.get("set-cookie") ?? "",
    },
    body: params.toString(),
  });
  assert.equal(approval.status, 302);
  const code = new URL(approval.headers.get("location")).searchParams.get("code");
  assert.ok(code);
  const tokenResponse = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: formBody({
      grant_type: "authorization_code",
      code,
      client_id: client.client_id,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });
  assert.equal(tokenResponse.status, 200);
  const tokenBody = await tokenResponse.json();
  assert.equal(typeof tokenBody.access_token, "string");
  return tokenBody.access_token;
}

function runMonitor(repoRoot, output, env, extraArgs = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/mcp-monitor.mjs", "--base-url", baseUrl, "--output", output, ...extraArgs], {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      stdio: ["ignore", "ignore", "ignore"],
      windowsHide: true,
    });
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

test("mcp monitor contract validates real health and Bearer authentication", async () => {
  const repoRoot = process.cwd();
  const root = await mkdtemp(join(tmpdir(), "devspace-monitor-root-"));
  const state = await mkdtemp(join(tmpdir(), "devspace-monitor-state-"));
  const output = join(root, "monitor.jsonl");
  const missingTokenOutput = join(root, "missing-token.jsonl");
  const ownerToken = `monitor-owner-${randomUUID()}`;
  const server = spawn(process.execPath, ["dist/server.js"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CI: "true",
      HOST: "127.0.0.1",
      PORT: String(port),
      DEVSPACE_PUBLIC_BASE_URL: baseUrl,
      DEVSPACE_ALLOWED_ROOTS: root,
      DEVSPACE_STATE_DIR: state,
      DEVSPACE_OAUTH_OWNER_TOKEN: ownerToken,
      DEVSPACE_OAUTH_DEVICE_PEPPER: `monitor-pepper-${randomUUID()}`,
      DEVSPACE_LOG_LEVEL: "silent",
      DEVSPACE_LOG_REQUESTS: "false",
      DEVSPACE_LOG_TOOL_CALLS: "false",
    },
    stdio: "ignore",
    windowsHide: true,
  });
  try {
    await waitForHealth(server);
    const accessToken = await issueAccessToken(ownerToken);
    const result = await runMonitor(repoRoot, output, { MCP_MONITOR_BEARER_TOKEN: accessToken }, ["--samples", "2", "--interval-ms", "250", "--fail-on-alert"]);
    assert.equal(result.code, 0);
    const records = (await readFile(output, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(records.length, 2);
    for (const record of records) {
      assert.equal(record.schema, "devspace.mcp-monitor.v1");
      assert.equal(record.event, "mcp_monitor_ok");
      assert.equal(record.healthStatus, 200);
      assert.equal(record.readyStatus, 200);
      assert.equal(record.unauthenticatedStatus, 401);
      assert.equal(record.authenticatedStatus, 200);
      assert.equal(record.metricsStatus, 200);
      assert.equal(record.metricsContractOk, true);
      assert.ok(record.metricsSeriesCount > 0);
      assert.ok(record.healthWallMs >= 0);
      assert.ok(record.authenticatedWallMs >= 0);
      assert.deepEqual(record.slowProbes, []);
      assert.equal("bearerToken" in record, false);
    }
    await mkdir(join(repoRoot, "artifacts"), { recursive: true });
    await writeFile(join(repoRoot, "artifacts", "mcp-monitor-contract.json"), `${JSON.stringify({
      schema: "devspace.mcp-monitor-contract.v1",
      status: "passed",
      samples: records.length,
      events: records.map((record) => record.event),
      statuses: records.map((record) => ({ health: record.healthStatus, ready: record.readyStatus, unauthenticated: record.unauthenticatedStatus, authenticated: record.authenticatedStatus, metrics: record.metricsStatus })),
      latency: records.map((record) => ({ wallMs: record.wallMs, authenticatedWallMs: record.authenticatedWallMs, slowProbes: record.slowProbes.length })),
      secrets_included: false,
    }, null, 2)}\n`, "utf8");
    const missingResult = await runMonitor(repoRoot, missingTokenOutput, {}, ["--samples", "1"]);
    assert.equal(missingResult.code, 2);
    const missingRecord = JSON.parse((await readFile(missingTokenOutput, "utf8")).trim());
    assert.equal(missingRecord.event, "configuration_error");
    assert.equal("bearerToken" in missingRecord, false);
  } finally {
    if (server.exitCode === null) server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
    await rm(root, { recursive: true, force: true });
    await rm(state, { recursive: true, force: true });
  }
});
