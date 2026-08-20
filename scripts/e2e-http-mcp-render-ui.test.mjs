import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const port = Number(process.env.E2E_RENDER_UI_PORT ?? 17683);
const baseUrl = process.env.E2E_RENDER_UI_BASE_URL ?? `http://127.0.0.1:${port}`;
const ownerToken = "render-ui-e2e-owner-token-0123456789";
const redirectUri = `http://127.0.0.1:${port + 1}/callback`;

/*
 * Generative UI E2E contract, over real HTTP with a real bearer token:
 * 1. render_ui and its ui:// resource are exposed on an authenticated session.
 * 2. A catalog-conforming spec renders and reaches the app through _meta.
 * 3. A spec that violates the catalog is rejected and never reaches the app.
 * 4. The app resource points at assets the server actually serves.
 */

async function waitForHealth() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return;
    } catch {
      /* readiness retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("server did not become ready");
}

function parseRpc(text) {
  const match = text.match(/data:\s*([\s\S]*)/);
  const data = match?.[1]?.trim() ?? text.trim();
  return JSON.parse(data || text);
}

async function exchangeOAuthToken() {
  const metadata = await (await fetch(`${baseUrl}/.well-known/oauth-authorization-server`)).json();
  const registration = await fetch(metadata.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "devspace-render-ui-e2e",
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
    resource: `${baseUrl}/mcp`,
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
      resource: `${baseUrl}/mcp`,
    }).toString(),
  });
  assert.equal(tokenResponse.status, 200);
  const tokens = await tokenResponse.json();
  assert.ok(tokens.access_token);
  return tokens.access_token;
}

const validSpec = {
  root: "card",
  elements: {
    card: {
      type: "Card",
      props: { title: "Suite status", description: null, maxWidth: null, centered: null, className: null },
      children: ["s"],
    },
    s: {
      type: "Stack",
      props: { direction: "vertical", gap: "md", align: null, justify: null, className: null },
      children: ["h", "t"],
    },
    h: { type: "Heading", props: { text: "Suite status", level: "h2" }, children: [] },
    t: {
      type: "Table",
      props: { columns: ["Suite", "Result"], rows: [["config", "pass"]], caption: null },
      children: [],
    },
  },
};

const invalidSpec = {
  root: "x",
  elements: {
    x: { type: "ScriptTag", props: { src: "https://evil.example/x.js" }, children: [] },
  },
};

test("render_ui serves generative UI over an authenticated HTTP MCP session", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "devspace-render-ui-e2e-"));
  const child = process.env.E2E_RENDER_UI_BASE_URL
    ? null
    : spawn(process.execPath, ["dist/server.js"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          HOST: "127.0.0.1",
          PORT: String(port),
          DEVSPACE_STATE_DIR: stateDir,
          DEVSPACE_ALLOWED_ROOTS: process.cwd(),
          DEVSPACE_PUBLIC_BASE_URL: baseUrl,
          DEVSPACE_WIDGETS: "full",
          DEVSPACE_OAUTH_OWNER_TOKEN: ownerToken,
        },
        stdio: "ignore",
      });

  try {
    await waitForHealth();
    const accessToken = await exchangeOAuthToken();
    const rpc = async (body, sessionId) => {
      const headers = {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${accessToken}`,
      };
      if (sessionId) headers["mcp-session-id"] = sessionId;
      return fetch(`${baseUrl}/mcp`, { method: "POST", headers, body: JSON.stringify(body) });
    };

    const initialize = await rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "render-ui-e2e", version: "1.0.0" },
      },
    });
    assert.equal(initialize.status, 200);
    const sessionId = initialize.headers.get("mcp-session-id");
    assert.ok(sessionId);
    await rpc({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }, sessionId);

    const tools = parseRpc(
      await (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, sessionId)).text(),
    );
    const renderTool = tools.result.tools.find((tool) => tool.name === "render_ui");
    assert.ok(renderTool, "render_ui must be exposed");
    assert.equal(renderTool.annotations?.readOnlyHint, true);
    assert.equal(renderTool._meta?.ui?.resourceUri, "ui://devspace/json-render-app.html");

    const resources = parseRpc(
      await (await rpc({ jsonrpc: "2.0", id: 3, method: "resources/list", params: {} }, sessionId)).text(),
    );
    assert.ok(
      resources.result.resources.some((entry) => entry.uri === "ui://devspace/json-render-app.html"),
      "the generative UI resource must be listed",
    );

    const resource = parseRpc(
      await (
        await rpc(
          {
            jsonrpc: "2.0",
            id: 4,
            method: "resources/read",
            params: { uri: "ui://devspace/json-render-app.html" },
          },
          sessionId,
        )
      ).text(),
    );
    const html = resource.result.contents[0].text;
    const scriptMatch = html.match(/src="([^"]+json-render-app-[^"]+\.js)"/);
    assert.ok(scriptMatch, "app resource must reference its built entry");
    assert.deepEqual(resource.result.contents[0]._meta.ui.csp, {
      resourceDomains: [baseUrl],
      connectDomains: [baseUrl],
    });

    const asset = await fetch(scriptMatch[1]);
    assert.equal(asset.status, 200, "the referenced asset must be served");

    const rendered = parseRpc(
      await (
        await rpc(
          {
            jsonrpc: "2.0",
            id: 5,
            method: "tools/call",
            params: { name: "render_ui", arguments: { spec: validSpec, title: "Suite" } },
          },
          sessionId,
        )
      ).text(),
    );
    assert.equal(rendered.error, undefined);
    assert.equal(rendered.result.isError, undefined);
    assert.deepEqual(rendered.result.structuredContent, {
      rendered: true,
      elementCount: 4,
      title: "Suite",
    });
    assert.ok(rendered.result._meta.jsonRender.spec, "the validated spec must reach the app");

    const rejected = parseRpc(
      await (
        await rpc(
          {
            jsonrpc: "2.0",
            id: 6,
            method: "tools/call",
            params: { name: "render_ui", arguments: { spec: invalidSpec } },
          },
          sessionId,
        )
      ).text(),
    );
    assert.equal(rejected.result.isError, true);
    assert.match(rejected.result.content[0].text, /INVALID_UI_SPEC/);
    assert.equal(
      rejected.result._meta?.jsonRender,
      undefined,
      "a rejected spec must never reach the app",
    );
  } finally {
    child?.kill();
    // Windows keeps the SQLite handle briefly after the child exits; a failed
    // temp cleanup must not mask the assertions above.
    await new Promise((resolve) => setTimeout(resolve, 250));
    await rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});
