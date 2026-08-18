import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import test from "node:test";
import { databasePath, openDatabase } from "./client.js";

test("SQLite lock contention fails with a bounded SQLITE_BUSY error", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "devspace-sqlite-lock-"));
  const first = openDatabase(stateDir);
  const second = openDatabase(stateDir);
  try {
    first.sqlite.exec("create table if not exists resilience_lock_probe (value text not null)");
    second.sqlite.pragma("busy_timeout = 25");
    first.sqlite.exec("begin immediate");

    assert.throws(
      () => second.sqlite.prepare("insert into resilience_lock_probe (value) values (?)").run("probe"),
      (error: unknown) => error instanceof Error && /database is locked|SQLITE_BUSY/i.test(error.message),
    );
  } finally {
    try {
      first.sqlite.exec("rollback");
    } catch {
      // The transaction may already have been rolled back by SQLite after the failure.
    }
    second.close();
    first.close();
    await rm(stateDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("SQLite full storage is surfaced as a bounded resource failure", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "devspace-sqlite-full-"));
  const sqlite = new Database(join(stateDir, "full.sqlite"));
  try {
    sqlite.pragma("page_size = 1024");
    sqlite.pragma("max_page_count = 4");
    sqlite.exec("create table resilience_full_probe (value blob not null)");

    let full = false;
    for (let attempt = 0; attempt < 100 && !full; attempt += 1) {
      try {
        sqlite.prepare("insert into resilience_full_probe (value) values (?)").run(Buffer.alloc(1024));
      } catch (error) {
        full = error instanceof Error && /database or disk is full|SQLITE_FULL/i.test(error.message);
      }
    }
    assert.equal(full, true, "bounded max_page_count must produce SQLITE_FULL");
  } finally {
    sqlite.close();
    await rm(stateDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("SQLite read-only mode rejects writes without mutating the state", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "devspace-sqlite-readonly-"));
  const writable = openDatabase(stateDir);
  try {
    writable.sqlite.exec("create table if not exists resilience_readonly_probe (value text not null)");
    writable.sqlite.prepare("insert into resilience_readonly_probe (value) values (?)").run("before");
  } finally {
    writable.close();
  }

  const readonly = new Database(databasePath(stateDir), { readonly: true });
  try {
    assert.throws(
      () => readonly.prepare("insert into resilience_readonly_probe (value) values (?)").run("after"),
      (error: unknown) => error instanceof Error && /readonly|read-only/i.test(error.message),
    );
    const rows = readonly.prepare("select value from resilience_readonly_probe").all() as Array<{ value: string }>;
    assert.deepEqual(rows, [{ value: "before" }]);
  } finally {
    readonly.close();
    await rm(stateDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
