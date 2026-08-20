import express, { type Express, type Request, type Response } from "express";
import type { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { SingleUserOAuthProvider } from "./oauth-provider.js";
import type { RuntimeMetrics } from "./metrics.js";

const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

type DeviceRateLimitBucket = { windowStartedAt: number; count: number };

function createDeviceRateLimiter(maxRequests: number, windowMs: number, description: string, metrics?: RuntimeMetrics) {
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
      metrics?.recordOAuthDeviceEvent("rate_limited");
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
  isSuccess?: boolean;
  clientName?: string;
  resource?: string;
  scopes?: string[];
  trustedApproval?: boolean;
}): string {
  const statusHtml = params.status
    ? `<div class="status ${params.isSuccess ? "status-success" : "status-notice"}">${escapeHtml(params.status)}</div>`
    : "";

  const successCard = params.isSuccess
    ? `<div class="success-box">
        <div class="success-icon">✓</div>
        <h2>Autorização Concluída</h2>
        <p>A solicitação para o dispositivo foi autorizada com sucesso.</p>
        <p class="subtle">Você já pode fechar esta aba do navegador e retornar ao terminal.</p>
      </div>`
    : "";

  const details = params.clientName && !params.isSuccess
    ? `<dl><dt>Aplicação</dt><dd>${escapeHtml(params.clientName)}</dd><dt>Resource</dt><dd>${escapeHtml(params.resource ?? "DevSpace MCP")}</dd><dt>Scopes</dt><dd>${escapeHtml((params.scopes ?? []).join(" "))}</dd></dl>`
    : "";

  const formSection = !params.isSuccess && !params.clientName
    ? `<form method="get" action="/oauth/device">
        <label for="user_code">Código do dispositivo</label>
        <input id="user_code" name="user_code" value="${escapeHtml(params.userCode)}" autocomplete="one-time-code" placeholder="Ex: ABCD-1234" required autofocus>
        <button type="submit">Continuar</button>
      </form>`
    : "";

  const approvalSection = params.clientName && !params.isSuccess
    ? (params.trustedApproval
        ? `<p>Esta instância exige aprovação por identidade autenticada no gateway confiável.</p>`
        : `<form method="post" action="/oauth/device/approve">
            <input type="hidden" name="user_code" value="${escapeHtml(params.userCode)}">
            <label for="owner_token">Owner token</label>
            <input id="owner_token" name="owner_token" type="password" autocomplete="current-password" placeholder="Digite a chave ownerToken" required autofocus>
            <button name="decision" value="approve" type="submit">Autorizar</button>
            <button class="secondary" name="decision" value="deny" type="submit">Negar</button>
          </form>`)
    : "";

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Autorizar DevSpace CLI</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 520px; margin: 40px auto; padding: 0 20px; color: #0f172a; background: #f8fafc; }
    main { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 32px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
    h1 { font-size: 22px; font-weight: 700; margin: 0 0 8px; color: #0f172a; }
    p { color: #475569; font-size: 14px; line-height: 1.5; margin: 0 0 20px; }
    .status { padding: 12px 16px; border-radius: 8px; font-size: 14px; margin-bottom: 20px; font-weight: 500; }
    .status-success { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }
    .status-notice { background: #f8fafc; color: #334155; border: 1px solid #e2e8f0; }
    .success-box { text-align: center; padding: 16px 0; }
    .success-icon { width: 48px; height: 48px; background: #22c55e; color: white; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 24px; font-weight: bold; margin: 0 auto 16px; }
    .success-box h2 { font-size: 18px; font-weight: 600; color: #0f172a; margin: 0 0 8px; }
    .success-box p { color: #64748b; font-size: 14px; margin: 4px 0; }
    .subtle { color: #94a3b8 !important; font-size: 13px !important; margin-top: 12px !important; }
    label { display: block; font-size: 13px; font-weight: 600; color: #334155; margin-bottom: 6px; }
    input { font: inherit; font-size: 15px; padding: 10px 14px; width: 100%; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 8px; margin-bottom: 16px; transition: border-color 0.2s; }
    input:focus { outline: none; border-color: #2563eb; }
    button { font: inherit; font-size: 14px; font-weight: 600; padding: 11px 16px; width: 100%; box-sizing: border-box; cursor: pointer; background: #0f172a; color: white; border: 0; border-radius: 8px; transition: background 0.2s; }
    button:hover { background: #1e293b; }
    .secondary { background: white; color: #475569; border: 1px solid #cbd5e1; margin-top: 8px; }
    .secondary:hover { background: #f1f5f9; }
    dl { background: #f8fafc; border: 1px solid #f1f5f9; border-radius: 8px; padding: 16px; margin: 0 0 20px; font-size: 13px; }
    dt { font-weight: 600; color: #64748b; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; margin-top: 10px; }
    dt:first-child { margin-top: 0; }
    dd { margin: 2px 0 0; color: #0f172a; word-break: break-word; font-family: ui-monospace, monospace; }
  </style>
</head>
<body>
  <main>
    ${params.isSuccess ? "" : "<h1>Autorizar DevSpace CLI</h1>"}
    ${params.isSuccess || params.clientName ? "" : "<p>Informe o código exibido no terminal para revisar a solicitação.</p>"}
    ${statusHtml}
    ${successCard}
    ${details}
    ${formSection}
    ${approvalSection}
  </main>
</body>
</html>`;
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
  metrics?: RuntimeMetrics,
): void {
  app.use(express.urlencoded({ extended: false, limit: "16kb" }));

  const deviceAuthorizationRateLimiter = createDeviceRateLimiter(10, 60_000, "Device authorization", metrics);
  const devicePollingRateLimiter = createDeviceRateLimiter(30, 60_000, "Device token polling", metrics);
  const deviceApprovalRateLimiter = createDeviceRateLimiter(20, 60_000, "Device approval", metrics);

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
      metrics?.recordOAuthDeviceEvent("requested");
      res.status(200).json({
        device_code: created.deviceCode,
        user_code: created.userCode,
        verification_uri: verificationUri.href,
        verification_uri_complete: `${verificationUri.href}?user_code=${encodeURIComponent(created.userCode)}`,
        expires_in: created.expiresInSeconds,
        interval: created.intervalSeconds,
      });
    } catch (error) {
      metrics?.recordOAuthDeviceEvent("rejected");
      sendOAuthError(res, "invalid_request", error instanceof Error ? error.message : "Invalid device authorization request");
    }
  });

  app.get("/oauth/device", (req, res) => {
    const userCode = typeof req.query.user_code === "string" ? req.query.user_code : "";
    const statusQuery = typeof req.query.status === "string" ? req.query.status : "";

    if (statusQuery && !userCode) {
      res.status(200).type("html").send(devicePage({ userCode: "", status: statusQuery, isSuccess: statusQuery.includes("Autorização registrada") }));
      return;
    }

    if (!userCode) {
      res.status(200).type("html").send(devicePage({ userCode: "" }));
      return;
    }

    const record = provider.getDeviceAuthorization(userCode);
    if (!record) {
      if (statusQuery) {
        res.status(200).type("html").send(devicePage({ userCode, status: statusQuery, isSuccess: statusQuery.includes("Autorização registrada") }));
        return;
      }
      res.status(400).type("html").send(devicePage({ userCode, status: "Código inválido ou expirado." }));
      return;
    }

    if (record.status === "approved" || record.status === "consumed") {
      res.status(200).type("html").send(devicePage({
        userCode,
        isSuccess: true,
        status: "Esta autorização já foi concluída com sucesso.",
      }));
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
      trustedApproval: provider.usesTrustedApproval(),
    }));
  });

  app.post("/oauth/device/approve", (req, res) => {
    deviceApprovalRateLimiter(req, res, () => undefined);
    if (res.headersSent) return;
    const userCode = formValue(req, "user_code");
    const ownerToken = formValue(req, "owner_token");
    const subjectId = req.header("x-devspace-identity")?.trim();
    const proof = req.header("x-devspace-identity-proof")?.trim();
    const decision = formValue(req, "decision");
    const approved = decision !== "deny";
    const changed = approved
      ? provider.approveDeviceAuthorization(userCode, ownerToken, subjectId, proof)
      : provider.denyDeviceAuthorization(userCode, ownerToken, subjectId, proof);
    if (!changed) {
      metrics?.recordOAuthDeviceEvent("rejected");
      res.status(403).type("html").send(devicePage({ userCode, status: "A aprovação foi recusada ou expirou." }));
      return;
    }
    metrics?.recordOAuthDeviceEvent(approved ? "approved" : "denied");
    try {
      const tokens = await provider.exchangeDeviceCode(clientId, deviceCode, resource);
      metrics?.recordOAuthDeviceEvent("consumed");
      tokenResponse(res, tokens);
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid_grant";
      if (message === "authorization_pending") {
        metrics?.recordOAuthDeviceEvent("pending");
        sendOAuthError(res, "authorization_pending", "The user has not approved the request yet");
      } else if (message.startsWith("slow_down:")) {
        metrics?.recordOAuthDeviceEvent("slow_down");
        res.setHeader("Retry-After", message.slice("slow_down:".length));
        sendOAuthError(res, "slow_down", "Polling too frequently");
      } else if (message === "expired_token") {
        metrics?.recordOAuthDeviceEvent("expired");
        sendOAuthError(res, "expired_token", "The device code expired");
      } else if (message.includes("denied")) {
        metrics?.recordOAuthDeviceEvent("denied");
        sendOAuthError(res, "access_denied", "The user denied the request");
      } else {
        metrics?.recordOAuthDeviceEvent("rejected");
        sendOAuthError(res, "invalid_grant", "The device authorization is invalid");
      }
    }
  });
}

export { DEVICE_GRANT };
