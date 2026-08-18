import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const port = 17682;
const baseUrl = `http://127.0.0.1:${port}`;
const resource = `${baseUrl}/mcp`;
const redirectUri = "http://127.0.0.1:17683/callback";
const approvalSecret = `block1-identity-secret-${randomUUID()}`;

async function waitForHealth(child) {
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    if (child.exitCode !== null) throw new Error("block1_server_exited");
    try {
      if ((await fetch(`${baseUrl}/healthz`)).status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("block1_server_not_ready");
}

function form(values) {
  return new URLSearchParams(values).toString();
}

async function registerClient() {
  const registration = await fetch(`${baseUrl}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "block1-identity-e2e",
      redirect_uris: [redirectUri],
      grant_types: ["refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  assert.equal(registration.status, 201);
  return registration.json();
}

function trustedProof(subjectId, userCode) {
  return createHmac("sha256", approvalSecret).update(`${subjectId}|${userCode}`).digest("base64url");
}

async function tokenRequest(values) {
  return fetch(`${baseUrl}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form(values),
  });
}

async function writeReport(repoRoot, value) {
  await mkdir(join(repoRoot, "artifacts"), { recursive: true });
  const path = join(repoRoot, "artifacts", "block1-identity-report.json");
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("Block 1 identity and authorization production mitigation", async () => {
  const repoRoot = process.cwd();
  const root = await mkdtemp(join(tmpdir(), "devspace-block1-root-"));
  const state = await mkdtemp(join(tmpdir(), "devspace-block1-state-"));
  const ownerToken = `block1-owner-${randomUUID()}`;
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
      DEVSPACE_OAUTH_DEVICE_PEPPER: `block1-pepper-${randomUUID()}`,
      DEVSPACE_OAUTH_APPROVAL_MODE: "trusted_header",
      DEVSPACE_OAUTH_APPROVAL_IDENTITY_SECRET: approvalSecret,
      DEVSPACE_OAUTH_SCOPES: "read,write",
      DEVSPACE_LOG_LEVEL: "silent",
      DEVSPACE_LOG_REQUESTS: "false",
      DEVSPACE_LOG_TOOL_CALLS: "false",
    },
    stdio: "ignore",
    windowsHide: true,
  });
  try {
    await waitForHealth(server);
    const metadata = await (await fetch(`${baseUrl}/.well-known/oauth-authorization-server`)).json();
    assert.equal(metadata.revocation_endpoint, `${baseUrl}/revoke`);
    assert.deepEqual(metadata.scopes_supported, ["read", "write"]);
    const client = await registerClient();

    const device = await fetch(`${baseUrl}/oauth/device/authorize`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form({ client_id: client.client_id, scope: "read", resource }),
    });
    assert.equal(device.status, 200);
    const deviceBody = await device.json();

    const page = await fetch(`${baseUrl}/oauth/device?user_code=${encodeURIComponent(deviceBody.user_code)}`);
    const pageText = await page.text();
    assert.equal(page.status, 200);
    assert.match(pageText, /identidade autenticada/i);
    assert.doesNotMatch(pageText, /name="owner_token"/);

    const invalidApproval = await fetch(`${baseUrl}/oauth/device/approve`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form({ user_code: deviceBody.user_code, decision: "approve" }),
      redirect: "manual",
    });
    assert.equal(invalidApproval.status, 403);

    const subjectId = "user:production-123";
    const approval = await fetch(`${baseUrl}/oauth/device/approve`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-devspace-identity": subjectId,
        "x-devspace-identity-proof": trustedProof(subjectId, deviceBody.user_code),
      },
      body: form({ user_code: deviceBody.user_code, decision: "approve" }),
      redirect: "manual",
    });
    assert.equal(approval.status, 303);

    const tokenResponse = await tokenRequest({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      client_id: client.client_id,
      device_code: deviceBody.device_code,
      resource,
    });
    assert.equal(tokenResponse.status, 200);
    const tokens = await tokenResponse.json();
    assert.equal(typeof tokens.access_token, "string");
    assert.equal(typeof tokens.refresh_token, "string");
    assert.equal(tokens.scope, "read");

    const readCall = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokens.access_token}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read", arguments: { workspaceId: "missing", path: "missing" } } }),
    });
    assert.notEqual(readCall.status, 403);

    const writeDenied = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokens.access_token}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "write", arguments: {} } }),
    });
    assert.equal(writeDenied.status, 403);

    const refreshedResponse = await tokenRequest({
      grant_type: "refresh_token",
      client_id: client.client_id,
      refresh_token: tokens.refresh_token,
      resource,
      scope: "read",
    });
    assert.equal(refreshedResponse.status, 200);
    const refreshed = await refreshedResponse.json();
    assert.notEqual(refreshed.refresh_token, tokens.refresh_token);

    const replayedRefresh = await tokenRequest({
      grant_type: "refresh_token",
      client_id: client.client_id,
      refresh_token: tokens.refresh_token,
      resource,
    });
    assert.equal(replayedRefresh.status, 400);

    const revoke = await fetch(`${baseUrl}/revoke`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form({ client_id: client.client_id, token: refreshed.access_token, token_type_hint: "access_token" }),
    });
    assert.equal(revoke.status, 200);

    const revoked = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${refreshed.access_token}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "initialize", params: {} }),
    });
    assert.equal(revoked.status, 401);

    const metricsResponse = await fetch(`${baseUrl}/metrics`);
    const metricsText = await metricsResponse.text();
    assert.equal(metricsResponse.status, 200);
    for (const outcome of ["requested", "approved", "consumed"]) {
      assert.match(metricsText, new RegExp(`mcp_oauth_device_event_total\\{tool="oauth_device",outcome="${outcome}"\\} [1-9]`));
    }

    await writeReport(repoRoot, {
      schema: "devspace.block1-identity.v1",
      status: "passed",
      approval_mode: "trusted_header",
      subject_bound: true,
      resource_bound: true,
      scopes_tested: ["read", "write"],
      read_scope_allowed: true,
      write_scope_denied: true,
      refresh_rotation: true,
      refresh_replay_denied: true,
      revocation_enforced: true,
      device_metrics_observed: true,
      secrets_included: false,
    });
  } finally {
    if (server.exitCode === null) server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
    await rm(root, { recursive: true, force: true });
    await rm(state, { recursive: true, force: true });
  }
});
