import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(fileURLToPath(new URL("..", import.meta.url)));
await mkdir(join(repoRoot, "artifacts"), { recursive: true });
const child = spawn(process.execPath, ["--test", "scripts/e2e-http-mcp.test.mjs"], {
  cwd: repoRoot,
  env: { ...process.env, MCP_LOAD_REPORT: process.env.MCP_LOAD_REPORT ?? "artifacts/mcp-load-log.json" },
  stdio: "inherit",
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
