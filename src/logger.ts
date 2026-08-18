import type { Request } from "express";
import { createHash } from "node:crypto";

export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";
export type LogFormat = "json" | "pretty";

export interface LoggingConfig {
  level: LogLevel;
  format: LogFormat;
  requests: boolean;
  assets: boolean;
  toolCalls: boolean;
  shellCommands: boolean;
  trustProxy: boolean;
}

type LogFields = Record<string, unknown>;

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

export function shouldLog(config: LoggingConfig, level: Exclude<LogLevel, "silent">): boolean {
  return LEVEL_WEIGHT[config.level] >= LEVEL_WEIGHT[level];
}

export function logEvent(
  config: LoggingConfig,
  level: Exclude<LogLevel, "silent">,
  event: string,
  fields: LogFields = {},
): void {
  if (!shouldLog(config, level)) return;

  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...sanitizeLogFields(fields),

  };

  const line = config.format === "pretty" ? formatPretty(entry) : JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export function sanitizeLogFields(fields: LogFields): LogFields {
  const safe: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || isSensitiveLogKey(key)) continue;

    if (HASHED_LOG_KEYS.has(key)) {
      if (typeof value === "string") safe[`${key}Hash`] = stableLogHash(value);
      continue;
    }

    if (key === "sessionIdPrefix") {
      if (typeof value === "string") safe.sessionIdHash = stableLogHash(value);
      continue;
    }

    if (SAFE_STRING_KEYS.has(key)) {
      if (typeof value === "string") safe[key] = value.slice(0, 128);
      continue;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      safe[key] = value;
    }
  }
  return safe;
}

export function stableLogHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

const HASHED_LOG_KEYS = new Set([
  "ip",
  "host",
  "userAgent",
  "origin",
  "referer",
  "path",
  "root",
  "workingDirectory",
  "workspaceId",
  "resource",
  "downloadUrlHostname",
]);

const SAFE_STRING_KEYS = new Set([
  "tool",
  "reason",
  "outcome",
  "state",
  "errorCode",
  "errorCategory",
  "requiredScope",
  "fileReferenceShape",
  "method",
  "requestId",
  "transport",
]);

function isSensitiveLogKey(key: string): boolean {
  return /authorization|token|secret|cookie|password|payload|stdout|stderr|command|preview|content|error$|errorMessage|stack|verifier|challenge|chars|edits/i.test(key);
}

export function requestIp(req: Request, trustProxy: boolean): string | undefined {

  if (trustProxy) {
    const cfConnectingIp = firstHeaderValue(req.header("cf-connecting-ip"));
    if (cfConnectingIp) return cfConnectingIp;

    const forwardedFor = firstHeaderValue(req.header("x-forwarded-for"));
    if (forwardedFor) return forwardedFor;
  }

  return req.ip ?? req.socket.remoteAddress;
}

export function requestPath(req: Request): string {
  return req.path || req.url.split("?")[0] || req.url;
}

export function sessionIdPrefix(sessionId: string | undefined): string | undefined {
  return sessionId ? sessionId.slice(0, 8) : undefined;
}


function firstHeaderValue(value: string | undefined): string | undefined {
  return value?.split(",")[0]?.trim() || undefined;
}

function formatPretty(entry: LogFields): string {
  const ts = String(entry.ts);
  const level = String(entry.level).toUpperCase();
  const event = String(entry.event);
  const rest = Object.entries(entry)
    .filter(([key, value]) => !["ts", "level", "event"].includes(key) && value !== undefined)
    .map(([key, value]) => `${key}=${formatPrettyValue(value)}`)
    .join(" ");

  return rest ? `${ts} ${level} ${event} ${rest}` : `${ts} ${level} ${event}`;
}

function formatPrettyValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  return JSON.stringify(value);
}
