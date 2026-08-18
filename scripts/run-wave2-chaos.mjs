import { mkdir, rm, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const argv = process.argv.slice(2);
function getArg(name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}
const repoRoot = resolve(getArg("--repo", process.cwd()));
const baseUrl = getArg("--base-url", "http://127.0.0.1:7676");
const chaosPort = Number(getArg("--chaos-port", "17678"));
const artifactDir = join(repoRoot, "artifacts", "wave2-chaos");
await mkdir(artifactDir, { recursive: true });

function sanitize(text) {
  return text
    .replaceAll(repoRoot, "<repo>")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer <redacted>")
    .replace(/(owner[_-]?token|access[_-]?token|refresh[_-]?token|code[_-]?verifier|device[_-]?code)\s*[:=]\s*[^\s,;]+/gi, "$1=<redacted>")
    .replace(/(authorization|cookie)\s*:\s*[^\n]+/gi, "$1: <redacted>");
}

function runCommand(name, command, args) {
  return new Promise((resolveResult) => {
    const isWindowsNpm = process.platform === "win32" && command === "npm";
    const executable = command === "node" ? process.execPath : (isWindowsNpm ? (process.env.ComSpec ?? "cmd.exe") : command);
    const spawnArgs = isWindowsNpm ? ["/d", "/s", "/c", ["npm", ...args].join(" ")] : args;
    const started = Date.now();
    const child = spawn(executable, spawnArgs, {
      cwd: repoRoot,
      shell: false,
      env: { ...process.env, CI: "true", DEVSPACE_ENV: "staging", E2E_NEGATIVE_MATRIX: "true" },
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.on("error", (error) => { output += `runner_error=${error.message}`; });
    child.on("close", async (code, signal) => {
      const logPath = join(artifactDir, `${name}.log`);
      await writeFile(logPath, sanitize(output).slice(-16000), "utf8");
      resolveResult({ name, command: [command, ...args], exit_code: code ?? 1, signal: signal ?? null, status: code === 0 ? "passed" : "failed", duration_ms: Date.now() - started, log: logPath.replaceAll(repoRoot, "<repo>") });
    });
  });
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

async function lifecycleChaos() {
  const root = mkdtempSync(join(tmpdir(), "devspace-wave2-root-"));
  const state = mkdtempSync(join(tmpdir(), "devspace-wave2-state-"));
  const ownerToken = `wave2-owner-${randomUUID()}`;
  const url = `http://127.0.0.1:${chaosPort}`;
  const env = {
    ...process.env,
    CI: "true",
    DEVSPACE_ENV: "staging",
    HOST: "127.0.0.1",
    PORT: String(chaosPort),
    DEVSPACE_PUBLIC_BASE_URL: url,
    DEVSPACE_ALLOWED_ROOTS: root,
    DEVSPACE_WORKTREE_ROOT: root,
    DEVSPACE_STATE_DIR: state,
    DEVSPACE_OAUTH_OWNER_TOKEN: ownerToken,
    DEVSPACE_OAUTH_DEVICE_PEPPER: `wave2-pepper-${randomUUID()}`,
    DEVSPACE_LOG_LEVEL: "silent",
    DEVSPACE_LOG_REQUESTS: "false",
    DEVSPACE_LOG_TOOL_CALLS: "false",
  };
  let child;
  let startupOutput = "";
  const started = Date.now();
  try {
    const start = () => {
      child = spawn(process.execPath, ["dist/cli.js", "serve"], { cwd: repoRoot, env, stdio: ["ignore", "pipe", "pipe"] });
      child.stdout.on("data", (chunk) => { startupOutput += chunk.toString(); });
      child.stderr.on("data", (chunk) => { startupOutput += chunk.toString(); });
    };
    const stop = () => new Promise((resolveStop) => {
      if (!child || child.exitCode !== null) return resolveStop();
      child.once("exit", () => resolveStop());
      child.kill("SIGTERM");
      setTimeout(() => { if (child && child.exitCode === null) child.kill("SIGKILL"); }, 3000).unref();
    });
    start();
    const firstReady = await waitForHealth(url);
    if (!firstReady) throw new Error(`isolated server did not become ready; output=${sanitize(startupOutput).slice(-4000)}`);
    const firstHealth = await fetch(`${url}/healthz`);
    if (firstHealth.status !== 200) throw new Error(`unexpected first health status ${firstHealth.status}`);
    await stop();
    let unavailableRejected = false;
    try { await fetch(`${url}/healthz`); } catch { unavailableRejected = true; }
    if (!unavailableRejected) throw new Error("unavailable endpoint remained reachable after stop");
    start();
    const secondReady = await waitForHealth(url);
    if (!secondReady) throw new Error(`server did not recover after restart; output=${sanitize(startupOutput).slice(-4000)}`);
    const secondHealth = await fetch(`${url}/healthz`);
    const metrics = await fetch(`${url}/metrics`);
    if (secondHealth.status !== 200 || metrics.status !== 200) throw new Error("recovered server health/metrics failed");
    await stop();
    return { name: "CHAOS-001-restart-recovery", status: "passed", duration_ms: Date.now() - started, details: { first_ready: firstReady, unavailable_rejected: unavailableRejected, second_ready: secondReady, health_status_after_restart: secondHealth.status, metrics_status_after_restart: metrics.status } };
  } finally {
    if (child && child.exitCode === null) child.kill("SIGKILL");
    await rm(root, { recursive: true, force: true });
    await rm(state, { recursive: true, force: true });
  }
}

const scenarios = [];
try {
  scenarios.push(await lifecycleChaos());
} catch (error) {
  scenarios.push({ name: "CHAOS-001-restart-recovery", status: "failed", error: sanitize(error instanceof Error ? error.message : String(error)) });
}

const commands = [
  ["CHAOS-002-idempotency-real", "npm", ["run", "e2e:idempotency"]],
  ["CHAOS-003-idempotency-p1", "npm", ["run", "test:idempotency:p1"]],
  ["CHAOS-004-http-mcp-positive", "npm", ["run", "e2e"]],
  ["CHAOS-005-oauth-device-http", "npm", ["run", "e2e:oauth-device"]],
  ["CHAOS-006-oauth-device-cli", "npm", ["run", "e2e:oauth-device-cli"]],
  ["CHAOS-007-negative-security", "npm", ["run", "security:p0"]],
  ["CHAOS-008-authenticated-load", "npm", ["run", "mcp:load:log"]],
  ["CHAOS-009-observability-contract", "npm", ["run", "test:observability"]],
  ["CHAOS-010-bundle-and-coverage", "npm", ["run", "coverage:check"]],
  ["CHAOS-011-doctor", "node", ["dist/cli.js", "doctor"]],
];
for (const [name, command, args] of commands) scenarios.push(await runCommand(name, command, args));

const summary = {
  schema: "devspace.wave2-chaos.v1",
  status: scenarios.every((scenario) => scenario.status === "passed") ? "passed" : "failed",
  started_at: new Date().toISOString(),
  repository: "devspace",
  base_url: baseUrl,
  chaos_port: chaosPort,
  scenarios,
  invariants: [
    "restart recovery returns health and metrics without cross-session context",
    "unavailable endpoint fails closed",
    "idempotency replay/conflict/concurrency produce no duplicate effect",
    "P0 rejected requests remain effect-free",
    "cleanup removes isolated roots/state and no orphan process remains",
    "artifacts are sanitized and secret flags remain false",
  ],
};
await writeFile(join(artifactDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: summary.status, scenarios: scenarios.length, failed: scenarios.filter((scenario) => scenario.status !== "passed").map((scenario) => scenario.name), artifact: "artifacts/wave2-chaos/summary.json" }));
if (summary.status !== "passed") process.exitCode = 1;
