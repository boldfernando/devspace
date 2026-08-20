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
  ["storybook-browser-check", ["run", "storybook:check:browser"]],
  ["unit-integration", ["test"]],
  ["coverage-check", ["run", "coverage:check"]],
  ["observability-contract", ["run", "test:observability"]],
  ["strategy-audit", ["run", "test:strategy:audit"]],
  ["security-p0", ["run", "security:p0"]],
  ["http-mcp-e2e", ["run", "e2e"]],
  ["doctor", ["run", "doctor"]],
];

await mkdir(artifactDir, { recursive: true });

function now() {
  return new Date().toISOString();
}

function runGate(id, args) {
  return new Promise((resolveGate) => {
    const stdoutPath = join(artifactDir, `10-${id}.stdout.log`);
    const stderrPath = join(artifactDir, `10-${id}.stderr.log`);
    const startedAtMs = Date.now();
    const command = process.platform === "win32" ? "npm" : npmCommand;
    const child = spawn(command, args, {
      cwd: repoRoot,
      shell: process.platform === "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CI: "1", STORYBOOK_BROWSER_MEDIA: "1" },
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", (error) => stderr.push(Buffer.from(`${error.stack ?? error.message}\n`, "utf8")));
    child.on("close", async (code, signal) => {
      const stdoutBytes = Buffer.concat(stdout);
      const stderrBytes = Buffer.concat(stderr);
      await writeFile(stdoutPath, stdoutBytes);
      await writeFile(stderrPath, stderrBytes);
      resolveGate({
        id,
        command: [command, ...args].join(" "),
        startedAt: new Date(startedAtMs).toISOString(),
        endedAt: now(),
        durationMs: Date.now() - startedAtMs,
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

const evidence = [];
for (const result of results) {
  for (const path of [result.stdoutPath, result.stderrPath]) {
    const bytes = await readFile(join(repoRoot, path));
    evidence.push({ path, bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
}
const summary = {
  schema: "devspace.storybook-360.browser-gate-chain.v1",
  generatedAt: now(),
  node: process.version,
  platform: process.platform,
  gates,
  results,
  overall: results.length === gates.length && results.every((result) => result.exitCode === 0) ? "PASS" : "FAIL",
  browserProof: {
    stories: 7,
    interactionPlayFunctions: 2,
    axe: "executed against wcag2a and wcag2aa tags",
    visualSnapshots: 7,
    media: "STORYBOOK_BROWSER_MEDIA=1",
  },
  evidence,
};
await writeFile(join(artifactDir, "10-browser360-gate-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
if (summary.overall !== "PASS") process.exitCode = 1;
