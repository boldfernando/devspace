import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertPrivateFilePermissions,
  hardenPrivateFile,
  inspectPrivateFilePermissions,
} from "./credential-security.js";
import { writeDevspaceAuth } from "./user-config.js";

test("private file hardening produces an ACL equivalent to 0600", async () => {
  const root = await mkdtemp(join(tmpdir(), "devspace-private-file-"));
  try {
    const path = join(root, "auth.json");
    await writeFile(path, "{}\n", { mode: 0o600 });
    hardenPrivateFile(path);
    const report = assertPrivateFilePermissions(path);
    assert.equal(report.equivalent0600, true);
    if (process.platform !== "win32") assert.equal(report.mode, 0o600);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("DevSpace auth persistence applies private-file hardening", async () => {
  const root = await mkdtemp(join(tmpdir(), "devspace-auth-permissions-"));
  try {
    const path = writeDevspaceAuth(
      { accessToken: "test-token-not-for-artifacts" },
      { DEVSPACE_CONFIG_DIR: root },
    );
    const report = inspectPrivateFilePermissions(path);
    assert.equal(report.equivalent0600, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
