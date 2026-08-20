import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";

interface LandingFixture {
  /** Where the server actually listens, on an OS-assigned port. */
  baseUrl: string;
  /** What the page advertises, independent of the bound port. */
  publicBaseUrl: string;
  html: string;
}

async function landingPage(
  t: TestContext,
  publicBaseUrl = "https://devspace.example.test",
): Promise<LandingFixture> {
  const root = await mkdtemp(join(tmpdir(), "devspace-landing-test-"));
  const config = loadConfig({
    HOST: "127.0.0.1",
    DEVSPACE_PUBLIC_BASE_URL: publicBaseUrl,
    DEVSPACE_CONFIG_DIR: join(root, ".config"),
    DEVSPACE_ALLOWED_ROOTS: root,
    DEVSPACE_STATE_DIR: join(root, ".state"),
    DEVSPACE_WORKTREE_ROOT: join(root, ".worktrees"),
    DEVSPACE_AGENT_DIR: join(root, ".agents"),
    DEVSPACE_OAUTH_OWNER_TOKEN: "landing-page-owner-token-0123456789",
  });

  const { app, close } = createServer(config);
  const httpServer = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.once("listening", () => resolve());
  });

  t.after(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await close();
    await rm(root, { recursive: true, force: true });
  });

  const address = httpServer.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  const response = await fetch(`${baseUrl}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);

  return { baseUrl, publicBaseUrl: config.publicBaseUrl, html: await response.text() };
}

test("the landing page describes the server and links only to endpoints it serves", async (t) => {
  const { baseUrl, publicBaseUrl, html } = await landingPage(t);

  assert.match(html, /DevSpace MCP Server/);
  assert.match(html, /<html lang="pt-BR">/);

  // Every advertised endpoint must exist, otherwise the page ships dead links.
  for (const path of ["/mcp", "/oauth/device", "/healthz", "/.well-known/oauth-authorization-server"]) {
    assert.ok(html.includes(path), `landing page must advertise ${path}`);
  }

  for (const path of ["/healthz", "/.well-known/oauth-authorization-server"]) {
    const linked = await fetch(`${baseUrl}${path}`);
    assert.equal(linked.status, 200, `${path} must be reachable`);
  }

  const device = await fetch(`${baseUrl}/oauth/device`, { redirect: "manual" });
  assert.ok(device.status < 500, "the device authorization page must not fail");

  // /mcp needs a bearer token, so it answers 401 rather than 200. Requesting it
  // still proves the route is mounted, which html.includes() alone cannot.
  const mcp = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  });
  assert.notEqual(mcp.status, 404, "/mcp must be mounted");
  assert.ok(mcp.status < 500, `/mcp must not fail: got ${mcp.status}`);

  // The connection hint carries the advertised public base URL, fully interpolated.
  assert.ok(html.includes(`${publicBaseUrl}/mcp`), "the hint must interpolate publicBaseUrl");
  assert.ok(html.includes(`${publicBaseUrl}/authorize`), "the hint must interpolate the authorize URL");
  assert.doesNotMatch(html, /\$\{/, "no unresolved template expression may reach the response");
});

test("the landing page escapes the public base URL instead of interpolating it raw", async (t) => {
  // Config normalization drops the query string and percent-encodes angle
  // brackets, so a path-embedded `&` is the character that actually reaches the
  // template; unescaped it would open an entity in the rendered hint.
  const { html } = await landingPage(t, "https://devspace.example.test/tenant&team");

  assert.ok(html.includes("tenant&amp;team"), "an ampersand in the base URL must be escaped");
  assert.doesNotMatch(html, /tenant&team/, "the raw ampersand must not survive into the markup");
});

test("the landing page does not leak owner credentials", async (t) => {
  const { html } = await landingPage(t);

  assert.doesNotMatch(html, /landing-page-owner-token/, "the owner token must never render");
  assert.doesNotMatch(html, /ownerToken|owner_token/i, "no credential field may appear in the page");
});
