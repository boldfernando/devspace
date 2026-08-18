import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export type IdempotencyState = "pending" | "succeeded" | "failed";

export interface IdempotencyRecord {
  scopeKey: string;
  idempotencyKey: string;
  payloadHash: string;
  state: IdempotencyState;
  leaseToken: string | null;
  resultJson: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  pendingUntil: string | null;
  retainedUntil: string;
}

interface StoredRecord {
  scope_key: string;
  idempotency_key: string;
  payload_hash: string;
  state: IdempotencyState;
  lease_token: string | null;
  result_json: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  pending_until: string | null;
  retained_until: string;
}

export class IdempotencyConflictError extends Error {
  readonly code = "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD";
  constructor(readonly scopeKey: string, readonly idempotencyKey: string) {
    super("The idempotency key was already used with a different payload");
    this.name = "IdempotencyConflictError";
  }
}

export class IdempotencyPendingError extends Error {
  readonly code = "IDEMPOTENCY_REQUEST_IN_PROGRESS";
  constructor(readonly scopeKey: string, readonly idempotencyKey: string) {
    super("An idempotent request with this key is already in progress");
    this.name = "IdempotencyPendingError";
  }
}

export class IdempotencyAmbiguousError extends Error {
  readonly code = "IDEMPOTENCY_REQUEST_AMBIGUOUS";
  constructor(readonly record: IdempotencyRecord) {
    super("The idempotent request has an expired lease and requires reconciliation");
    this.name = "IdempotencyAmbiguousError";
  }
}

export class IdempotencyFailedError extends Error {
  readonly code = "IDEMPOTENCY_REQUEST_FAILED";
  constructor(readonly record: IdempotencyRecord) {
    super(record.errorMessage ?? "The idempotent request previously failed");
    this.name = "IdempotencyFailedError";
  }
}

export class IdempotencyEffectError<T = unknown> extends Error {
  readonly code = "IDEMPOTENCY_EFFECT_FAILED";
  constructor(readonly response: T, message = "The idempotent effect failed") {
    super(message);
    this.name = "IdempotencyEffectError";
  }
}

export interface IdempotencyRunOptions {
  now?: Date;
  retentionMs?: number;
  pendingLeaseMs?: number;
}

