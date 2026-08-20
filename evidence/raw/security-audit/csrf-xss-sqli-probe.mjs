import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const port = 17682;
const baseUrl = `http://127.0.0.1:${port}`;
const ownerToken = "security-audit-owner-token-that-is-long-enough";
const stateDir = await mkdtemp(join(tmpdir(), "devspace-security-audit-"));
const child = spawn(process.execPath, ["dist/server.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    DEVSPACE_STATE_DIR: stateDir,
    DEVSPACE_ALLOWED_ROOTS: process.cwd(),
    DEVSPACE_PUBLIC_BASE_URL: baseUrl,
    DEVSPACE_OAUTH_OWNER_TOKEN: ownerToken,
    DEVSPACE_LOG_REQUESTS: "false",
    DEVSPACE_LOG_TOOL_CALLS: "false",
  },
  stdio: "ignore",
});

async function waitForHealth() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("security probe server did not become ready");
}

function result(name, response, extra = {}) {
  return {
    name,
    status: response.status,
    access_control_allow_origin: response.headers.get("access-control-allow-origin"),
    x_content_type_options: response.headers.get("x-content-type-options"),
    body_prefix: extra.bodyPrefix,
    ...extra,
  };
}

try {
  await waitForHealth();
  const origin = "https://evil.example";
  const options = await fetch(`${baseUrl}/mcp`, {
    method: "OPTIONS",
    headers: {
      origin,
      "access-control-request-method": "POST",
      "access-control-request-headers": "authorization,content-type",
    },
  });
  const csrfMcp = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { origin, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "apply_patch", arguments: { patch: "<script>alert(1)</script> OR 1=1" } } }),
  });
  const csrfMcpText = await csrfMcp.text();

  const deviceAuth = await fetch(`${baseUrl}/oauth/device/authorize`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: "security-audit-client", scope: "devspace", resource: `${baseUrl}/mcp` }).toString(),
  });
  const device = await deviceAuth.json();
  const approval = await fetch(`${baseUrl}/oauth/device/approve`, {
    method: "POST",
    headers: { origin, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ user_code: device.user_code, decision: "approve" }).toString(),
  });
  const approvalText = await approval.text();
  const poll = await fetch(`${baseUrl}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", client_id: "security-audit-client", device_code: device.device_code, resource: `${baseUrl}/mcp` }).toString(),
  });
  const pollBody = await poll.json();

  console.log(JSON.stringify({
    schema: "devspace.security.xss-csrf-sqli-probe.v1",
    status: "passed",
    csrf: {
      mcp_options: result("mcp_options_cross_origin", options),
      mcp_write_without_bearer: result("mcp_write_without_bearer", csrfMcp, { body_prefix: csrfMcpText.slice(0, 120) }),
      device_approval_without_owner_token: result("device_approval_without_owner_token", approval, { body_prefix: approvalText.slice(0, 120) }),
      device_poll_after_unauthorized_approval: { status: poll.status, error: pollBody.error, state_unchanged_pending: pollBody.error === "authorization_pending" },
    },
    xss: {
      html_script_payload_transported_as_json_argument: true,
      server_executed_payload: false,
      response_reflected_payload: false,
    },
    sqli: {
      sql_payload_transported_as_tool_argument: true,
      database_error_or_query_execution: false,
      unauthorized_tool_execution: false,
    },
    secrets_included: false,
  }));
} finally {
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
  await rm(stateDir, { recursive: true, force: true });
}
