import express, { type Express, type Request, type Response } from "express";
import type { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { SingleUserOAuthProvider } from "./oauth-provider.js";

const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

type DeviceRateLimitBucket = { windowStartedAt: number; count: number };

function createDeviceRateLimiter(maxRequests: number, windowMs: number, description: string) {
  const buckets = new Map<string, DeviceRateLimitBucket>();
  return (req: Request, res: Response, next: () => void): void => {
    const now = Date.now();
    if (buckets.size > 10_000) {
      for (const [staleKey, staleBucket] of buckets) {
        if (now - staleBucket.windowStartedAt >= windowMs) buckets.delete(staleKey);
      }
    }
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const clientId = formValue(req, "client_id") || "anonymous";
    const key = `${ip}|${clientId}`;
    const current = buckets.get(key);
    const bucket = !current || now - current.windowStartedAt >= windowMs
      ? { windowStartedAt: now, count: 0 }
      : current;
    if (!current || bucket !== current) buckets.set(key, bucket);
    if (bucket.count >= maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.windowStartedAt + windowMs - now) / 1_000));
      res.setHeader("Retry-After", String(retryAfterSeconds));
      sendOAuthError(res, "slow_down", `${description} rate limit exceeded`, 429);
      return;
    }
    bucket.count += 1;
    next();
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formValue(req: Request, name: string): string {
  const value = req.body?.[name];
  return typeof value === "string" ? value.trim() : "";
}

function sendOAuthError(res: Response, error: string, description: string, status = 400): void {
  res.status(status).json({ error, error_description: description });
}

