import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import test, { after, before } from "node:test";

const repoRoot = process.env.DEVSPACE_REPO_ROOT ?? process.cwd();
const port = Number(process.env.E2E_DEVICE_PORT ?? 17689);
const baseUrl = process.env.E2E_DEVICE_BASE_URL ?? `http://127.0.0.1:${port}`;
const ownerToken = "device-e2e-owner-token-0123456789";
const resource = `${baseUrl}/mcp`;
const serverEntrypoint = join(repoRoot, "dist", "server.js");
let child;
let stateDir;

async function waitForHealth() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) throw new Error(`server exited with ${child.exitCode}`);
    try { if ((await fetch(`${baseUrl}/healthz`)).ok) return; } catch { /* readiness retry */ }
    await delay(100);
  }
  throw new Error("server readiness timeout");
}

async function json(response) {
  const body = await response.json();
  return body;
}

function form(values) {
  return new URLSearchParams(values).toString();
}

before(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "devspace-device-e2e-"));
  child = spawn(process.execPath, [serverEntrypoint], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      DEVSPACE_PUBLIC_BASE_URL: baseUrl,
      DEVSPACE_ALLOWED_ROOTS: repoRoot,
      DEVSPACE_STATE_DIR: stateDir,
      DEVSPACE_OAUTH_OWNER_TOKEN: ownerToken,
      DEVSPACE_OAUTH_DEVICE_PEPPER: "device-e2e-pepper-012345678901234567890123456789",
      DEVSPACE_OAUTH_SCOPES: "devspace:read,devspace:write",
      DEVSPACE_OAUTH_ALLOWED_REDIRECT_HOSTS: "localhost,127.0.0.1",
      DEVSPACE_TEST_MODE: "true",
      DEVSPACE_ENV: "staging",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.resume();
  child.stderr?.resume();
  await waitForHealth();
});

after(async () => {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(5_000)]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  if (stateDir) await rm(stateDir, { recursive: true, force: true });
});

test("device authorization grant completes and is one-time consumable", async () => {
  const metadataResponse = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`);
  assert.equal(metadataResponse.status, 200);
  const metadata = await json(metadataResponse);
  assert.equal(typeof metadata.device_authorization_endpoint, "string");
  assert.ok(metadata.grant_types_supported.includes("urn:ietf:params:oauth:grant-type:device_code"));

  const registration = await fetch(metadata.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "device-e2e",
      redirect_uris: ["http://127.0.0.1/callback"],
      grant_types: ["authorization_code", "refresh_token", "urn:ietf:params:oauth:grant-type:device_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  assert.equal(registration.status, 201);
  const client = await json(registration);
  assert.ok(client.client_id);

  const requested = await fetch(metadata.device_authorization_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form({ client_id: client.client_id, scope: "devspace:read", resource }),
  });
  assert.equal(requested.status, 200);
  const device = await json(requested);
  assert.match(device.user_code, /^[A-Z2-9]+-[A-Z2-9]+$/);
  assert.ok(device.device_code);

  const pending = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: device.device_code, client_id: client.client_id, resource }),
  });
  assert.equal(pending.status, 400);
  assert.equal((await json(pending)).error, "authorization_pending");

  const approvalPage = await fetch(`${baseUrl}/oauth/device?user_code=${encodeURIComponent(device.user_code)}`);
  assert.equal(approvalPage.status, 200);
  assert.match(await approvalPage.text(), /Autorizar DevSpace CLI/);

  const approval = await fetch(`${baseUrl}/oauth/device/approve`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form({ user_code: device.user_code, owner_token: ownerToken, decision: "approve" }),
  });
  assert.equal(approval.status, 303);

  const token = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: device.device_code, client_id: client.client_id, resource }),
  });
  assert.equal(token.status, 200);
  const tokens = await json(token);
  assert.equal(tokens.token_type, "bearer");
  assert.ok(tokens.access_token);

  const replay = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: device.device_code, client_id: client.client_id, resource }),
  });
  assert.equal(replay.status, 400);
  assert.equal((await json(replay)).error, "invalid_grant");

  const wrongResource = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: device.device_code, client_id: client.client_id, resource: `${baseUrl}/other` }),
  });
  assert.equal(wrongResource.status, 400);

  const authorizationRateLimitResponses = [];
  for (let index = 0; index < 10; index += 1) {
    authorizationRateLimitResponses.push(await fetch(metadata.device_authorization_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form({ client_id: client.client_id, scope: "devspace:read", resource }),
    }));
  }
  const authorizationRateLimited = authorizationRateLimitResponses.find((response) => response.status === 429);
  assert.ok(authorizationRateLimited, "device authorization requests must be rate limited");
  assert.ok(authorizationRateLimited.headers.get("retry-after"));
  assert.equal((await json(authorizationRateLimited)).error, "slow_down");

  const pollingRateLimitResponses = [];
  for (let index = 0; index < 35; index += 1) {
    pollingRateLimitResponses.push(await fetch(metadata.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: device.device_code, client_id: client.client_id, resource }),
    }));
  }
  const pollingRateLimited = pollingRateLimitResponses.find((response) => response.status === 429);
  assert.ok(pollingRateLimited, "device token polling must be rate limited");
  assert.ok(pollingRateLimited.headers.get("retry-after"));
  assert.equal((await json(pollingRateLimited)).error, "slow_down");
});
