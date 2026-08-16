import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { analyzeRepository, parseCliArgs, renderReport, validateManifest, writeArtifacts } from "../src/reverse-engineering/index.js";

const repoRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));

function withoutGeneratedAt(value: any): any {
  const copy = JSON.parse(JSON.stringify(value));
  delete copy.generated_at;
  return copy;
}

test("Canonical 360 detects the real DevSpace topology and surfaces", () => {
  const manifest = analyzeRepository(repoRoot);
  assert.equal(manifest.topology.classification, "MODULAR_MONOLITH");
  assert.ok(manifest.surfaces.some((surface: any) => surface.family === "CLI"));
  assert.ok(manifest.surfaces.some((surface: any) => surface.family === "MCP_SERVER"));
  assert.ok(manifest.surfaces.some((surface: any) => surface.family === "WEB_APP"));
  assert.ok(manifest.routes.some((route: any) => route.path === "/mcp"));
  assert.ok(manifest.features.length >= 5);
  assert.ok(manifest.tests.length > 10);
});

test("manifest satisfies the required machine-readable contract", () => {
  const manifest = analyzeRepository(repoRoot);
  const result = validateManifest(manifest);
  assert.deepEqual(result, { valid: true, errors: [] });
  const schema = JSON.parse(readFileSync(join(repoRoot, "schemas", "canonical-360-manifest.schema.json"), "utf8"));
  for (const key of schema.required) assert.ok(Object.prototype.hasOwnProperty.call(manifest, key), `missing manifest key: ${key}`);
});

test("scan output is deterministic apart from generated_at", () => {
  const first = analyzeRepository(repoRoot);
  const second = analyzeRepository(repoRoot);
  assert.deepEqual(withoutGeneratedAt(first), withoutGeneratedAt(second));
});

test("CLI flags parse before resolving output directories", () => {
  const parsed = parseCliArgs(["full", "--strict", "--fail-on", "P1", "--root", repoRoot, "--output", join(repoRoot, "artifacts", "canonical-360-test"), "--format", "both"]);
  assert.equal(parsed.scope, "full");
  assert.equal(parsed.strict, true);
  assert.equal(parsed.failOn, "P1");
  assert.equal(parsed.root, repoRoot);
  assert.equal(parsed.format, "both");
});

test("fixture scan supports fail-safe minimal repositories", () => {
  const fixture = mkdtempSync(join(tmpdir(), "canonical-360-fixture-"));
  try {
    mkdirSync(join(fixture, "src", "ui"), { recursive: true });
    writeFileSync(join(fixture, "package.json"), JSON.stringify({ name: "fixture-app", version: "0.0.0", bin: { fixture: "dist/cli.js" }, dependencies: {} }, null, 2));
    writeFileSync(join(fixture, "package-lock.json"), "{}\n");
    writeFileSync(join(fixture, "src", "server.ts"), "import express from 'express'; const app = express(); app.post('/mcp', () => undefined);\n");
    writeFileSync(join(fixture, "src", "ui", "App.tsx"), "export function App(){ return null; }\n");
    const manifest = analyzeRepository(fixture);
    assert.equal(manifest.repository.name, "fixture-app");
    assert.equal(manifest.topology.package_manager, "npm");
    assert.ok(manifest.surfaces.some((surface: any) => surface.family === "CLI"));
    assert.equal(validateManifest(manifest).valid, true);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("integration writes valid manifest, report, gates and backlog artifacts", () => {
  const output = mkdtempSync(join(tmpdir(), "canonical-360-output-"));
  try {
    const manifest = analyzeRepository(repoRoot);
    const paths = writeArtifacts(manifest, output);
    const persisted = JSON.parse(readFileSync(paths.manifestPath, "utf8"));
    assert.equal(validateManifest(persisted).valid, true);
    assert.match(readFileSync(paths.reportPath, "utf8"), /Gates G0/);
    assert.match(readFileSync(paths.gatesPath, "utf8"), /DoR/);
    assert.match(readFileSync(paths.backlogPath, "utf8"), /Backlog P0–P4/);
    assert.match(renderReport(manifest), /Canonical 360/);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
