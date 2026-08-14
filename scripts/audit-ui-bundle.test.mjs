import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("bundle audit reports initial entrypoint and lazy assets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "devspace-bundle-audit-"));
  const reportPath = join(dir, "report.json");
  try {
    const result = spawnSync(process.execPath, ["scripts/audit-ui-bundle.mjs", "dist/ui", reportPath, "--check"], { encoding: "utf8", env: { ...process.env, UI_MAX_INITIAL_BYTES: "500000" } });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.ok(report.entries.length > 0);
    assert.ok(report.entries.every((entry) => entry.initialBytes <= report.maxInitialBytes));
    assert.ok(report.largestAssets.length > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("bundle audit rejects an entrypoint over budget", async () => {
  const dir = await mkdtemp(join(tmpdir(), "devspace-bundle-audit-limit-"));
  const reportPath = join(dir, "report.json");
  try {
    const result = spawnSync(process.execPath, ["scripts/audit-ui-bundle.mjs", "dist/ui", reportPath, "--check"], { encoding: "utf8", env: { ...process.env, UI_MAX_INITIAL_BYTES: "1" } });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\\n${result.stderr}`, /Initial UI bundle exceeds/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
