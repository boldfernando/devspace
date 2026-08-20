import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { join, relative, resolve } from "node:path";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const artifactDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const gates = [
  ["lint", ["run", "lint"]],
  ["typecheck", ["run", "typecheck"]],
  ["build", ["run", "build"]],
  ["storybook-check", ["run", "storybook:check"]],
  ["storybook-smoke-render", ["run", "storybook:smoke"]],
  ["unit-integration", ["test"]],
  ["coverage-check", ["run", "coverage:check"]],
  ["observability-contract", ["run", "test:observability"]],
  ["strategy-audit", ["run", "test:strategy:audit"]],
  ["security-p0", ["run", "security:p0"]],
  ["http-mcp-e2e", ["run", "e2e"]],
  ["doctor", ["run", "doctor"]],
];

await mkdir(artifactDir, { recursive: true });

function timestamp() {
  return new Date().toISOString();
}

function runGate(id, args) {
  return new Promise((resolveGate) => {
    const stdoutPath = join(artifactDir, `07-${id}.stdout.log`);
    const stderrPath = join(artifactDir, `07-${id}.stderr.log`);
    const startedAt = Date.now();
    const command = process.platform === "win32" ? "npm" : npmCommand;
    const child = spawn(command, args, {
      cwd: repoRoot,
      windowsHide: true,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CI: "1" },
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      stderr.push(Buffer.from(`${error.stack ?? error.message}\n`, "utf8"));
    });
    child.on("close", async (code, signal) => {
      const stdoutBytes = Buffer.concat(stdout);
      const stderrBytes = Buffer.concat(stderr);
      await writeFile(stdoutPath, stdoutBytes);
      await writeFile(stderrPath, stderrBytes);
      resolveGate({
        id,
        command: [command, ...args].join(" "),
        startedAt: new Date(startedAt).toISOString(),
        endedAt: timestamp(),
        durationMs: Date.now() - startedAt,
        exitCode: code ?? 1,
        signal: signal ?? null,
        stdoutPath: relative(repoRoot, stdoutPath).replaceAll("\\", "/"),
        stderrPath: relative(repoRoot, stderrPath).replaceAll("\\", "/"),
      });
    });
  });
}

const results = [];
for (const [id, args] of gates) {
  const result = await runGate(id, args);
  results.push(result);
  process.stdout.write(`${result.id}: exit=${result.exitCode} duration_ms=${result.durationMs}\n`);
  if (result.exitCode !== 0) break;
}

const allEvidenceFiles = results.flatMap((result) => [result.stdoutPath, result.stderrPath]);
const manifest = [];
for (const relativePath of allEvidenceFiles) {
  const path = join(repoRoot, relativePath);
  const bytes = await readFile(path);
  manifest.push({
    path: relativePath,
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

const summary = {
  schema: "devspace.storybook-360.gate-chain.v1",
  generatedAt: timestamp(),
  repoRoot: ".",
  node: process.version,
  platform: process.platform,
  gates,
  results,
  overall: results.length === gates.length && results.every((result) => result.exitCode === 0) ? "PASS" : "FAIL",
  evidence: manifest,
};
await writeFile(join(artifactDir, "07-gate-chain-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");

if (summary.overall !== "PASS") process.exitCode = 1;