function devicePage(params: {
  userCode: string;
  status?: string;
  clientName?: string;
  resource?: string;
  scopes?: string[];
}): string {
  const status = params.status ? `<p class="status">${escapeHtml(params.status)}</p>` : "";
  const details = params.clientName
    ? `<dl><dt>Aplicação</dt><dd>${escapeHtml(params.clientName)}</dd><dt>Resource</dt><dd>${escapeHtml(params.resource ?? "DevSpace MCP")}</dd><dt>Scopes</dt><dd>${escapeHtml((params.scopes ?? []).join(" "))}</dd></dl>`
    : "";
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Autorizar DevSpace CLI</title><style>body{font-family:system-ui,sans-serif;max-width:560px;margin:48px auto;padding:0 20px;color:#172033}main{border:1px solid #d5d9e2;border-radius:12px;padding:28px}input,button{font:inherit;padding:10px;margin-top:6px;width:100%;box-sizing:border-box}button{cursor:pointer;background:#172033;color:white;border:0;border-radius:6px}.secondary{background:white;color:#172033;border:1px solid #aab2c0}.status{background:#eef7ee;padding:10px;border-radius:6px}dt{font-weight:700;margin-top:10px}dd{margin:4px 0;word-break:break-word}</style></head><body><main><h1>Autorizar DevSpace CLI</h1><p>Informe o código exibido no terminal para revisar a solicitação.</p>${status}<form method="get" action="/oauth/device"><label for="user_code">Código do dispositivo</label><input id="user_code" name="user_code" value="${escapeHtml(params.userCode)}" autocomplete="one-time-code" required><button type="submit">Continuar</button></form>${details}${params.clientName ? `<form method="post" action="/oauth/device/approve"><input type="hidden" name="user_code" value="${escapeHtml(params.userCode)}"><label for="owner_token">Owner token</label><input id="owner_token" name="owner_token" type="password" autocomplete="current-password" required><button name="decision" value="approve" type="submit">Autorizar</button><button class="secondary" name="decision" value="deny" type="submit">Negar</button></form>` : ""}</main></body></html>`;
}

function parseOptionalUrl(value: string): URL | undefined {
  if (!value) return undefined;
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function tokenResponse(res: Response, tokens: OAuthTokens): void {
  res.status(200).json(tokens);
}

export function registerOAuthDeviceRoutes(
  app: Express,
  provider: SingleUserOAuthProvider,
  issuerUrl: URL,
): void {
  app.use(express.urlencoded({ extended: false, limit: "16kb" }));

  const deviceAuthorizationRateLimiter = createDeviceRateLimiter(10, 60_000, "Device authorization");
  const devicePollingRateLimiter = createDeviceRateLimiter(30, 60_000, "Device token polling");
  const deviceApprovalRateLimiter = createDeviceRateLimiter(20, 60_000, "Device approval");

  app.post("/oauth/device/authorize", async (req, res) => {
    deviceAuthorizationRateLimiter(req, res, () => undefined);
    if (res.headersSent) return;
    const clientId = formValue(req, "client_id");
    const scopes = formValue(req, "scope").split(/\s+/).filter(Boolean);
    const resourceValue = formValue(req, "resource");
    const resource = parseOptionalUrl(resourceValue);
    if (!clientId || (resourceValue && !resource)) {
      sendOAuthError(res, "invalid_request", "client_id and resource must be valid");
      return;
    }
    try {
      const created = await provider.createDeviceAuthorization(clientId, scopes, resource);
      const verificationUri = new URL("/oauth/device", issuerUrl);
      res.status(200).json({
        device_code: created.deviceCode,
        user_code: created.userCode,
        verification_uri: verificationUri.href,
        verification_uri_complete: `${verificationUri.href}?user_code=${encodeURIComponent(created.userCode)}`,
        expires_in: created.expiresInSeconds,
        interval: created.intervalSeconds,
      });
    } catch (error) {
      sendOAuthError(res, "invalid_request", error instanceof Error ? error.message : "Invalid device authorization request");
    }
  });

  app.get("/oauth/device", (req, res) => {
    const userCode = typeof req.query.user_code === "string" ? req.query.user_code : "";
    const record = provider.getDeviceAuthorization(userCode);
    if (!record) {
      res.status(400).type("html").send(devicePage({ userCode, status: "Código inválido ou expirado." }));
      return;
    }
    if (record.status !== "pending") {
      res.status(400).type("html").send(devicePage({ userCode, status: `Solicitação já está ${record.status}.` }));
      return;
    }
    res.status(200).type("html").send(devicePage({
      userCode,
      clientName: record.clientId,
      resource: record.resource,
      scopes: record.scopes,
    }));
  });

  app.post("/oauth/device/approve", (req, res) => {
    deviceApprovalRateLimiter(req, res, () => undefined);
    if (res.headersSent) return;
    const userCode = formValue(req, "user_code");
    const ownerToken = formValue(req, "owner_token");
    const decision = formValue(req, "decision");
    const approved = decision !== "deny";
    const changed = approved
      ? provider.approveDeviceAuthorization(userCode, ownerToken)
      : provider.denyDeviceAuthorization(userCode, ownerToken);
    if (!changed) {
      res.status(403).type("html").send(devicePage({ userCode, status: "A aprovação foi recusada ou expirou." }));
      return;
    }
    res.redirect(303, `/oauth/device?user_code=${encodeURIComponent(userCode)}&status=${encodeURIComponent(approved ? "Autorização registrada. Retorne ao terminal." : "Solicitação negada.")}`);
  });

  app.post("/token", async (req, res, next) => {
    devicePollingRateLimiter(req, res, () => undefined);
    if (res.headersSent) return;
    if (formValue(req, "grant_type") !== DEVICE_GRANT) {
      next();
      return;
    }
    const clientId = formValue(req, "client_id");
    const deviceCode = formValue(req, "device_code");
    const resource = parseOptionalUrl(formValue(req, "resource"));
    if (!clientId || !deviceCode) {
      sendOAuthError(res, "invalid_request", "client_id and device_code are required");
      return;
    }
    try {
      const tokens = await provider.exchangeDeviceCode(clientId, deviceCode, resource);
      tokenResponse(res, tokens);
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid_grant";
      if (message === "authorization_pending") {
        sendOAuthError(res, "authorization_pending", "The user has not approved the request yet");
      } else if (message.startsWith("slow_down:")) {
        res.setHeader("Retry-After", message.slice("slow_down:".length));
        sendOAuthError(res, "slow_down", "Polling too frequently");
      } else if (message === "expired_token") {
        sendOAuthError(res, "expired_token", "The device code expired");
      } else if (message.includes("denied")) {
        sendOAuthError(res, "access_denied", "The user denied the request");
      } else {
        sendOAuthError(res, "invalid_grant", "The device authorization is invalid");
      }
    }
  });
}

export { DEVICE_GRANT };
