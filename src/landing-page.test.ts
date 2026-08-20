import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";

interface LandingFixture {
  baseUrl: string;
  html: string;
}

async function landingPage(
  t: TestContext,
  port: number,
  publicBaseUrl?: string,
): Promise<LandingFixture> {
  const root = await mkdtemp(join(tmpdir(), "devspace-landing-test-"));
  const localUrl = `http://127.0.0.1:${port}`;
  const config = loadConfig({
    HOST: "127.0.0.1",
    PORT: String(port),
    DEVSPACE_PUBLIC_BASE_URL: publicBaseUrl ?? localUrl,
    DEVSPACE_CONFIG_DIR: join(root, ".config"),
    DEVSPACE_ALLOWED_ROOTS: root,
    DEVSPACE_STATE_DIR: join(root, ".state"),
    DEVSPACE_WORKTREE_ROOT: join(root, ".worktrees"),
    DEVSPACE_AGENT_DIR: join(root, ".agents"),
    DEVSPACE_OAUTH_OWNER_TOKEN: "landing-page-owner-token-0123456789",
  });

  const { app, close } = createServer(config);
  const httpServer = app.listen(port, "127.0.0.1");
  await new Promise<void>((resolve) => httpServer.once("listening", () => resolve()));
  t.after(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await close();
    await rm(root, { recursive: true, force: true });
  });

  const response = await fetch(`${localUrl}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);

  return { baseUrl: localUrl, html: await response.text() };
}

test("the landing page describes the server and links only to endpoints it serves", async (t) => {
  const port = 17751;
  const { baseUrl, html } = await landingPage(t, port);

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

  // The connection hint carries the real public base URL, fully interpolated.
  assert.ok(html.includes(`${baseUrl}/mcp`), "the hint must interpolate publicBaseUrl");
  assert.ok(html.includes(`${baseUrl}/authorize`), "the hint must interpolate the authorize URL");
  assert.doesNotMatch(html, /\$\{/, "no unresolved template expression may reach the response");
});

test("the landing page escapes the public base URL instead of interpolating it raw", async (t) => {
  const port = 17752;
  // Config normalization drops the query string and percent-encodes angle
  // brackets, so a path-embedded `&` is the character that actually reaches the
  // template; unescaped it would open an entity in the rendered hint.
  const { html } = await landingPage(t, port, "http://127.0.0.1:17752/tenant&team");

  assert.ok(html.includes("tenant&amp;team"), "an ampersand in the base URL must be escaped");
  assert.doesNotMatch(html, /tenant&team/, "the raw ampersand must not survive into the markup");
});

test("the landing page does not leak owner credentials", async (t) => {
  const port = 17753;
  const { html } = await landingPage(t, port);

  assert.doesNotMatch(html, /landing-page-owner-token/, "the owner token must never render");
  assert.doesNotMatch(html, /ownerToken|owner_token/i, "no credential field may appear in the page");
});
