import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openDatabase } from "./client.js";

test("query-performance migration supports hot recency and cleanup plans", async () => {
  const root = await mkdtemp(join(tmpdir(), "devspace-query-performance-"));
  const database = openDatabase(root);
  try {
    assert.match(
      explain(database.sqlite, "select * from local_agent_sessions order by updated_at desc"),
      /local_agent_sessions_updated_at_idx/,
    );
    assert.match(
      explain(
        database.sqlite,
        "delete from write_idempotency where retained_until <= ? and state <> 'pending'",
        "2099-01-01T00:00:00.000Z",
      ),
      /write_idempotency_retained_active_idx/,
    );
    assert.match(
      explain(
        database.sqlite,
        "delete from oauth_device_authorizations where status = 'consumed' and consumed_at < ?",
        Date.now(),
      ),
      /oauth_device_authorizations_status_consumed_at_idx/,
    );
    assert.match(
      explain(
        database.sqlite,
        "delete from oauth_device_authorizations where status = 'denied' and denied_at < ?",
        Date.now(),
      ),
      /oauth_device_authorizations_status_denied_at_idx/,
    );
    assert.match(
      explain(
        database.sqlite,
        "delete from oauth_device_authorizations where expires_at < ?",
        Date.now(),
      ),
      /oauth_device_authorizations_expires_at_idx/,
    );
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

function explain(sqlite: { prepare(sql: string): { all(...params: unknown[]): unknown[] } }, sql: string, ...params: unknown[]): string {
  const rows = sqlite.prepare(`explain query plan ${sql}`).all(...params) as Array<{ detail?: string }>;
  return rows.map((row) => row.detail ?? "").join("\n");
}
