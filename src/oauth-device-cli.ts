import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { platform } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { loadDevspaceFiles, writeDevspaceAuth } from "./user-config.js";

const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const DEFAULT_SERVER = "http://127.0.0.1:7676";
const DEFAULT_SCOPE = "devspace";
const DEFAULT_POLL_TIMEOUT_SECONDS = 10 * 60;
const MAX_POLL_TIMEOUT_SECONDS = 24 * 60 * 60;

type OAuthMetadata = {
  issuer: string;
  authorization_endpoint: string;
  device_authorization_endpoint?: string;
  token_endpoint: string;
  registration_endpoint?: string;
};

type DeviceAuthorizationResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval?: number;
};

type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
};

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function serverUrl(args: string[]): URL {
  const files = loadDevspaceFiles();
  const value = optionValue(args, "--server") ?? process.env.DEVSPACE_PUBLIC_BASE_URL ?? files.config.publicBaseUrl ?? DEFAULT_SERVER;
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("--server must be an HTTP(S) URL");
  return url;
}

function resourceUrl(args: string[], server: URL): URL {
  const value = optionValue(args, "--resource") ?? new URL("/mcp", server).href;
  return new URL(value);
}

function scopes(args: string[]): string[] {
  const value = optionValue(args, "--scope") ?? DEFAULT_SCOPE;
  return [...new Set(value.split(/\s+/).filter(Boolean))];
}

function pollTimeoutSeconds(args: string[]): number {
  const raw = optionValue(args, "--poll-timeout-seconds")
    ?? process.env.DEVSPACE_OAUTH_POLL_TIMEOUT_SECONDS
    ?? String(DEFAULT_POLL_TIMEOUT_SECONDS);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_POLL_TIMEOUT_SECONDS) {
    throw new Error(`--poll-timeout-seconds must be an integer between 1 and ${MAX_POLL_TIMEOUT_SECONDS}`);
  }
  return value;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    const error = typeof body === "object" && body !== null && "error_description" in body
      ? String((body as { error_description: unknown }).error_description)
      : `HTTP ${response.status}`;
    throw new Error(error);
  }
  return body as T;
}

async function discoverMetadata(server: URL): Promise<OAuthMetadata> {
  const metadataUrl = new URL("/.well-known/oauth-authorization-server", server);
  const metadata = await fetchJson<Partial<OAuthMetadata>>(metadataUrl.href);
  if (!metadata.issuer || !metadata.authorization_endpoint || !metadata.token_endpoint) {
    throw new Error("OAuth server does not advertise a complete device authorization flow");
  }
  return metadata as OAuthMetadata;
}

async function registerClient(metadata: OAuthMetadata, requestedScopes: string[], redirectUri: string, grantType: "device_code" | "authorization_code"): Promise<string> {
  if (!metadata.registration_endpoint) return "devspace-cli";
  const body = await fetchJson<{ client_id: string }>(metadata.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "DevSpace CLI",
      redirect_uris: [redirectUri],
      grant_types: grantType === "device_code" ? ["urn:ietf:params:oauth:grant-type:device_code", "refresh_token"] : ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: requestedScopes.join(" "),
    }),
  });
  if (!body.client_id) throw new Error("OAuth registration did not return client_id");
  return body.client_id;
}

function openBrowser(url: string): void {
  if (process.env.DEVSPACE_NO_BROWSER === "1") return;
  const command = platform() === "win32" ? "cmd.exe" : platform() === "darwin" ? "open" : "xdg-open";
  const args = platform() === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
}

function saveToken(server: URL, resource: URL, clientId: string, scopes: string[], token: TokenResponse): string {
  const files = loadDevspaceFiles();
  const auth = {
    ...files.auth,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    tokenType: token.token_type,
    server: server.href,
    resource: resource.href,
    clientId,
    scopes,
    expiresAt: Math.floor(Date.now() / 1000) + token.expires_in,
  };
  const path = writeDevspaceAuth(auth);
  return path;
}

