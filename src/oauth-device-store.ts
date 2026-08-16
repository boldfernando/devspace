import { createHmac, randomBytes } from "node:crypto";
import { openDatabase, type DatabaseHandle } from "./db/client.js";

const DEVICE_CODE_BYTES = 32;
const USER_CODE_LENGTH = 8;
const DEVICE_RETENTION_MS = 15 * 60 * 1000;
const DEVICE_PEPPER_ENV = "DEVSPACE_OAUTH_DEVICE_PEPPER";
const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export type DeviceAuthorizationStatus =
  | "pending"
  | "approved"
  | "denied"
  | "consumed"
  | "expired";

export interface DeviceAuthorizationRequest {
  clientId: string;
  resource: string;
  scopes: string[];
  expiresInSeconds: number;
  intervalSeconds: number;
}

export interface DeviceAuthorizationCreated {
  deviceCode: string;
  userCode: string;
  expiresInSeconds: number;
  intervalSeconds: number;
}

export interface DeviceAuthorizationPublicRecord {
  clientId: string;
  resource: string;
  scopes: string[];
  status: DeviceAuthorizationStatus;
  expiresAt: number;
  intervalSeconds: number;
}

export type DevicePollResult =
  | { kind: "authorization_pending"; intervalSeconds: number }
  | { kind: "slow_down"; intervalSeconds: number }
  | { kind: "access_denied" }
  | { kind: "expired_token" }
  | { kind: "invalid_grant" }
  | { kind: "approved"; subjectId: string; resource: string; scopes: string[] };

type DeviceRow = {
  device_code_hash: string;
  user_code_hash: string;
  client_id: string;
  resource: string;
  scopes_json: string;
  status: DeviceAuthorizationStatus;
  subject_id: string | null;
  expires_at: number;
  interval_seconds: number;
  last_poll_at: number | null;
  poll_count: number;
  created_at: number;
  approved_at: number | null;
  consumed_at: number | null;
  denied_at: number | null;
};

function devicePepper(configured?: string): string {
  const pepper = (configured ?? process.env[DEVICE_PEPPER_ENV])?.trim();
  if (!pepper || pepper.length < 32) {
    throw new Error(`${DEVICE_PEPPER_ENV} must be configured with at least 32 characters`);
  }
  return pepper;
}

function hashValue(value: string, pepper?: string): string {
  return createHmac("sha256", devicePepper(pepper)).update(value, "utf8").digest("hex");
}

function randomUserCode(): string {
  const bytes = randomBytes(USER_CODE_LENGTH);
  let code = "";
  for (const byte of bytes) code += USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length];
  return code;
}

export function normalizeDeviceUserCode(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function formatDeviceUserCode(value: string): string {
  const normalized = normalizeDeviceUserCode(value);
  return normalized.length === USER_CODE_LENGTH
    ? `${normalized.slice(0, 4)}-${normalized.slice(4)}`
    : normalized;
}

function parseScopes(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new Error("Invalid persisted device authorization scopes");
  }
  return parsed;
}

function rowToPublic(row: DeviceRow): DeviceAuthorizationPublicRecord {
  return {
    clientId: row.client_id,
    resource: row.resource,
    scopes: parseScopes(row.scopes_json),
    status: row.status,
    expiresAt: row.expires_at,
    intervalSeconds: row.interval_seconds,
  };
}

export class SqliteDeviceAuthorizationStore {
  private readonly database: DatabaseHandle;
  private readonly ownsDatabase: boolean;
  private readonly pepper: string;

  constructor(stateDirOrDatabase: string | DatabaseHandle, pepper?: string) {
    this.pepper = devicePepper(pepper);
    this.ownsDatabase = typeof stateDirOrDatabase === "string";
    this.database = typeof stateDirOrDatabase === "string" ? openDatabase(stateDirOrDatabase) : stateDirOrDatabase;
  }

