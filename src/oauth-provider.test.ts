import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { InvalidGrantError, InvalidRequestError, InvalidTokenError, AccessDeniedError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { SingleUserOAuthProvider, type OAuthConfig } from "./oauth-provider.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OWNER_TOKEN = "test-owner-token-that-is-long-enough";
const DEVICE_PEPPER = "test-device-pepper-012345678901234567890123456789";
const IDENTITY_SECRET = "trusted-header-secret-at-least-16";
const MCP_URL = new URL("https://agent.example.com/mcp");
const REDIRECT_URI = "https://chatgpt.com/connector_platform_oauth_redirect";

function defaultConfig(overrides: Partial<OAuthConfig> = {}): OAuthConfig {
  return {
    ownerToken: OWNER_TOKEN,
    accessTokenTtlSeconds: 3600,
    refreshTokenTtlSeconds: 2592000,
    scopes: ["devspace"],
    allowedRedirectHosts: ["chatgpt.com", "localhost", "127.0.0.1"],
    devicePepper: DEVICE_PEPPER,
    ...overrides,
  };
}

async function withProvider(
  fn: (provider: SingleUserOAuthProvider, stateDir: string) => Promise<void> | void,
  configOverrides: Partial<OAuthConfig> = {},
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "devspace-oauth-provider-test-"));
  const provider = new SingleUserOAuthProvider(defaultConfig(configOverrides), MCP_URL, dir);
  try {
    await fn(provider, dir);
  } finally {
    provider.close();
    await rm(dir, { recursive: true, force: true });
  }
}

