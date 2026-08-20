import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

const repoRoot = process.env.DEVSPACE_REPO_ROOT ?? process.cwd();
const port = Number(process.env.E2E_DEVICE_CLI_PORT ?? 17690);
const baseUrl = `http://127.0.0.1:${port}`;
const ownerToken = "device-cli-e2e-owner-token-0123456789";
const results = {
  login: false,
  acl: false,
  cancellation: false,
  configurableTimeout: false,
  cleanup: false,
};

async function waitForHealth(child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited with ${child.exitCode}`);
    try {
      if ((await fetch(`${baseUrl}/healthz`)).ok) return;
    } catch {
      // Readiness retry only; functional assertions do not retry.
    }
    await delay(100);
  }
  throw new Error("server readiness timeout");
}

async function waitForExit(child, timeoutMs = 5_000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  return await Promise.race([
    new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal }))),
    delay(timeoutMs).then(() => {
      throw new Error("child process did not exit within cleanup deadline");
    }),
  ]);
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await waitForExit(child).catch(() => undefined);
  if (child.exitCode === null) child.kill("SIGKILL");
}

function serverEnv(stateDir, configDir) {
  return {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    DEVSPACE_PUBLIC_BASE_URL: baseUrl,
    DEVSPACE_ALLOWED_ROOTS: repoRoot,
    DEVSPACE_STATE_DIR: stateDir,
    DEVSPACE_CONFIG_DIR: configDir,
    DEVSPACE_OAUTH_OWNER_TOKEN: ownerToken,
    DEVSPACE_OAUTH_DEVICE_PEPPER: "device-cli-pepper-012345678901234567890123456789",
    DEVSPACE_OAUTH_SCOPES: "devspace:read,devspace:write",
    DEVSPACE_OAUTH_ALLOWED_REDIRECT_HOSTS: "localhost,127.0.0.1",
    DEVSPACE_TEST_MODE: "true",
    DEVSPACE_ENV: "staging",
  };
}

function cliEnv(configDir) {
  return {
    ...process.env,
    DEVSPACE_CONFIG_DIR: configDir,
    DEVSPACE_NO_BROWSER: "1",
  };
}

function startServer(stateDir, configDir) {
  const server = spawn(process.execPath, [join(repoRoot, "dist", "server.js")], {
    cwd: repoRoot,
    env: serverEnv(stateDir, configDir),
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.resume();
  server.stderr?.resume();
  return server;
}

function startDeviceCli(configDir, extraArgs = []) {
  return spawn(
    process.execPath,
    [
      join(repoRoot, "dist", "cli.js"),
      "auth",
      "login",
      "--device",
      "--server",
      baseUrl,
      "--scope",
      "devspace:read",
      "--resource",
      `${baseUrl}/mcp`,
      "--no-browser",
      ...extraArgs,
    ],
    {
      cwd: repoRoot,
      env: cliEnv(configDir),
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
}

async function collectDeviceCode(cli) {
  let stdout = "";
  let stderr = "";
  cli.stdout?.on("data", (chunk) => { stdout += String(chunk); });
  cli.stderr?.on("data", (chunk) => { stderr += String(chunk); });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const match = stdout.match(/Digite o código:\s*([A-Z2-9]+-[A-Z2-9]+)/);
    if (match) return { userCode: match[1], getOutput: () => ({ stdout, stderr }) };
    if (cli.exitCode !== null) break;
    await delay(100);
  }
  throw new Error(`CLI did not print device code: ${stdout} ${stderr}`);
}

async function approve(userCode) {
  const approval = await fetch(`${baseUrl}/oauth/device/approve`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ user_code: userCode, owner_token: ownerToken, decision: "approve" }),
  });
  assert.equal(approval.status, 303);
}

async function loadPermissionInspector() {
  return await import(pathToFileURL(join(repoRoot, "dist", "credential-security.js")).href);
}

test("CLI completes device login and stores private credential metadata", { concurrency: false }, async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "devspace-device-cli-state-"));
  const configDir = await mkdtemp(join(tmpdir(), "devspace-device-cli-config-"));
  const server = startServer(stateDir, configDir);
  let cli;
  let stdout = "";
  let stderr = "";
  try {
    await waitForHealth(server);
    cli = startDeviceCli(configDir, ["--poll-timeout-seconds", "60"]);
    cli.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    cli.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    const { userCode } = await collectDeviceCode(cli);
    await approve(userCode);
    const exit = await waitForExit(cli, 15_000);
    if (exit.code !== 0) {
      await writeFile(
        join(repoRoot, "artifacts", "oauth-device-cli-debug.json"),
        `${JSON.stringify({
          exit,
          stdout_has_device_code: /Digite o código/.test(stdout),
          stdout_has_login_success: /Login concluído/.test(stdout),
          stderr_length: stderr.length,
        }, null, 2)}\n`,
        { mode: 0o600 },
      );
    }
    assert.equal(exit.code, 0, JSON.stringify({ exit, stdout_has_device_code: /Digite o código/.test(stdout), stdout_has_login_success: /Login concluído/.test(stdout), stderr_length: stderr.length }));
    const authPath = join(configDir, "auth.json");
    const auth = JSON.parse(await readFile(authPath, "utf8"));
    assert.ok(auth.accessToken);
    assert.equal(auth.ownerToken, undefined);
    assert.equal(auth.server, `${baseUrl}/`);
    assert.equal(auth.resource, `${baseUrl}/mcp`);
    assert.deepEqual(auth.scopes, ["devspace:read"]);
    assert.equal(auth.device_code, undefined);
    const inspector = await loadPermissionInspector();
    const report = inspector.assertPrivateFilePermissions(authPath);
    assert.equal(report.equivalent0600, true);
    results.login = true;
    results.acl = true;
    results.configurableTimeout = true;
  } finally {
    await stop(cli);
    await stop(server);
    await rm(stateDir, { recursive: true, force: true });
    await rm(configDir, { recursive: true, force: true });
  }
});

test("Ctrl-C cancels device polling and leaves no credential or child process", { concurrency: false }, async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "devspace-device-cli-cancel-state-"));
  const configDir = await mkdtemp(join(tmpdir(), "devspace-device-cli-cancel-config-"));
  const server = startServer(stateDir, configDir);
  let cli;
  let stderr = "";
  try {
    await waitForHealth(server);
    cli = startDeviceCli(configDir, ["--poll-timeout-seconds", "120"]);
    cli.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    await collectDeviceCode(cli);
    cli.stdin?.write("\u0003");
    cli.stdin?.end();
    const exit = await waitForExit(cli);
    assert.ok(
      exit.code === 1 || (process.platform === "win32" && exit.code === null),
      `unexpected cancellation exit: ${JSON.stringify(exit)}`,
    );
    assert.match(stderr, /Device authorization cancelled/);
    assert.equal(existsSync(join(configDir, "auth.json")), false);
    results.cancellation = true;
    results.cleanup = true;
  } finally {
    await stop(cli);
    await stop(server);
    await rm(stateDir, { recursive: true, force: true });
    await rm(configDir, { recursive: true, force: true });
  }
});

test.after(async () => {
  const artifactsDir = join(repoRoot, "artifacts");
  await mkdir(artifactsDir, { recursive: true });
  const passed = Object.values(results).every(Boolean);
  await writeFile(
    join(artifactsDir, "oauth-device-cli-security-report.json"),
    `${JSON.stringify({
      schema: "devspace/oauth-device-cli-security/v1",
      status: passed ? "passed" : "failed",
      platform: process.platform,
      acl_equivalent_0600: results.acl,
      configurable_poll_timeout: results.configurableTimeout,
      ctrl_c_cancelled: results.cancellation,
      timers_and_process_cleanup: results.cleanup,
      credential_persisted_only_on_success: results.login,
      secrets_included: false,
    }, null, 2)}\n`,
    { mode: 0o600 },
  );
});
