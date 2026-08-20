import { timingSafeEqual, randomBytes, randomUUID, createHash, createHmac } from "node:crypto";
import type { Request, Response } from "express";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import { SqliteDeviceAuthorizationStore, type DeviceAuthorizationCreated, type DeviceAuthorizationPublicRecord, type DevicePollResult } from "./oauth-device-store.js";
import type { OAuthServerProvider, AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import { AccessDeniedError, InvalidGrantError, InvalidRequestError, InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { checkResourceAllowed, resourceUrlFromServerUrl } from "@modelcontextprotocol/sdk/shared/auth-utils.js";
import { SqliteOAuthClientsStore, SqliteOAuthStore } from "./oauth-store.js";

export type OAuthApprovalMode = "owner_token" | "trusted_header";

export interface OAuthConfig {
  ownerToken: string;
  approvalMode?: OAuthApprovalMode;
  approvalIdentitySecret?: string;
  devicePepper?: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  scopes: string[];
  allowedRedirectHosts: string[];
}

interface AuthorizationCodeRecord {
  clientId: string;
  subjectId?: string;
  params: AuthorizationParams;
  expiresAtMs: number;
}

    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formHtml(params: {
  error?: string;
  clientName: string;
  scopes: string[];
  resource?: URL;
  fields: Record<string, string | undefined>;
}): string {
  const scopeText = params.scopes.length > 0 ? params.scopes.join(" ") : "devspace";
  const resourceText = params.resource?.href ?? "DevSpace MCP endpoint";
  const error = params.error
    ? `<p class="error">${htmlEscape(params.error)}</p>`
    : "";
  const hiddenFields = Object.entries(params.fields)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([name, value]) => `        <input type="hidden" name="${htmlEscape(name)}" value="${htmlEscape(value)}" />`)
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Connect DevSpace</title>
    <style>
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #0f172a; color: #e2e8f0; }
      main { max-width: 440px; margin: 12vh auto; padding: 32px; background: #111827; border: 1px solid #334155; border-radius: 18px; box-shadow: 0 24px 80px rgba(0,0,0,.35); }
      h1 { margin: 0 0 12px; font-size: 28px; }
      p { line-height: 1.5; color: #cbd5e1; }
      dl { padding: 16px; background: #020617; border-radius: 12px; }
      dt { color: #94a3b8; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
      dd { margin: 4px 0 12px; word-break: break-word; }
      label { display: block; margin: 18px 0 8px; font-weight: 600; }
      input { box-sizing: border-box; width: 100%; padding: 12px 14px; border-radius: 10px; border: 1px solid #475569; background: #020617; color: #e2e8f0; font-size: 16px; }
      button { margin-top: 18px; width: 100%; border: 0; border-radius: 10px; padding: 12px 14px; font-weight: 700; color: #020617; background: #38bdf8; cursor: pointer; }
      .error { color: #fecaca; background: #7f1d1d; border-radius: 10px; padding: 10px 12px; }
      .warning { color: #fde68a; }
    </style>
  </head>
  <body>
    <main>
      <h1>Connect DevSpace</h1>
      <p class="warning">Only approve this if you are intentionally connecting your own ChatGPT or MCP client to this local machine.</p>
      ${error}
      <dl>
        <dt>Client</dt><dd>${htmlEscape(params.clientName)}</dd>
        <dt>Scope</dt><dd>${htmlEscape(scopeText)}</dd>
        <dt>Resource</dt><dd>${htmlEscape(resourceText)}</dd>
      </dl>
      <form method="post">
${hiddenFields}
        <label for="owner_token">Owner password</label>
        <input id="owner_token" name="owner_token" type="password" autocomplete="current-password" autofocus required />
        <button type="submit">Authorize DevSpace</button>
      </form>
    </main>
  </body>
</html>`;
}

function requestedScopesAllowed(requested: string[], supported: string[]): boolean {
  return requested.every((scope) => supported.includes(scope));
}

export class SingleUserOAuthProvider implements OAuthServerProvider {
  readonly clientsStore: OAuthRegisteredClientsStore;
  private readonly codes = new Map<string, AuthorizationCodeRecord>();
  private readonly oauthStore: SqliteOAuthStore;
  private deviceStore: SqliteDeviceAuthorizationStore | undefined;
  private readonly resourceServerUrl: URL;

  constructor(
    private readonly config: OAuthConfig,
    resourceServerUrl: URL,
    stateDir: string,
  ) {
    this.resourceServerUrl = resourceUrlFromServerUrl(resourceServerUrl);
    this.oauthStore = new SqliteOAuthStore(stateDir);
    this.clientsStore = new SqliteOAuthClientsStore(this.oauthStore, config.allowedRedirectHosts);
  }

  private getDeviceStore(): SqliteDeviceAuthorizationStore {
    if (!this.deviceStore) {
      this.deviceStore = new SqliteDeviceAuthorizationStore(this.oauthStore.databaseHandle, this.config.devicePepper);
    }
    return this.deviceStore;
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    if (!params.resource || !checkResourceAllowed({ requestedResource: params.resource, configuredResource: this.resourceServerUrl })) {
      throw new InvalidRequestError("Invalid or missing OAuth resource");
    }
    if (!requestedScopesAllowed(params.scopes ?? [], this.config.scopes)) {
      throw new InvalidRequestError("Requested scope is not supported");
    }

    if (res.req.method !== "POST") {
      res.status(200).setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(
        formHtml({
          clientName: client.client_name ?? client.client_id,
          scopes: params.scopes ?? this.config.scopes,
          resource: params.resource,
          fields: authorizationFormFields(client, params),
        }),
      );
      return;
    }

    const subjectId = this.approvalSubject(client, params, res.req);
    if (!subjectId) {
      res.status(401).setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(
        formHtml({
          error: "The Owner password was not accepted.",
          clientName: client.client_name ?? client.client_id,
          scopes: params.scopes ?? this.config.scopes,
          resource: params.resource,
          fields: authorizationFormFields(client, params),
        }),
      );
      return;
    }

    const code = `code-${randomUUID()}`;
    this.codes.set(code, {
      clientId: client.client_id,
      subjectId,
      params,
      expiresAtMs: Date.now() + CODE_TTL_MS,
    });

    const redirectUrl = new URL(params.redirectUri);
    redirectUrl.searchParams.set("code", code);
    if (params.state !== undefined) redirectUrl.searchParams.set("state", params.state);
    res.redirect(302, redirectUrl.href);
  }

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const record = this.validCodeRecord(client, authorizationCode);
    return record.params.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const record = this.validCodeRecord(client, authorizationCode);
    if (redirectUri && redirectUri !== record.params.redirectUri) {
      throw new InvalidGrantError("redirect_uri does not match the authorization request");
    }
    if (resource && !checkResourceAllowed({ requestedResource: resource, configuredResource: this.resourceServerUrl })) {
      throw new InvalidGrantError("Invalid resource");
    }

    this.codes.delete(authorizationCode);
    return this.issueTokens(client.client_id, record.params.scopes ?? this.config.scopes, record.params.resource, undefined, record.subjectId ?? "owner");
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    const refreshTokenHash = hashToken(refreshToken);
    const record = this.oauthStore.getRefreshToken(refreshTokenHash);
    if (!record || record.clientId !== client.client_id || record.expiresAt < Math.floor(Date.now() / 1000)) {
      throw new InvalidGrantError("Invalid refresh token");
    }
    if (resource && !checkResourceAllowed({ requestedResource: resource, configuredResource: this.resourceServerUrl })) {
      throw new InvalidGrantError("Invalid resource");
    }

    const requestedScopes = scopes ?? record.scopes;
    if (!requestedScopes.every((scope) => record.scopes.includes(scope))) {
      throw new AccessDeniedError("Refresh token cannot grant requested scopes");
    }

    return this.issueTokens(
      client.client_id,
      requestedScopes,
      resource ?? (record.resource ? new URL(record.resource) : undefined),
      refreshTokenHash,
      record.subjectId ?? "owner",
    );
  }

  async createDeviceAuthorization(
    clientId: string,
    requestedScopes: string[],
    resource?: URL,
  ): Promise<DeviceAuthorizationCreated> {
    const client = await Promise.resolve(this.clientsStore.getClient(clientId));
    if (!client) throw new InvalidRequestError("Unknown client_id");
    const scopes = requestedScopes.length > 0 ? [...new Set(requestedScopes)] : [...this.config.scopes];
    if (!requestedScopes.every((scope) => this.config.scopes.includes(scope))) {
      throw new InvalidRequestError("Requested scope is not supported");
    }
    if (resource && !checkResourceAllowed({ requestedResource: resource, configuredResource: this.resourceServerUrl })) {
      throw new InvalidRequestError("Requested resource is not supported");
    }
    return this.getDeviceStore().create({
      clientId,
      resource: (resource ?? this.resourceServerUrl).href,
      scopes,
      expiresInSeconds: 600,
      intervalSeconds: 5,
    });
  }

  getDeviceAuthorization(userCode: string): DeviceAuthorizationPublicRecord | undefined {
    return this.getDeviceStore().getByUserCode(userCode);
  }

  approveDeviceAuthorization(userCode: string, ownerToken: string, subjectId?: string, proof?: string): boolean {
    const approvedSubject = (this.config.approvalMode ?? "owner_token") === "trusted_header"
      ? this.verifyTrustedDeviceApproval(userCode, subjectId, proof)
      : safeEquals(ownerToken, this.config.ownerToken) ? "owner" : undefined;
    if (!approvedSubject) return false;
    return this.getDeviceStore().approve(userCode, approvedSubject);
  }

  denyDeviceAuthorization(userCode: string, ownerToken: string, subjectId?: string, proof?: string): boolean {
    const authorized = (this.config.approvalMode ?? "owner_token") === "trusted_header"
      ? Boolean(this.verifyTrustedDeviceApproval(userCode, subjectId, proof))
      : safeEquals(ownerToken, this.config.ownerToken);
    if (!authorized) return false;
    return this.getDeviceStore().deny(userCode);
  }

  usesTrustedApproval(): boolean {
    return (this.config.approvalMode ?? "owner_token") === "trusted_header";
  }

  async exchangeDeviceCode(
    clientId: string,
    deviceCode: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const record = this.getDeviceStore().getByDeviceCode(deviceCode, clientId);
    if (!record) throw new InvalidGrantError("Invalid device authorization");
    const requestedResource = resource ?? new URL(record.resource);
    if (requestedResource.href !== record.resource || !checkResourceAllowed({ requestedResource, configuredResource: this.resourceServerUrl })) {
      throw new InvalidGrantError("Resource does not match the device authorization");
    }
    const result: DevicePollResult = this.getDeviceStore().poll(deviceCode, clientId);
    if (result.kind === "authorization_pending") {
      throw new InvalidGrantError("authorization_pending");
    }
    if (result.kind === "slow_down") {
      throw new InvalidGrantError(`slow_down:${result.intervalSeconds}`);
    }
    if (result.kind === "access_denied") throw new AccessDeniedError("Device authorization was denied");
    if (result.kind === "expired_token") throw new InvalidGrantError("expired_token");
    if (result.kind !== "approved") throw new InvalidGrantError("Invalid device authorization");
    return this.issueTokens(clientId, result.scopes, requestedResource, undefined, result.subjectId);
  }
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const record = this.oauthStore.getAccessToken(hashToken(token));
    if (!record || record.expiresAt < Math.floor(Date.now() / 1000)) {
      throw new InvalidTokenError("Invalid or expired access token");
    }

    return {
      token,
      clientId: record.clientId,
      scopes: record.scopes,
      expiresAt: record.expiresAt,
      resource: record.resource ? new URL(record.resource) : undefined,
      extra: {
        principalId: record.subjectId ?? "owner",
      },
    };
  }

  async revokeToken(_client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    const hashed = hashToken(request.token);
    this.oauthStore.deleteAccessToken(hashed);
    this.oauthStore.deleteRefreshToken(hashed);
  }

  cleanupDeviceAuthorizations(now?: number): number {
    return this.deviceStore?.cleanup(now) ?? 0;
  }

  close(): void {
    this.deviceStore?.close();
    this.oauthStore.close();
  }

  private approvalSubject(client: OAuthClientInformationFull, params: AuthorizationParams, req: Request): string | undefined {
    if ((this.config.approvalMode ?? "owner_token") === "owner_token") {
      const providedToken = String(req.body?.owner_token ?? "");
      return safeEquals(providedToken, this.config.ownerToken) ? "owner" : undefined;
    }
    const subjectId = req.header("x-devspace-identity")?.trim();
    const proof = req.header("x-devspace-identity-proof")?.trim();
    if (!subjectId || !proof || !this.config.approvalIdentitySecret) return undefined;
    const context = `${subjectId}|${client.client_id}|${params.redirectUri}|${params.resource?.href ?? ""}`;
    const expected = createHmac("sha256", this.config.approvalIdentitySecret).update(context).digest("base64url");
    return safeEquals(proof, expected) ? subjectId : undefined;
  }

  private verifyTrustedDeviceApproval(userCode: string, subjectId?: string, proof?: string): string | undefined {
    const normalizedSubject = subjectId?.trim();
    if (!normalizedSubject || !proof || !this.config.approvalIdentitySecret) return undefined;
    const context = `${normalizedSubject}|${userCode}`;
    const expected = createHmac("sha256", this.config.approvalIdentitySecret).update(context).digest("base64url");
    return safeEquals(proof, expected) ? normalizedSubject : undefined;
  }

  private validCodeRecord(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): AuthorizationCodeRecord {
    const record = this.codes.get(authorizationCode);
    if (!record || record.clientId !== client.client_id || record.expiresAtMs < Date.now()) {
      throw new InvalidGrantError("Invalid authorization code");
    }
    return record;
  }

  private issueTokens(
    clientId: string,
    scopes: string[],
    resource?: URL,
    consumedRefreshTokenHash?: string,
    subjectId = "owner",
  ): OAuthTokens {
    const now = Math.floor(Date.now() / 1000);
    const accessToken = randomToken();
    const refreshToken = randomToken();
    const accessExpiresAt = now + this.config.accessTokenTtlSeconds;
    const refreshExpiresAt = now + this.config.refreshTokenTtlSeconds;

    const saved = this.oauthStore.saveTokenPair(
      {
        accessTokenHash: hashToken(accessToken),
        accessToken: {
          clientId,
          scopes,
          expiresAt: accessExpiresAt,
          resource: resource?.href,
          subjectId,
        },
        refreshTokenHash: hashToken(refreshToken),
        refreshToken: {
          clientId,
          scopes,
          expiresAt: refreshExpiresAt,
          resource: resource?.href,
          subjectId,
        },
      },
      consumedRefreshTokenHash,
    );
    if (!saved) {
      throw new InvalidGrantError("Invalid refresh token");
    }

    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: this.config.accessTokenTtlSeconds,
      refresh_token: refreshToken,
      scope: scopes.join(" "),
    };
  }
}

function authorizationFormFields(
  client: OAuthClientInformationFull,
  params: AuthorizationParams,
): Record<string, string | undefined> {
  return {
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: params.redirectUri,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
    scope: params.scopes?.join(" "),
    state: params.state,
    resource: params.resource?.href,
  };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}