export interface IdempotencyRunResult<T> {
  replayed: boolean;
  value: T;
  record: IdempotencyRecord;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`);
  return `{${entries.join(",")}}`;
}

export function payloadHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function ensureIdempotencySchema(sqlite: Database.Database): void {
  sqlite.exec(`
    create table if not exists write_idempotency (
      scope_key text not null,
      idempotency_key text not null,
      payload_hash text not null,
      state text not null check (state in ('pending', 'succeeded', 'failed')),
      lease_token text,
      result_json text,
      error_code text,
      error_message text,
      created_at text not null,
      updated_at text not null,
      pending_until text,
      retained_until text not null,
      primary key (scope_key, idempotency_key)
    );
    create index if not exists write_idempotency_state_retained_idx
      on write_idempotency(state, retained_until);
    create index if not exists write_idempotency_pending_idx
      on write_idempotency(state, pending_until);
  `);
}

function toRecord(row: StoredRecord): IdempotencyRecord {
  return {
    scopeKey: row.scope_key,
    idempotencyKey: row.idempotency_key,
    payloadHash: row.payload_hash,
    state: row.state,
    leaseToken: row.lease_token,
    resultJson: row.result_json,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    pendingUntil: row.pending_until,
    retainedUntil: row.retained_until,
  };
}

export class WriteIdempotencyStore {
  constructor(private readonly sqlite: Database.Database) {
    ensureIdempotencySchema(sqlite);
  }

  get(scopeKey: string, idempotencyKey: string): IdempotencyRecord | undefined {
    const row = this.sqlite
      .prepare("select * from write_idempotency where scope_key = ? and idempotency_key = ?")
      .get(scopeKey, idempotencyKey) as StoredRecord | undefined;
    return row ? toRecord(row) : undefined;
  }

  pruneExpired(now = new Date()): number {
    const result = this.sqlite
      .prepare("delete from write_idempotency where retained_until <= ? and state <> 'pending'")
      .run(now.toISOString());
    return result.changes;
  }

  reconcileExpiredPending(scopeKey: string, idempotencyKey: string, now = new Date()): IdempotencyRecord | undefined {
    const existing = this.get(scopeKey, idempotencyKey);
    if (!existing) return undefined;
    if (existing.state !== "pending") return existing;
    const pendingUntil = existing.pendingUntil ? Date.parse(existing.pendingUntil) : Number.POSITIVE_INFINITY;
    if (pendingUntil > now.getTime()) {
      throw new IdempotencyPendingError(scopeKey, idempotencyKey);
    }
    const result = this.sqlite
      .prepare(`update write_idempotency
        set state = 'failed', error_code = ?, error_message = ?, lease_token = null, pending_until = null, updated_at = ?
        where scope_key = ? and idempotency_key = ? and state = 'pending' and pending_until <= ?`)
      .run(
        "IDEMPOTENCY_AMBIGUOUS_RECONCILED",
        "The expired pending effect was reconciled without automatic re-execution",
        now.toISOString(),
        scopeKey,
        idempotencyKey,
        now.toISOString(),
      );
    if (result.changes !== 1) {
      const current = this.get(scopeKey, idempotencyKey);
      if (current?.state === "pending") throw new IdempotencyPendingError(scopeKey, idempotencyKey);
      return current;
    }
    return this.get(scopeKey, idempotencyKey);
  }

  async run<T>(
    scopeKey: string,
    idempotencyKey: string,
    input: unknown,
    effect: () => Promise<T> | T,
    options: IdempotencyRunOptions = {},
  ): Promise<IdempotencyRunResult<T>> {
    const now = options.now ?? new Date();
    const retentionMs = options.retentionMs ?? 24 * 60 * 60 * 1000;
    const pendingLeaseMs = options.pendingLeaseMs ?? 5 * 60 * 1000;
    const hash = payloadHash(input);
    const claimed = this.claim(scopeKey, idempotencyKey, hash, now, retentionMs, pendingLeaseMs);

    if (claimed.kind === "replay") {
      return {
        replayed: true,
        value: JSON.parse(claimed.record.resultJson ?? "null") as T,
        record: claimed.record,
      };
    }
    if (claimed.kind === "pending") {
      const pendingUntil = claimed.record.pendingUntil ? Date.parse(claimed.record.pendingUntil) : Number.POSITIVE_INFINITY;
      if (pendingUntil <= now.getTime()) {
        throw new IdempotencyAmbiguousError(claimed.record);
      }
      throw new IdempotencyPendingError(scopeKey, idempotencyKey);
    }
    if (claimed.kind === "failed") {
      throw new IdempotencyFailedError(claimed.record);
    }

    try {
      const value = await effect();
      const record = this.succeed(claimed.leaseToken, scopeKey, idempotencyKey, value, now);
      return { replayed: false, value, record };
    } catch (error) {
      this.fail(claimed.leaseToken, scopeKey, idempotencyKey, error, now);
      throw error;
    }
  }

  private claim(
    scopeKey: string,
    idempotencyKey: string,
    hash: string,
    now: Date,
    retentionMs: number,
    pendingLeaseMs: number,
  ): { kind: "owner"; leaseToken: string } | { kind: "replay"; record: IdempotencyRecord } | { kind: "pending"; record: IdempotencyRecord } | { kind: "failed"; record: IdempotencyRecord } {
    const createdAt = now.toISOString();
    const retainedUntil = new Date(now.getTime() + retentionMs).toISOString();
    const pendingUntil = new Date(now.getTime() + pendingLeaseMs).toISOString();
    const leaseToken = randomUUID();
    const transaction = this.sqlite.transaction(() => {
      const existing = this.get(scopeKey, idempotencyKey);
      if (!existing) {
        this.sqlite
          .prepare(`insert into write_idempotency
            (scope_key, idempotency_key, payload_hash, state, lease_token, created_at, updated_at, pending_until, retained_until)
            values (?, ?, ?, 'pending', ?, ?, ?, ?, ?)`)
          .run(scopeKey, idempotencyKey, hash, leaseToken, createdAt, createdAt, pendingUntil, retainedUntil);
        return { kind: "owner" as const, leaseToken };
      }
      if (existing.payloadHash !== hash) {
        throw new IdempotencyConflictError(scopeKey, idempotencyKey);
      }
      if (existing.state === "succeeded") return { kind: "replay" as const, record: existing };
      if (existing.state === "failed") return { kind: "failed" as const, record: existing };
      return { kind: "pending" as const, record: existing };
    });
    return transaction();
  }

  private succeed<T>(leaseToken: string, scopeKey: string, idempotencyKey: string, value: T, now: Date): IdempotencyRecord {
    const resultJson = JSON.stringify(value);
    const updatedAt = now.toISOString();
    const result = this.sqlite
      .prepare(`update write_idempotency
        set state = 'succeeded', result_json = ?, lease_token = null, pending_until = null, updated_at = ?
        where scope_key = ? and idempotency_key = ? and lease_token = ? and state = 'pending'`)
      .run(resultJson, updatedAt, scopeKey, idempotencyKey, leaseToken);
    if (result.changes !== 1) throw new Error("idempotency lease was lost before completion");
    return this.get(scopeKey, idempotencyKey)!;
  }

  private fail(leaseToken: string, scopeKey: string, idempotencyKey: string, error: unknown, now: Date): void {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof Error && "code" in error ? String(error.code) : "EFFECT_FAILED";
    this.sqlite
      .prepare(`update write_idempotency
        set state = 'failed', error_code = ?, error_message = ?, lease_token = null, pending_until = null, updated_at = ?
        where scope_key = ? and idempotency_key = ? and lease_token = ? and state = 'pending'`)
      .run(code, message, now.toISOString(), scopeKey, idempotencyKey, leaseToken);
  }
}