function registerTestClient(provider: SingleUserOAuthProvider): Promise<OAuthClientInformationFull> {
  return Promise.resolve(
    (provider.clientsStore as unknown as { registerClient: (client: Record<string, unknown>) => OAuthClientInformationFull }).registerClient({
      redirect_uris: [REDIRECT_URI],
      client_name: "Test Client",
      grant_types: ["authorization_code", "refresh_token", "urn:ietf:params:oauth:grant-type:device_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  );
}

// Minimal Express Response/Request mocks
// These capture the provider's behavior without spinning up a full HTTP server.

interface MockResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  redirectUrl: string | undefined;
  headersSent: boolean;
  req: MockRequest;
  status(code: number): MockResponse;
  setHeader(name: string, value: string): MockResponse;
  send(body: string): MockResponse;
  redirect(statusCode: number, url: string): void;
}

interface MockRequest {
  method: string;
  body?: Record<string, string>;
  header?: (name: string) => string | undefined;
}

function mockRes(req: MockRequest): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    headers: {},
    body: "",
    redirectUrl: undefined,
    headersSent: false,
    req,
    status(code: number) { res.statusCode = code; return res; },
    setHeader(name: string, value: string) { res.headers[name] = value; return res; },
    send(body: string) { res.body = body; res.headersSent = true; return res; },
    redirect(statusCode: number, url: string) { res.statusCode = statusCode; res.redirectUrl = url; res.headersSent = true; },
  };
  return res;
}

function authorizationParams(client: OAuthClientInformationFull, overrides: Record<string, unknown> = {}) {
  return {
    redirectUri: REDIRECT_URI,
    codeChallenge: "test-challenge",
    scopes: ["devspace"],
    resource: MCP_URL,
    state: "test-state",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// T1.2: authorize() GET renders HTML form
// ---------------------------------------------------------------------------

test("authorize() GET renders HTML approval form with client name and scopes", async () => {
  await withProvider(async (provider) => {
    const client = await registerTestClient(provider);
    const req: MockRequest = { method: "GET" };
    const res = mockRes(req);
    const params = authorizationParams(client);

    await provider.authorize(client, params, res as unknown as import("express").Response);

    assert.equal(res.statusCode, 200);
    assert.ok(res.headers["Content-Type"]?.includes("text/html"));
    assert.ok(res.body.includes("Connect DevSpace"));
    assert.ok(res.body.includes("Test Client"));
    assert.ok(res.body.includes("devspace"));
    assert.ok(res.body.includes("owner_token"));
  });
});

// ---------------------------------------------------------------------------
// T1.3: authorize() POST valid owner_token → code + redirect
// ---------------------------------------------------------------------------

test("authorize() POST with valid owner_token issues auth code and redirects", async () => {
  await withProvider(async (provider) => {
    const client = await registerTestClient(provider);
    const req: MockRequest = { method: "POST", body: { owner_token: OWNER_TOKEN } };
    const res = mockRes(req);
    const params = authorizationParams(client);

    await provider.authorize(client, params, res as unknown as import("express").Response);

    assert.equal(res.statusCode, 302);
    assert.ok(res.redirectUrl);
    const redirected = new URL(res.redirectUrl);
    assert.ok(redirected.searchParams.get("code")?.startsWith("code-"));
    assert.equal(redirected.searchParams.get("state"), "test-state");
    assert.equal(redirected.origin + redirected.pathname, REDIRECT_URI);
  });
});

// ---------------------------------------------------------------------------
// T1.4: authorize() POST invalid owner_token → 401
// ---------------------------------------------------------------------------

test("authorize() POST with invalid owner_token returns 401 with error form", async () => {
  await withProvider(async (provider) => {
    const client = await registerTestClient(provider);
    const req: MockRequest = { method: "POST", body: { owner_token: "wrong-token-value" } };
    const res = mockRes(req);
    const params = authorizationParams(client);

    await provider.authorize(client, params, res as unknown as import("express").Response);

    assert.equal(res.statusCode, 401);
    assert.ok(res.body.includes("Owner password was not accepted"));
  });
});

// ---------------------------------------------------------------------------
// T1.5: authorize() rejects unsupported scopes
// ---------------------------------------------------------------------------

test("authorize() rejects unsupported scope with InvalidRequestError", async () => {
  await withProvider(async (provider) => {
    const client = await registerTestClient(provider);
    const req: MockRequest = { method: "GET" };
    const res = mockRes(req);
    const params = authorizationParams(client, { scopes: ["admin", "super-secret"] });

    await assert.rejects(
      provider.authorize(client, params, res as unknown as import("express").Response),
      InvalidRequestError,
    );
  });
});

// ---------------------------------------------------------------------------
// T1.6: authorize() rejects invalid resource
// ---------------------------------------------------------------------------

test("authorize() rejects invalid or missing resource with InvalidRequestError", async () => {
  await withProvider(async (provider) => {
    const client = await registerTestClient(provider);
    const req: MockRequest = { method: "GET" };
    const res = mockRes(req);

    // Missing resource
    const paramsNoResource = authorizationParams(client, { resource: undefined });
    await assert.rejects(
      provider.authorize(client, paramsNoResource, res as unknown as import("express").Response),
      InvalidRequestError,
    );

    // Wrong resource
    const paramsWrongResource = authorizationParams(client, { resource: new URL("https://evil.example.com/mcp") });
    await assert.rejects(
      provider.authorize(client, paramsWrongResource, res as unknown as import("express").Response),
      InvalidRequestError,
    );
  });
});

// ---------------------------------------------------------------------------
// T1.7: exchangeAuthorizationCode() one-time use
// ---------------------------------------------------------------------------

test("exchangeAuthorizationCode() is one-time-use and rejects replay", async () => {
  await withProvider(async (provider) => {
    const client = await registerTestClient(provider);

    // Seed a code via authorize POST
    const req: MockRequest = { method: "POST", body: { owner_token: OWNER_TOKEN } };
    const res = mockRes(req);
    await provider.authorize(client, authorizationParams(client), res as unknown as import("express").Response);
    const code = new URL(res.redirectUrl!).searchParams.get("code")!;

    // First exchange succeeds
    const tokens = await provider.exchangeAuthorizationCode(client, code, undefined, REDIRECT_URI, MCP_URL);
    assert.ok(tokens.access_token);
    assert.ok(tokens.refresh_token);
    assert.equal(tokens.token_type, "bearer");

    // Replay rejects
    await assert.rejects(
      provider.exchangeAuthorizationCode(client, code, undefined, REDIRECT_URI, MCP_URL),
      InvalidGrantError,
    );
  });
});

// ---------------------------------------------------------------------------
// T1.8: exchangeAuthorizationCode() expired code
// ---------------------------------------------------------------------------

test("exchangeAuthorizationCode() rejects expired authorization code", async () => {
  await withProvider(async (provider) => {
    const client = await registerTestClient(provider);

    // Manually insert an expired code (bypass authorize())
    const code = "code-expired-test";
    (provider as unknown as { codes: Map<string, unknown> }).codes.set(code, {
      clientId: client.client_id,
      params: authorizationParams(client),
      expiresAtMs: Date.now() - 1000, // already expired
    });

    await assert.rejects(
      provider.exchangeAuthorizationCode(client, code, undefined, REDIRECT_URI, MCP_URL),
      InvalidGrantError,
    );
  });
});

// ---------------------------------------------------------------------------
// T1.9: exchangeAuthorizationCode() redirect_uri mismatch
// ---------------------------------------------------------------------------

test("exchangeAuthorizationCode() rejects mismatched redirect_uri", async () => {
  await withProvider(async (provider) => {
    const client = await registerTestClient(provider);
    const req: MockRequest = { method: "POST", body: { owner_token: OWNER_TOKEN } };
    const res = mockRes(req);
    await provider.authorize(client, authorizationParams(client), res as unknown as import("express").Response);
    const code = new URL(res.redirectUrl!).searchParams.get("code")!;

    await assert.rejects(
      provider.exchangeAuthorizationCode(client, code, undefined, "https://evil.example.com/callback", MCP_URL),
      InvalidGrantError,
    );
  });
});

// ---------------------------------------------------------------------------
// T1.10: createDeviceAuthorization() validates scopes + resource
// ---------------------------------------------------------------------------

test("createDeviceAuthorization() validates scopes and resource", async () => {
  await withProvider(async (provider) => {
    const client = await registerTestClient(provider);

    // Valid request
    const created = await provider.createDeviceAuthorization(client.client_id, ["devspace"], MCP_URL);
    assert.ok(created.deviceCode);
    assert.match(created.userCode, /^[A-Z2-9]+-[A-Z2-9]+$/);
    assert.equal(created.expiresInSeconds, 600);
    assert.equal(created.intervalSeconds, 5);

    // Invalid scope
    await assert.rejects(
      provider.createDeviceAuthorization(client.client_id, ["admin"], MCP_URL),
      InvalidRequestError,
    );

    // Invalid resource
    await assert.rejects(
      provider.createDeviceAuthorization(client.client_id, ["devspace"], new URL("https://evil.example.com/mcp")),
      InvalidRequestError,
    );
  });
});

// ---------------------------------------------------------------------------
// T1.11: approveDeviceAuthorization() owner_token mode
// ---------------------------------------------------------------------------

test("approveDeviceAuthorization() accepts valid owner_token and rejects invalid", async () => {
  await withProvider(async (provider) => {
    const client = await registerTestClient(provider);
    const created = await provider.createDeviceAuthorization(client.client_id, ["devspace"], MCP_URL);

    // Invalid token → no approval
    assert.equal(provider.approveDeviceAuthorization(created.userCode, "wrong-token"), false);

    // Valid token → approval
    assert.equal(provider.approveDeviceAuthorization(created.userCode, OWNER_TOKEN), true);

    // Already approved → cannot re-approve
    assert.equal(provider.approveDeviceAuthorization(created.userCode, OWNER_TOKEN), false);
  });
});

// ---------------------------------------------------------------------------
// T1.12: approveDeviceAuthorization() trusted_header mode
// ---------------------------------------------------------------------------

test("approveDeviceAuthorization() trusted_header validates HMAC proof", async () => {
  await withProvider(async (provider) => {
    const client = await registerTestClient(provider);
    const created = await provider.createDeviceAuthorization(client.client_id, ["devspace"], MCP_URL);

    const subjectId = "gateway-user@example.com";
    const context = `${subjectId}|${created.userCode}`;
    const validProof = createHmac("sha256", IDENTITY_SECRET).update(context).digest("base64url");

    // Valid proof → approval
    assert.equal(provider.approveDeviceAuthorization(created.userCode, "", subjectId, validProof), true);
  }, { approvalMode: "trusted_header", approvalIdentitySecret: IDENTITY_SECRET });
});

test("approveDeviceAuthorization() trusted_header rejects invalid HMAC proof", async () => {
  await withProvider(async (provider) => {
    const client = await registerTestClient(provider);
    const created = await provider.createDeviceAuthorization(client.client_id, ["devspace"], MCP_URL);

    // Invalid proof
    assert.equal(provider.approveDeviceAuthorization(created.userCode, "", "user@example.com", "invalid-proof"), false);
    // Missing subject
    assert.equal(provider.approveDeviceAuthorization(created.userCode, "", undefined, "any-proof"), false);
    // Missing proof
    assert.equal(provider.approveDeviceAuthorization(created.userCode, "", "user@example.com", undefined), false);
  }, { approvalMode: "trusted_header", approvalIdentitySecret: IDENTITY_SECRET });
});

// ---------------------------------------------------------------------------
// T1.13: denyDeviceAuthorization() + prevent re-approval
// ---------------------------------------------------------------------------

test("denyDeviceAuthorization() marks as denied and prevents re-approval", async () => {
  await withProvider(async (provider) => {
    const client = await registerTestClient(provider);
    const created = await provider.createDeviceAuthorization(client.client_id, ["devspace"], MCP_URL);

    assert.equal(provider.denyDeviceAuthorization(created.userCode, OWNER_TOKEN), true);
    // Cannot approve after denial
    assert.equal(provider.approveDeviceAuthorization(created.userCode, OWNER_TOKEN), false);
    // Cannot deny twice
    assert.equal(provider.denyDeviceAuthorization(created.userCode, OWNER_TOKEN), false);
  });
});

test("denyDeviceAuthorization() rejects with invalid owner_token", async () => {
  await withProvider(async (provider) => {
    const client = await registerTestClient(provider);
    const created = await provider.createDeviceAuthorization(client.client_id, ["devspace"], MCP_URL);

    assert.equal(provider.denyDeviceAuthorization(created.userCode, "wrong-token"), false);
  });
});

// ---------------------------------------------------------------------------
// T1.14: exchangeDeviceCode() state machine
// ---------------------------------------------------------------------------

test("exchangeDeviceCode() returns tokens on approved and rejects pending/denied/expired", async () => {
  await withProvider(async (provider) => {
    const client = await registerTestClient(provider);

    // Pending → authorization_pending error
    const pending = await provider.createDeviceAuthorization(client.client_id, ["devspace"], MCP_URL);
    await assert.rejects(
      provider.exchangeDeviceCode(client.client_id, pending.deviceCode, MCP_URL),
      (err: Error) => err.message === "authorization_pending",
    );

    // Denied → access denied
    const denied = await provider.createDeviceAuthorization(client.client_id, ["devspace"], MCP_URL);
    provider.denyDeviceAuthorization(denied.userCode, OWNER_TOKEN);
    await assert.rejects(
      provider.exchangeDeviceCode(client.client_id, denied.deviceCode, MCP_URL),
      AccessDeniedError,
    );

    // Approved → tokens issued
    const approved = await provider.createDeviceAuthorization(client.client_id, ["devspace"], MCP_URL);
    provider.approveDeviceAuthorization(approved.userCode, OWNER_TOKEN);
    const tokens = await provider.exchangeDeviceCode(client.client_id, approved.deviceCode, MCP_URL);
    assert.ok(tokens.access_token);
    assert.ok(tokens.refresh_token);
    assert.equal(tokens.token_type, "bearer");

    // Consumed → invalid_grant (replay)
    await assert.rejects(
      provider.exchangeDeviceCode(client.client_id, approved.deviceCode, MCP_URL),
      InvalidGrantError,
    );
  });
});

// ---------------------------------------------------------------------------
// T1.15: verifyAccessToken() rejects expired
// ---------------------------------------------------------------------------

test("verifyAccessToken() rejects expired tokens with InvalidTokenError", async () => {
  await withProvider(async (provider) => {
    const client = await registerTestClient(provider);

    // Issue tokens via device flow
    const created = await provider.createDeviceAuthorization(client.client_id, ["devspace"], MCP_URL);
    provider.approveDeviceAuthorization(created.userCode, OWNER_TOKEN);
    const tokens = await provider.exchangeDeviceCode(client.client_id, created.deviceCode, MCP_URL);

    // Valid token verifies successfully
    const authInfo = await provider.verifyAccessToken(tokens.access_token);
    assert.equal(authInfo.clientId, client.client_id);
    assert.deepEqual(authInfo.scopes, ["devspace"]);

    // Non-existent token rejects
    await assert.rejects(
      provider.verifyAccessToken("completely-fabricated-token"),
      InvalidTokenError,
    );
  });
});

// ---------------------------------------------------------------------------
// T1.16: issueTokens() propagates subjectId via device flow
// ---------------------------------------------------------------------------

test("issueTokens() propagates subjectId through device authorization flow", async () => {
  await withProvider(async (provider) => {
    const client = await registerTestClient(provider);
    const created = await provider.createDeviceAuthorization(client.client_id, ["devspace"], MCP_URL);
    provider.approveDeviceAuthorization(created.userCode, OWNER_TOKEN);
    const tokens = await provider.exchangeDeviceCode(client.client_id, created.deviceCode, MCP_URL);

    const authInfo = await provider.verifyAccessToken(tokens.access_token);
    assert.equal(authInfo.extra?.principalId, "owner");
  });
});

test("issueTokens() propagates trusted_header subjectId through device authorization flow", async () => {
  await withProvider(async (provider) => {
    const client = await registerTestClient(provider);
    const created = await provider.createDeviceAuthorization(client.client_id, ["devspace"], MCP_URL);

    const subjectId = "gateway-user@example.com";
    const context = `${subjectId}|${created.userCode}`;
    const proof = createHmac("sha256", IDENTITY_SECRET).update(context).digest("base64url");
    provider.approveDeviceAuthorization(created.userCode, "", subjectId, proof);

    const tokens = await provider.exchangeDeviceCode(client.client_id, created.deviceCode, MCP_URL);
    const authInfo = await provider.verifyAccessToken(tokens.access_token);
    assert.equal(authInfo.extra?.principalId, subjectId);
  }, { approvalMode: "trusted_header", approvalIdentitySecret: IDENTITY_SECRET });
});

// ---------------------------------------------------------------------------
// usesTrustedApproval() mode detection
// ---------------------------------------------------------------------------

test("usesTrustedApproval() reports correct mode", async () => {
  await withProvider(async (provider) => {
    assert.equal(provider.usesTrustedApproval(), false);
  });
  await withProvider(async (provider) => {
    assert.equal(provider.usesTrustedApproval(), true);
  }, { approvalMode: "trusted_header", approvalIdentitySecret: IDENTITY_SECRET });
});
