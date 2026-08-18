import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
function getArg(name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}
const repoRoot = resolve(getArg("--repo", process.cwd()));
const baseUrl = getArg("--base-url", "http://127.0.0.1:7676");
const artifactDir = join(repoRoot, "artifacts", "wave1-p0");
await mkdir(artifactDir, { recursive: true });

function sanitize(text) {
  return text
    .replaceAll(repoRoot, "<repo>")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer <redacted>")
    .replace(/(owner[_-]?token|access[_-]?token|refresh[_-]?token|code[_-]?verifier|device[_-]?code)\s*[:=]\s*[^\s,;]+/gi, "$1=<redacted>")
    .replace(/(authorization|cookie)\s*:\s*[^\n]+/gi, "$1: <redacted>");
}

function runCommand(name, command, args) {
  return new Promise((resolve) => {
    const executable = command === "node" ? process.execPath : (process.platform === "win32" && command === "npm" ? "npm.cmd" : command);
    const started = Date.now();
    const child = spawn(executable, args, { cwd: repoRoot, shell: process.platform === "win32" && command === "npm", env: { ...process.env, CI: "true", DEVSPACE_ENV: "staging", E2E_NEGATIVE_MATRIX: "true" } });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.on("error", (error) => { output += `runner_error=${error.message}`; });
    child.on("close", async (code, signal) => {
      const safeOutput = sanitize(output);
      const logPath = join(artifactDir, `${name}.log`);
      await writeFile(logPath, safeOutput.slice(-12000), "utf8");
      resolve({ name, command: [command, ...args], exit_code: code ?? 1, signal: signal ?? null, status: code === 0 ? "passed" : "failed", duration_ms: Date.now() - started, log: logPath.replaceAll(repoRoot, "<repo>") });
    });
  });
}

const gates = [];
const health = await runCommand("health", "node", ["-e", `fetch(${JSON.stringify(`${baseUrl}/healthz`)}).then(async r=>{if(r.status!==200)process.exit(1);console.log('health=200')}).catch(()=>process.exit(1))`]);
gates.push(health);
const commands = [
  ["typecheck", "npm", ["run", "typecheck"]],
  ["unit-and-contract-tests", "npm", ["test"]],
  ["build", "npm", ["run", "build"]],
  ["observability-contract", "npm", ["run", "test:observability"]],
  ["bundle-audit-tests", "npm", ["run", "test:bundle-audit"]],
  ["bundle-budget", "npm", ["run", "bundle:audit:check"]],
  ["coverage", "npm", ["run", "coverage:check"]],
  ["e2e-http-mcp-positive", "npm", ["run", "e2e"]],
  ["e2e-http-mcp-idempotency", "npm", ["run", "e2e:idempotency"]],
  ["idempotency-p1-matrix", "npm", ["run", "test:idempotency:p1"]],
  ["oauth-device-http", "npm", ["run", "e2e:oauth-device"]],
  ["oauth-device-cli", "npm", ["run", "e2e:oauth-device-cli"]],
  ["oauth-mcp-negative-p0", "npm", ["run", "security:p0"]],
  ["doctor", "node", ["dist/cli.js", "doctor"]],
  ["canonical-self-scan", "npm", ["run", "prd:reverse"]],
];
for (const [name, command, args] of commands) gates.push(await runCommand(name, command, args));

const summary = {
  schema: "devspace.wave1-p0.v1",
  status: gates.every((gate) => gate.status === "passed") ? "passed" : "failed",
  started_at: new Date().toISOString(),
  repository: "devspace",
  branch: process.env.GITHUB_REF_NAME ?? "local",
  gates,
  required_domains: ["discovery", "build", "oauth-pkce", "bearer", "mcp-session", "negative-security", "idempotency", "device-flow", "observability", "bundle", "coverage", "doctor", "canonical-scan"],
  idempotency_validation: {
    required_cases: ["IDEMP-P1-001", "IDEMP-P1-002", "IDEMP-P1-003", "IDEMP-P1-004", "IDEMP-P1-005", "IDEMP-P1-006", "IDEMP-P1-007", "IDEMP-P1-008"],
    real_http_mcp: true,
    secret_scan_required: true,
  },
};
await writeFile(join(artifactDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: summary.status, gates: gates.length, failed: gates.filter((gate) => gate.status !== "passed").map((gate) => gate.name), artifact: "artifacts/wave1-p0/summary.json" }));
if (summary.status !== "passed") process.exitCode = 1;
