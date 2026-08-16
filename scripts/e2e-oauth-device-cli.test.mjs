import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

const repoRoot = process.env.DEVSPACE_REPO_ROOT ?? process.cwd();
const port = Number(process.env.E2E_DEVICE_CLI_PORT ?? 17690);
const baseUrl = `http://127.0.0.1:${port}`;
const ownerToken = "device-cli-e2e-owner-token-0123456789";

async function waitForHealth(child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited with ${child.exitCode}`);
    try { if ((await fetch(`${baseUrl}/healthz`)).ok) return; } catch { /* readiness */ }
    await delay(100);
  }
  throw new Error("server readiness timeout");
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(5_000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

test("CLI completes device login and stores only sanitized credential metadata", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "devspace-device-cli-state-"));
  const configDir = await mkdtemp(join(tmpdir(), "devspace-device-cli-config-"));
  const server = spawn(process.execPath, [join(repoRoot, "dist", "server.js")], {
    cwd: repoRoot,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), DEVSPACE_PUBLIC_BASE_URL: baseUrl, DEVSPACE_ALLOWED_ROOTS: repoRoot, DEVSPACE_STATE_DIR: stateDir, DEVSPACE_CONFIG_DIR: configDir, DEVSPACE_OAUTH_OWNER_TOKEN: ownerToken, DEVSPACE_OAUTH_DEVICE_PEPPER: "device-cli-pepper-012345678901234567890123456789", DEVSPACE_OAUTH_SCOPES: "devspace:read,devspace:write", DEVSPACE_OAUTH_ALLOWED_REDIRECT_HOSTS: "localhost,127.0.0.1", DEVSPACE_TEST_MODE: "true", DEVSPACE_ENV: "staging" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.resume();
  server.stderr?.resume();
  await waitForHealth(server);
  const cli = spawn(process.execPath, [join(repoRoot, "dist", "cli.js"), "auth", "login", "--device", "--server", baseUrl, "--scope", "devspace:read", "--resource", `${baseUrl}/mcp`, "--no-browser"], {
    cwd: repoRoot,
    env: { ...process.env, DEVSPACE_CONFIG_DIR: configDir, DEVSPACE_NO_BROWSER: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  cli.stdout?.on("data", (chunk) => { stdout += String(chunk); });
  cli.stderr?.on("data", (chunk) => { stderr += String(chunk); });
  try {
    const deadline = Date.now() + 30_000;
    let userCode;
    while (Date.now() < deadline && !userCode) {
      const match = stdout.match(/Digite o código:\s*([A-Z2-9]+-[A-Z2-9]+)/);
      if (match) { userCode = match[1]; break; }
      await delay(100);
    }
    assert.ok(userCode, `CLI did not print device code: ${stdout} ${stderr}`);
    const approval = await fetch(`${baseUrl}/oauth/device/approve`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ user_code: userCode, owner_token: ownerToken, decision: "approve" }) });
    assert.equal(approval.status, 303);
    const exitCode = await new Promise((resolve) => cli.once("exit", (code) => resolve(code)));
    assert.equal(exitCode, 0, `${stdout} ${stderr}`);
    assert.match(stdout, /Login concluído/);
    const auth = JSON.parse(await readFile(join(configDir, "auth.json"), "utf8"));
    assert.ok(auth.accessToken);
    assert.equal(auth.ownerToken, undefined);
    assert.equal(auth.server, `${baseUrl}/`);
    assert.equal(auth.resource, `${baseUrl}/mcp`);
    assert.deepEqual(auth.scopes, ["devspace:read"]);
    assert.equal(auth.device_code, undefined);
  } finally {
    await stop(cli);
    await stop(server);
    await rm(stateDir, { recursive: true, force: true });
    await rm(configDir, { recursive: true, force: true });
  }
});
