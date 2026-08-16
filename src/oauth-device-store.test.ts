import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "./db/client.js";
import { SqliteDeviceAuthorizationStore } from "./oauth-device-store.js";

const PEPPER = "test-device-pepper-012345678901234567890123456789";

async function withStore(fn: (store: SqliteDeviceAuthorizationStore) => void): Promise<void> {
  const previous = process.env.DEVSPACE_OAUTH_DEVICE_PEPPER;
  process.env.DEVSPACE_OAUTH_DEVICE_PEPPER = PEPPER;
  const dir = await mkdtemp(join(tmpdir(), "devspace-device-store-"));
  const database = openDatabase(dir);
  database.sqlite.prepare("insert into oauth_clients (client_id, client_json, issued_at) values (?, ?, ?)").run("client-a", JSON.stringify({ client_id: "client-a", client_name: "Test client", redirect_uris: ["http://127.0.0.1/callback"], grant_types: ["urn:ietf:params:oauth:grant-type:device_code"], response_types: ["code"], token_endpoint_auth_method: "none" }), Date.now());
  database.close();
  const store = new SqliteDeviceAuthorizationStore(dir);
  try { fn(store); } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
    if (previous === undefined) delete process.env.DEVSPACE_OAUTH_DEVICE_PEPPER;
    else process.env.DEVSPACE_OAUTH_DEVICE_PEPPER = previous;
  }
}

test("device store creates a sanitized public record and enforces polling interval", async () => {
  await withStore((store) => {
    const created = store.create({ clientId: "client-a", resource: "http://127.0.0.1:7676/mcp", scopes: ["write", "read"], expiresInSeconds: 600, intervalSeconds: 5 });
    assert.match(created.deviceCode, /^[A-Za-z0-9_-]+$/);
    assert.match(created.userCode, /^[A-Z2-9]+-[A-Z2-9]+$/);
    assert.deepEqual(store.getByUserCode(created.userCode)?.scopes, ["read", "write"]);
    assert.deepEqual(store.poll(created.deviceCode, "wrong-client"), { kind: "invalid_grant" });
    assert.deepEqual(store.poll(created.deviceCode, "client-a"), { kind: "authorization_pending", intervalSeconds: 5 });
    assert.deepEqual(store.poll(created.deviceCode, "client-a"), { kind: "slow_down", intervalSeconds: 10 });
  });
});

test("device store approval emits one token opportunity and rejects replay", async () => {
  await withStore((store) => {
    const created = store.create({ clientId: "client-a", resource: "http://127.0.0.1:7676/mcp", scopes: ["devspace"], expiresInSeconds: 600, intervalSeconds: 5 });
    assert.equal(store.approve(created.userCode, "owner"), true);
    const first = store.poll(created.deviceCode, "client-a");
    assert.deepEqual(first, { kind: "approved", subjectId: "owner", resource: "http://127.0.0.1:7676/mcp", scopes: ["devspace"] });
    assert.deepEqual(store.poll(created.deviceCode, "client-a"), { kind: "invalid_grant" });
    assert.equal(store.approve(created.userCode, "owner"), false);
  });
});

test("device store denies pending requests and does not disclose invalid user codes", async () => {
  await withStore((store) => {
    const created = store.create({ clientId: "client-a", resource: "http://127.0.0.1:7676/mcp", scopes: ["devspace"], expiresInSeconds: 600, intervalSeconds: 5 });
    assert.equal(store.getByUserCode("BAD"), undefined);
    assert.equal(store.deny(created.userCode), true);
    assert.deepEqual(store.poll(created.deviceCode, "client-a"), { kind: "access_denied" });
  });
});