  create(request: DeviceAuthorizationRequest): DeviceAuthorizationCreated {
    if (!request.clientId || !request.resource || request.scopes.length === 0) {
      throw new Error("Device authorization request is incomplete");
    }
    const expiresInSeconds = Math.max(60, Math.min(900, Math.floor(request.expiresInSeconds)));
    const intervalSeconds = Math.max(5, Math.min(60, Math.floor(request.intervalSeconds)));
    const now = Date.now();
    const expiresAt = now + expiresInSeconds * 1000;
    const insert = this.database.sqlite.prepare(`
      insert into oauth_device_authorizations (
        device_code_hash, user_code_hash, client_id, resource, scopes_json,
        status, subject_id, expires_at, interval_seconds, last_poll_at,
        poll_count, created_at, approved_at, consumed_at, denied_at
      ) values (?, ?, ?, ?, ?, 'pending', null, ?, ?, null, 0, ?, null, null, null)
    `);

    const create = this.database.sqlite.transaction(() => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const deviceCode = randomBytes(DEVICE_CODE_BYTES).toString("base64url");
        const userCode = randomUserCode();
        try {
          insert.run(
            hashValue(deviceCode, this.pepper),
            hashValue(normalizeDeviceUserCode(userCode), this.pepper),
            request.clientId,
            request.resource,
            JSON.stringify([...request.scopes].sort()),
            expiresAt,
            intervalSeconds,
            now,
          );
          return { deviceCode, userCode: formatDeviceUserCode(userCode), expiresInSeconds, intervalSeconds };
        } catch (error) {
          if (!String(error).toLowerCase().includes("unique")) throw error;
        }
      }
      throw new Error("Unable to allocate a unique device authorization code");
    });

    return create() as DeviceAuthorizationCreated;
  }

  getByUserCode(value: string): DeviceAuthorizationPublicRecord | undefined {
    const normalized = normalizeDeviceUserCode(value);
    if (normalized.length !== USER_CODE_LENGTH) return undefined;
    const row = this.database.sqlite
      .prepare("select client_id, resource, scopes_json, status, expires_at, interval_seconds from oauth_device_authorizations where user_code_hash = ?")
      .get(hashValue(normalized, this.pepper)) as Omit<DeviceRow, "device_code_hash" | "user_code_hash" | "subject_id" | "last_poll_at" | "poll_count" | "created_at" | "approved_at" | "consumed_at" | "denied_at"> | undefined;
    return row ? rowToPublic(row as DeviceRow) : undefined;
  }

  getByDeviceCode(value: string, clientId: string): DeviceAuthorizationPublicRecord | undefined {
    if (!value || !clientId) return undefined;
    const row = this.database.sqlite
      .prepare("select client_id, resource, scopes_json, status, expires_at, interval_seconds from oauth_device_authorizations where device_code_hash = ? and client_id = ?")
      .get(hashValue(value, this.pepper), clientId) as Omit<DeviceRow, "device_code_hash" | "user_code_hash" | "subject_id" | "last_poll_at" | "poll_count" | "created_at" | "approved_at" | "consumed_at" | "denied_at"> | undefined;
    return row ? rowToPublic(row as DeviceRow) : undefined;
  }

  approve(value: string, subjectId: string): boolean {
    const normalized = normalizeDeviceUserCode(value);
    if (normalized.length !== USER_CODE_LENGTH || !subjectId) return false;
    const now = Date.now();
    const result = this.database.sqlite
      .prepare("update oauth_device_authorizations set status = 'approved', subject_id = ?, approved_at = ? where user_code_hash = ? and status = 'pending' and expires_at > ?")
      .run(subjectId, now, hashValue(normalized, this.pepper), now);
    return result.changes === 1;
  }

  deny(value: string): boolean {
    const normalized = normalizeDeviceUserCode(value);
    if (normalized.length !== USER_CODE_LENGTH) return false;
    const result = this.database.sqlite
      .prepare("update oauth_device_authorizations set status = 'denied', denied_at = ? where user_code_hash = ? and status = 'pending' and expires_at > ?")
      .run(Date.now(), hashValue(normalized, this.pepper), Date.now());
    return result.changes === 1;
  }

  poll(deviceCode: string, clientId: string): DevicePollResult {
    if (!deviceCode || !clientId) return { kind: "invalid_grant" };
    const now = Date.now();
    const poll = this.database.sqlite.transaction(() => {
      const row = this.database.sqlite
        .prepare("select * from oauth_device_authorizations where device_code_hash = ?")
        .get(hashValue(deviceCode, this.pepper)) as DeviceRow | undefined;
      if (!row || row.client_id !== clientId) return { kind: "invalid_grant" } as DevicePollResult;
      if (row.expires_at <= now && (row.status === "pending" || row.status === "approved")) {
        this.database.sqlite.prepare("update oauth_device_authorizations set status = 'expired' where device_code_hash = ? and status in ('pending', 'approved')").run(row.device_code_hash);
        return { kind: "expired_token" } as DevicePollResult;
      }
      if (row.status === "pending") {
        if (row.last_poll_at !== null && now - row.last_poll_at < row.interval_seconds * 1000) {
          const intervalSeconds = Math.min(300, row.interval_seconds + 5);
          this.database.sqlite.prepare("update oauth_device_authorizations set interval_seconds = ?, last_poll_at = ?, poll_count = poll_count + 1 where device_code_hash = ? and status = 'pending'").run(intervalSeconds, now, row.device_code_hash);
          return { kind: "slow_down", intervalSeconds } as DevicePollResult;
        }
        this.database.sqlite.prepare("update oauth_device_authorizations set last_poll_at = ?, poll_count = poll_count + 1 where device_code_hash = ? and status = 'pending'").run(now, row.device_code_hash);
        return { kind: "authorization_pending", intervalSeconds: row.interval_seconds } as DevicePollResult;
      }
      if (row.status === "denied") return { kind: "access_denied" } as DevicePollResult;
      if (row.status === "expired") return { kind: "expired_token" } as DevicePollResult;
      if (row.status !== "approved" || !row.subject_id) return { kind: "invalid_grant" } as DevicePollResult;
      const consumed = this.database.sqlite.prepare("update oauth_device_authorizations set status = 'consumed', consumed_at = ? where device_code_hash = ? and client_id = ? and status = 'approved'").run(now, row.device_code_hash, clientId);
      if (consumed.changes !== 1) return { kind: "invalid_grant" } as DevicePollResult;
      return { kind: "approved", subjectId: row.subject_id, resource: row.resource, scopes: parseScopes(row.scopes_json) } as DevicePollResult;
    });
    return poll() as DevicePollResult;
  }

  cleanup(now = Date.now()): number {
    return this.database.sqlite
      .prepare("delete from oauth_device_authorizations where (status in ('consumed', 'denied', 'expired') and coalesce(consumed_at, denied_at, expires_at) < ?) or expires_at < ?")
      .run(now - DEVICE_RETENTION_MS, now - DEVICE_RETENTION_MS).changes;
  }

  close(): void {
    if (this.ownsDatabase) this.database.close();
  }
}
