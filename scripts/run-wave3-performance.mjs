#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const scriptDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
const argv = process.argv.slice(2);
function getArg(name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}
const repoRoot = resolve(getArg("--repo", scriptDir));
const externalBaseUrl = argv.includes("--base-url") ? getArg("--base-url", "http://127.0.0.1:7676") : undefined;
const isolatedPort = Number(getArg("--isolated-port", "17679"));
const artifactDir = join(repoRoot, "artifacts", "wave3-performance");
const profileDir = join(artifactDir, "profiles");
const startedAt = new Date().toISOString();
const slo = { p50_max_ms: 50, p95_max_ms: 100, sustained_p50_gate: true };

const profiles = [
  { name: "sustained", samples: 20, concurrency: 4 },
  { name: "burst", samples: 40, concurrency: 8 },
  { name: "soak", samples: 60, concurrency: 4 },
];
const rampStages = [1, 4, 8, 16].map((concurrency, index) => ({
  name: `ramp-${index + 1}`,
  samples: 10,
  concurrency,
}));

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

function summarize(name, samples, concurrency, latenciesMs, wallMs, extra = {}) {
  const p50 = percentile(latenciesMs, 0.5);
  const p95 = percentile(latenciesMs, 0.95);
  const p99 = percentile(latenciesMs, 0.99);
  const p50Gate = name === "sustained" ? p50 !== null && p50 < slo.p50_max_ms : true;
  const sloPassed = p50 !== null && p95 !== null && p50Gate && p95 < slo.p95_max_ms;
  return {
    name,
    status: sloPassed ? "passed" : "failed",
    samples,
    concurrency,
    wall_ms: Math.round(wallMs),
    throughput_rps: Number((samples / Math.max(0.001, wallMs / 1000)).toFixed(2)),
    p50_ms: p50,
    p95_ms: p95,
    p99_ms: p99,
    max_ms: Math.max(...latenciesMs),
    slo: { ...slo, passed: sloPassed },
    ...extra,
  };
}

async function waitForHealth(url, timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${url}/healthz`);
      if (response.status === 200) return true;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  return false;
}

async function startIsolatedServer() {
  const root = mkdtempSync(join(tmpdir(), "devspace-wave3-root-"));
  const state = mkdtempSync(join(tmpdir(), "devspace-wave3-state-"));
  const ownerToken = `wave3-owner-${randomUUID()}`;
  const url = `http://127.0.0.1:${isolatedPort}`;
  const env = {
    ...process.env,
    CI: "true",
    DEVSPACE_ENV: "staging",
    HOST: "127.0.0.1",
    PORT: String(isolatedPort),
    DEVSPACE_PUBLIC_BASE_URL: url,
    DEVSPACE_ALLOWED_ROOTS: root,
    DEVSPACE_WORKTREE_ROOT: root,
    DEVSPACE_STATE_DIR: state,
    DEVSPACE_OAUTH_OWNER_TOKEN: ownerToken,
    DEVSPACE_OAUTH_DEVICE_PEPPER: `wave3-pepper-${randomUUID()}`,
    DEVSPACE_LOG_LEVEL: "silent",
    DEVSPACE_LOG_REQUESTS: "false",
    DEVSPACE_LOG_TOOL_CALLS: "false",
  };
  const child = spawn(process.execPath, ["dist/cli.js", "serve"], {
    cwd: repoRoot,
    env,
    stdio: "ignore",
    windowsHide: true,
  });
  const ready = await waitForHealth(url);
  if (!ready) {
    if (child.exitCode === null) child.kill("SIGKILL");
    await rm(root, { recursive: true, force: true });
    await rm(state, { recursive: true, force: true });
    throw new Error("isolated_server_readiness_failed");
  }
  return { child, root, state, url, ownerToken };
}

async function stopIsolatedServer(server) {
  if (!server) return;
  if (server.child.exitCode === null) {
    server.child.kill("SIGTERM");
    await new Promise((resolveStop) => {
      const timer = setTimeout(() => {
        if (server.child.exitCode === null) server.child.kill("SIGKILL");
        resolveStop();
      }, 3000);
      server.child.once("exit", () => {
        clearTimeout(timer);
        resolveStop();
      });
    });
  }
  await rm(server.root, { recursive: true, force: true });
  await rm(server.state, { recursive: true, force: true });
}

async function resolveOwnerToken() {
  if (process.env.E2E_OWNER_TOKEN) return process.env.E2E_OWNER_TOKEN;
  try {
    const auth = JSON.parse(await readFile(join(homedir(), ".devspace", "auth.json"), "utf8"));
    return typeof auth.ownerToken === "string" && auth.ownerToken.length >= 20 ? auth.ownerToken : undefined;
  } catch {
    return undefined;
  }
}

