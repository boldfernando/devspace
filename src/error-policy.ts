export type ErrorCategory =
  | "authentication"
  | "authorization"
  | "validation"
  | "not_found"
  | "conflict"
  | "rate_limit"
  | "resource"
  | "filesystem"
  | "process"
  | "timeout"
  | "dependency"
  | "internal";

export interface SafeErrorDescriptor {
  code: string;
  category: ErrorCategory;
  retryable: boolean;
  userMessage: string;
}

type ErrorWithCode = {
  code?: unknown;
  name?: unknown;
  message?: unknown;
};

const SAFE_ERROR_CODES = new Map<string, SafeErrorDescriptor>([
  ["PROCESS_START_FAILED", {
    code: "PROCESS_START_FAILED",
    category: "process",
    retryable: false,
    userMessage: "The process could not be started.",
  }],
  ["PROCESS_INPUT_SEQUENCE_REPLAY", {
    code: "PROCESS_INPUT_SEQUENCE_REPLAY",
    category: "conflict",
    retryable: false,
    userMessage: "This input sequence was already accepted.",
  }],
  ["PROCESS_INPUT_SEQUENCE_GAP", {
    code: "PROCESS_INPUT_SEQUENCE_GAP",
    category: "conflict",
    retryable: false,
    userMessage: "The input sequence is out of order.",
  }],
]);

export function classifyError(error: unknown): SafeErrorDescriptor {
  const value = asErrorWithCode(error);
  const explicitCode = typeof value.code === "string" ? value.code : undefined;
  const textValue = `${String(value.name ?? "")} ${String(value.message ?? error)}`;
  const prefixedCode = /^([A-Z][A-Z0-9_]{2,})\s*:/.exec(textValue.trimStart())?.[1];
  const explicit = [explicitCode, prefixedCode]
    .map((code) => (code ? SAFE_ERROR_CODES.get(code) : undefined))
    .find((descriptor): descriptor is SafeErrorDescriptor => descriptor !== undefined);
  if (explicit) return explicit;

  const text = textValue.toLowerCase();
  if (/unauthorized|invalid bearer|invalid token|authentication|oauth/.test(text)) {
    return descriptor("AUTHENTICATION_FAILED", "authentication", false, "Authentication failed.");
  }
  if (/forbidden|insufficient scope|not allowed|authorization/.test(text)) {
    return descriptor("AUTHORIZATION_DENIED", "authorization", false, "The operation is not authorized.");
  }
  if (/rate.?limit|too many requests|429/.test(text)) {
    return descriptor("RATE_LIMITED", "rate_limit", true, "The operation was rate limited. Retry later.");
  }
  if (/timeout|timed out|etimedout|deadline/.test(text)) {
    return descriptor("REQUEST_TIMEOUT", "timeout", true, "The operation timed out. Retry if the condition persists.");
  }
  if (/sqlite_busy|database is locked|busy/.test(text)) {
    return descriptor("DATABASE_BUSY", "resource", true, "The database is busy. Retry the operation.");
  }
  if (/sqlite_full|database or disk is full|disk is full/.test(text)) {
    return descriptor("STORAGE_EXHAUSTED", "resource", false, "Storage capacity is exhausted.");
  }
  if (/eacces|eperm|permission denied|read.?only/.test(text)) {
    return descriptor("FILESYSTEM_PERMISSION_DENIED", "filesystem", false, "The filesystem rejected this operation.");
  }
  if (/enoent|enotdir|not found|missing root/.test(text)) {
    return descriptor("RESOURCE_NOT_FOUND", "not_found", false, "The requested resource was not found.");
  }
  if (/conflict|idempotency.*(conflict|pending|ambiguous)|already exists/.test(text)) {
    return descriptor("OPERATION_CONFLICT", "conflict", false, "The operation conflicts with the current state.");
  }
  if (/child process|spawn|process/.test(text)) {
    return descriptor("PROCESS_FAILED", "process", false, "The process operation failed.");
  }
  if (/network|socket|econn|unavailable|upstream|transport/.test(text)) {
    return descriptor("DEPENDENCY_UNAVAILABLE", "dependency", true, "A dependent service is unavailable. Retry later.");
  }
  if (/invalid|malformed|missing|required|schema|parse/.test(text)) {
    return descriptor("INVALID_REQUEST", "validation", false, "The request was invalid.");
  }

  return descriptor("INTERNAL_ERROR", "internal", false, "The operation could not be completed.");
}

export function safeToolErrorContent(error: unknown): string {
  const descriptor = classifyError(error);
  return `${descriptor.code}: ${descriptor.userMessage}`;
}

function descriptor(
  code: string,
  category: ErrorCategory,
  retryable: boolean,
  userMessage: string,
): SafeErrorDescriptor {
  return { code, category, retryable, userMessage };
}

function asErrorWithCode(error: unknown): ErrorWithCode {
  if (error && typeof error === "object") return error as ErrorWithCode;
  return { message: String(error) };
}