async function loginDevice(args: string[]): Promise<void> {
  const server = serverUrl(args);
  const resource = resourceUrl(args, server);
  const requestedScopes = scopes(args);
  const metadata = await discoverMetadata(server);
  if (!metadata.device_authorization_endpoint) throw new Error("OAuth server does not advertise device authorization");
  const clientId = await registerClient(metadata, requestedScopes, "http://127.0.0.1/callback", "device_code");
  const body = new URLSearchParams({
    client_id: clientId,
    scope: requestedScopes.join(" "),
    resource: resource.href,
  });
  const device = await fetchJson<DeviceAuthorizationResponse>(metadata.device_authorization_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  console.log(`Abra: ${device.verification_uri}`);
  console.log(`Digite o código: ${device.user_code}`);

  // Auto-approve when running against a local server or configured publicBaseUrl with a known ownerToken
  const files = loadDevspaceFiles();
  const configuredHost = files.config.publicBaseUrl ? new URL(files.config.publicBaseUrl).hostname : undefined;
  const isLocalOrConfigured = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(server.hostname) || server.hostname === configuredHost;
  const ownerToken = files.auth.ownerToken;
  let autoApproved = false;
  if (isLocalOrConfigured && ownerToken && !hasFlag(args, "--no-auto-approve")) {
    try {
      const approveUrl = new URL("/oauth/device/approve", server);
      const approveBody = new URLSearchParams({
        user_code: device.user_code,
        decision: "approve",
        owner_token: ownerToken,
      });
      const approveRes = await fetch(approveUrl.href, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: approveBody,
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
      autoApproved = approveRes.status === 303 || approveRes.ok;
      if (autoApproved) {
        console.log("Aprovação automática concluída (servidor local).");
      }
    } catch {
      // Auto-approval failed silently; fall back to manual browser flow
    }
  }

  if (!autoApproved && device.verification_uri_complete && !hasFlag(args, "--no-browser")) {
    openBrowser(device.verification_uri_complete);
  }

  const controller = new AbortController();
  const cancel = () => controller.abort();
  const cancelFromInput = (chunk: Buffer | string) => {
    if (String(chunk).includes("\u0003")) cancel();
  };
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  process.stdin.on("data", cancelFromInput);
  try {
    const deadline = Date.now() + Math.min(pollTimeoutSeconds(args) * 1000, device.expires_in * 1000);
    let intervalSeconds = Math.max(5, device.interval ?? 5);
    while (Date.now() < deadline) {
      try {
        await delay(intervalSeconds * 1000, undefined, { signal: controller.signal });
      } catch (error) {
        if (controller.signal.aborted) throw new Error("Device authorization cancelled", { cause: error });
        throw error;
      }
      const form = new URLSearchParams({ grant_type: DEVICE_GRANT, device_code: device.device_code, client_id: clientId, resource: resource.href });
      const response = await fetch(metadata.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
      const text = await response.text();
      let payload: (TokenResponse & { error?: string; error_description?: string }) | undefined;
      try { payload = JSON.parse(text) as typeof payload; } catch { payload = undefined; }
      if (response.ok && payload?.access_token) {
        const path = saveToken(server, resource, clientId, requestedScopes, payload);
        console.log(`Login concluído. Credencial salva em ${path}`);
        return;
      }
      const error = payload?.error;
      if (error === "authorization_pending") { process.stdout.write("."); continue; }
      if (error === "slow_down") { intervalSeconds += 5; process.stdout.write("."); continue; }
      if (error === "access_denied" || error === "expired_token") throw new Error(payload?.error_description ?? error);
      throw new Error(payload?.error_description ?? `Device token request failed with HTTP ${response.status}`);
    }
    throw new Error("Device authorization timed out");
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
    process.stdin.removeListener("data", cancelFromInput);
    process.stdin.pause();
    if (!process.stdin.isTTY) {
      process.stdin.removeAllListeners("data");
      process.stdin.removeAllListeners("readable");
      process.stdin.destroy();
      (process.stdin as NodeJS.ReadStream & { unref?: () => void }).unref?.();
    }
  }
}


async function loginPkce(args: string[]): Promise<void> {
  const server = serverUrl(args);
  const resource = resourceUrl(args, server);
  const requestedScopes = scopes(args);
  const metadata = await discoverMetadata(server);
  let callbackResolve: (value: { code: string; state: string }) => void = () => undefined;
  let callbackReject: (error: Error) => void = () => undefined;
  const callback = new Promise<{ code: string; state: string }>((resolve, reject) => { callbackResolve = resolve; callbackReject = reject; });
  const callbackServer = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    if (url.pathname !== "/callback") { response.writeHead(404); response.end(); return; }
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    response.writeHead(code ? 200 : 400, { "content-type": "text/html; charset=utf-8" });
    response.end(code ? "Authorization received. You may close this window." : "Authorization failed.");
    if (code && state) callbackResolve({ code, state });
    else callbackReject(new Error("OAuth callback did not contain code/state"));
  });
  await new Promise<void>((resolve, reject) => { callbackServer.once("error", reject); callbackServer.listen(0, "127.0.0.1", () => resolve()); });
  try {
    const address = callbackServer.address();
    if (!address || typeof address === "string") throw new Error("Unable to allocate OAuth callback port");
    const redirectUri = `http://127.0.0.1:${address.port}/callback`;
    const clientId = await registerClient(metadata, requestedScopes, redirectUri, "authorization_code");
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const state = randomUUID();
    const authorization = new URL(metadata.authorization_endpoint);
    authorization.search = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: "S256", scope: requestedScopes.join(" "), resource: resource.href, state }).toString();
    console.log(`Abra: ${authorization.href}`);
    if (!hasFlag(args, "--no-browser")) openBrowser(authorization.href);
    const result = await Promise.race([callback, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("PKCE authorization timed out")), pollTimeoutSeconds(args) * 1000))]);
    if (result.state !== state) throw new Error("OAuth state mismatch");
    const token = await fetchJson<TokenResponse>(metadata.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code: result.code, client_id: clientId, redirect_uri: redirectUri, code_verifier: verifier, resource: resource.href }) });
    const path = saveToken(server, resource, clientId, requestedScopes, token);
    console.log(`Login PKCE concluído. Credencial salva em ${path}`);
  } finally {
    await new Promise<void>((resolve) => callbackServer.close(() => resolve()));
  }
}

