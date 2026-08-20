import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import express, { type Express } from "express";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { registerOAuthDeviceRoutes } from "./oauth-device-routes.js";
import { SingleUserOAuthProvider } from "./oauth-provider.js";
import { createRuntimeMetrics } from "./metrics.js";

const OWNER_TOKEN = "test-owner-token-that-is-long-enough";
const DEVICE_PEPPER = "test-device-pepper-012345678901234567890123456789";
const MCP_URL = new URL("http://127.0.0.1/mcp");

interface Harness {
  app: Express;
  server: Server;
  baseUrl: string;
  provider: SingleUserOAuthProvider;
  client: OAuthClientInformationFull;
  close: () => Promise<void>;
}

async function createHarness(configOverrides: Record<string, unknown> = {}): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), "devspace-routes-test-"));
  const provider = new SingleUserOAuthProvider(
    {
      ownerToken: OWNER_TOKEN,
      accessTokenTtlSeconds: 3600,
      refreshTokenTtlSeconds: 2592000,
      scopes: ["devspace", "custom:scope"],
      allowedRedirectHosts: ["localhost", "127.0.0.1"],
      devicePepper: DEVICE_PEPPER,
      ...configOverrides,
    },
    MCP_URL,
    dir,
  );

  const client = (provider.clientsStore as unknown as { registerClient: (c: Record<string, unknown>) => OAuthClientInformationFull }).registerClient({
    client_name: "<script>alert('xss')</script> Client",
    redirect_uris: ["http://127.0.0.1/callback"],
    grant_types: ["urn:ietf:params:oauth:grant-type:device_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });

  const app = express();
  const metrics = createRuntimeMetrics();
  const issuerUrl = new URL("http://127.0.0.1");

  registerOAuthDeviceRoutes(app, provider, issuerUrl, metrics);

  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  const close = async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    provider.close();
    await rm(dir, { recursive: true, force: true });
  };

  return { app, server, baseUrl, provider, client, close };
}

function form(values: Record<string, string>): string {
  return new URLSearchParams(values).toString();
}

test("device authorization route validates client_id and resource", async () => {
  const h = await createHarness();
  try {
    // Missing client_id
    const res1 = await fetch(`${h.baseUrl}/oauth/device/authorize`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form({ scope: "devspace" }),
    });
    assert.equal(res1.status, 400);
    const body1 = await res1.json() as { error: string };
    assert.equal(body1.error, "invalid_request");

    // Invalid resource format
    const res2 = await fetch(`${h.baseUrl}/oauth/device/authorize`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form({ client_id: h.client.client_id, resource: "not-a-valid-url" }),
    });
    assert.equal(res2.status, 400);

    // Valid authorize request
    const res3 = await fetch(`${h.baseUrl}/oauth/device/authorize`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form({ client_id: h.client.client_id, scope: "devspace" }),
    });
    assert.equal(res3.status, 200);
    const body3 = await res3.json() as { user_code: string; device_code: string; verification_uri: string };
    assert.match(body3.user_code, /^[A-Z2-9]+-[A-Z2-9]+$/);
    assert.ok(body3.device_code);
    assert.ok(body3.verification_uri);
  } finally {
    await h.close();
  }
});

test("device approval page escapes HTML to prevent XSS", async () => {
  const h = await createHarness();
  try {
    const authRes = await fetch(`${h.baseUrl}/oauth/device/authorize`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form({ client_id: h.client.client_id, scope: "devspace" }),
    });
    const { user_code } = await authRes.json() as { user_code: string };

    const pageRes = await fetch(`${h.baseUrl}/oauth/device?user_code=${encodeURIComponent(user_code)}`);
    assert.equal(pageRes.status, 200);
    const html = await pageRes.text();
    // Verify client name is escaped
    assert.ok(html.includes(h.client.client_id));
    assert.ok(!html.includes("<script>alert('xss')</script>"));
    assert.ok(html.includes("Autorizar DevSpace CLI"));
  } finally {
    await h.close();
  }
});

test("device approval page handles invalid or missing user_code", async () => {
  const h = await createHarness();
  try {
    const res = await fetch(`${h.baseUrl}/oauth/device?user_code=INVALIDCODE`);
    assert.equal(res.status, 400);
    const html = await res.text();
    assert.ok(html.includes("Código inválido ou expirado"));
  } finally {
    await h.close();
  }
});

test("POST /oauth/device/approve enforces owner_token and decision", async () => {
  const h = await createHarness();
  try {
    const authRes = await fetch(`${h.baseUrl}/oauth/device/authorize`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form({ client_id: h.client.client_id, scope: "devspace" }),
    });
    const { user_code } = await authRes.json() as { user_code: string };

    // Wrong owner_token -> 403
    const badApprove = await fetch(`${h.baseUrl}/oauth/device/approve`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form({ user_code, owner_token: "wrong-owner-token", decision: "approve" }),
    });
    assert.equal(badApprove.status, 403);
    const badHtml = await badApprove.text();
    assert.ok(badHtml.includes("A aprovação foi recusada ou expirou"));

    // Valid owner_token -> 303 Redirect
    const goodApprove = await fetch(`${h.baseUrl}/oauth/device/approve`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form({ user_code, owner_token: OWNER_TOKEN, decision: "approve" }),
    });
    assert.equal(goodApprove.status, 303);
    const location = goodApprove.headers.get("location");
    assert.ok(location);
    assert.ok(decodeURIComponent(location).includes("Autorização registrada"));
  } finally {
    await h.close();
  }
});

test("POST /oauth/device/approve supports denial flow", async () => {
  const h = await createHarness();
  try {
    const authRes = await fetch(`${h.baseUrl}/oauth/device/authorize`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form({ client_id: h.client.client_id, scope: "devspace" }),
    });
    const { user_code, device_code } = await authRes.json() as { user_code: string; device_code: string };

    // Decision = deny
    const denyRes = await fetch(`${h.baseUrl}/oauth/device/approve`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form({ user_code, owner_token: OWNER_TOKEN, decision: "deny" }),
    });
    assert.equal(denyRes.status, 303);
    const location = denyRes.headers.get("location");
    assert.ok(location);
    assert.ok(decodeURIComponent(location).includes("Solicitação negada"));

    // Token poll returns access_denied
    const tokenRes = await fetch(`${h.baseUrl}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: h.client.client_id,
        device_code,
      }),
    });
    assert.equal(tokenRes.status, 400);
    const tokenBody = await tokenRes.json() as { error: string };
    assert.equal(tokenBody.error, "access_denied");
  } finally {
    await h.close();
  }
});

test("POST /token passes non-device grants through to next middleware", async () => {
  const h = await createHarness();
  try {
    const res = await fetch(`${h.baseUrl}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form({ grant_type: "authorization_code" }),
    });
    // In our isolated test app without mcpAuthRouter attached, passing to next() yields 404
    assert.equal(res.status, 404);
  } finally {
    await h.close();
  }
});