async function runLoad(name, samples, concurrency, activeBaseUrl, ownerToken) {
  const reportPath = join("artifacts", "wave3-performance", "profiles", `${name}.json`);
  const absoluteReportPath = join(repoRoot, reportPath);
  await rm(absoluteReportPath, { force: true });
  const command = process.env.ComSpec ?? "cmd.exe";
  const commandArgs = ["/d", "/s", "/c", "npm run mcp:load:log"];
  const started = Date.now();
  const child = spawn(command, commandArgs, {
    cwd: repoRoot,
    env: {
      ...process.env,
      E2E_BASE_URL: activeBaseUrl,
      ...(ownerToken ? { E2E_OWNER_TOKEN: ownerToken } : {}),
      MCP_LOAD_SAMPLES: String(samples),
      MCP_LOAD_CONCURRENCY: String(concurrency),
      MCP_LOAD_REPORT: reportPath,
    },
    stdio: "ignore",
    windowsHide: true,
  });
  const exit = await new Promise((resolveExit) => {
    child.once("error", (error) => resolveExit({ code: null, signal: null, error: error.code ?? "spawn_error" }));
    child.once("close", (code, signal) => resolveExit({ code, signal, error: null }));
  });
  const durationMs = Date.now() - started;
  if (exit.code !== 0) {
    return { name, status: "failed", samples, concurrency, duration_ms: durationMs, exit_code: exit.code, signal: exit.signal, error: exit.error ?? "load_command_failed" };
  }
  let report;
  try {
    report = JSON.parse(await readFile(absoluteReportPath, "utf8"));
  } catch {
    return { name, status: "failed", samples, concurrency, duration_ms: durationMs, exit_code: exit.code, error: "missing_or_invalid_load_artifact" };
  }
  assert.equal(report.schema, "devspace.mcp-load.v1");
  assert.equal(report.status, "passed");
  assert.equal(report.samples, samples);
  assert.equal(Array.isArray(report.latenciesMs), true);
  assert.equal(report.latenciesMs.length, samples);
  assert.equal(report.latenciesMs.every((value) => Number.isFinite(value) && value >= 0), true);
  return summarize(name, samples, concurrency, report.latenciesMs, report.wallMs, {
    duration_ms: durationMs,
    artifact: reportPath,
  });
}

await mkdir(profileDir, { recursive: true });
let isolatedServer;
let activeBaseUrl = externalBaseUrl;
let activeOwnerToken = await resolveOwnerToken();
try {
  if (!externalBaseUrl) {
    isolatedServer = await startIsolatedServer();
    activeBaseUrl = isolatedServer.url;
    activeOwnerToken = isolatedServer.ownerToken;
  }
  const results = [];
  const rampResults = [];
  for (const stage of rampStages) rampResults.push(await runLoad(stage.name, stage.samples, stage.concurrency, activeBaseUrl, activeOwnerToken));
  const rampLatencies = [];
  let rampWallMs = 0;
  for (const stage of rampResults) {
    if (stage.status !== "passed") continue;
    const report = JSON.parse(await readFile(join(repoRoot, "artifacts", "wave3-performance", "profiles", `${stage.name}.json`), "utf8"));
    rampLatencies.push(...report.latenciesMs);
    rampWallMs += report.wallMs;
  }
  const rampFailed = rampResults.some((result) => result.status !== "passed");
  results.push(rampFailed ? { name: "ramp", status: "failed", samples: rampResults.reduce((sum, result) => sum + result.samples, 0), stages: rampResults } : summarize("ramp", rampLatencies.length, 16, rampLatencies, rampWallMs, { stages: rampResults }));
  for (const profile of profiles) results.push(await runLoad(profile.name, profile.samples, profile.concurrency, activeBaseUrl, activeOwnerToken));
  const failed = results.filter((result) => result.status !== "passed");
  const summary = {
    schema: "devspace.wave3-performance.v1",
    status: failed.length === 0 ? "passed" : "failed",
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    repository: "devspace",
    base_url: activeBaseUrl,
    execution_mode: externalBaseUrl ? "external_server" : "isolated_staging_server",
    isolated_port: externalBaseUrl ? null : isolatedPort,
    profiles: results,
    thresholds: slo,
    invariants: {
      real_http_mcp: true,
      all_profiles_executed: results.length === 4,
      artifacts_sanitized: true,
      secrets_included: false,
      failed_closed_on_missing_report: true,
    },
  };
  await writeFile(join(artifactDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(`wave3_status=${summary.status}`);
  console.log(`wave3_profiles=${results.length}`);
  for (const result of results) console.log(`${result.name}=${result.status} samples=${result.samples} p50=${result.p50_ms ?? "UNKNOWN"} p95=${result.p95_ms ?? "UNKNOWN"} p99=${result.p99_ms ?? "UNKNOWN"}`);
  if (failed.length > 0) process.exitCode = 1;
} finally {
  await stopIsolatedServer(isolatedServer);
}