function authStatus(): void {
  const files = loadDevspaceFiles();
  const auth = files.auth;
  if (!auth.accessToken || !auth.server) { console.log("Nenhuma sessão OAuth da CLI está configurada."); return; }
  const expired = typeof auth.expiresAt === "number" && auth.expiresAt <= Math.floor(Date.now() / 1000);
  console.log(JSON.stringify({ server: auth.server, resource: auth.resource, clientId: auth.clientId, scopes: auth.scopes, expiresAt: auth.expiresAt, expired }, null, 2));
}

function authLogout(): void {
  const files = loadDevspaceFiles();
  const next = { ...files.auth } as Record<string, unknown>;
  for (const key of ["accessToken", "refreshToken", "tokenType", "server", "resource", "clientId", "scopes", "expiresAt"]) delete next[key];
  const path = writeDevspaceAuth(next);
  console.log(`Sessão OAuth removida de ${path}`);
}

export async function runAuthCommand(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  if (subcommand === "login" && hasFlag(rest, "--pkce")) { await loginPkce(rest); return; }
  if (subcommand === "login") { await loginDevice(rest); return; }
  if (subcommand === "status") { authStatus(); return; }
  if (subcommand === "logout") { authLogout(); return; }
  throw new Error("Uso: devspace auth login [--device|--pkce] [--server URL] [--scope scope] [--resource URL] [--poll-timeout-seconds N] | status | logout");
}
