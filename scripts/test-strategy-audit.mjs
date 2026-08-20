import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { parse as parseYaml } from "yaml";

const repoRoot = process.env.DEVSPACE_REPO_ROOT ?? process.cwd();
const outputPath = process.env.TEST_STRATEGY_REPORT ?? join(repoRoot, "artifacts", "test-strategy-report.json");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function listFiles(root, predicate) {
  const results = [];
  async function walk(directory) {
    for (const entry of await (await import("node:fs/promises")).readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (predicate(path)) results.push(path);
    }
  }
  if (existsSync(root)) await walk(root);
  return results.sort();
}

function repoPath(path) {
  return relative(repoRoot, path).split(sep).join("/");
}

function commandAvailable(scripts, name) {
  return typeof scripts[name] === "string";
}

function classifyTest(path) {
  const normalized = repoPath(path);
  if (normalized.startsWith("src/")) return "unit_contract";
  if (/e2e|wave|chaos|swarm|load|negative/i.test(normalized)) return "end_to_end";
  return "integration_contract";
}

function coverageThresholds(command) {
  const read = (name) => Number(command.match(new RegExp(`--${name}=(\\d+)`))?.[1] ?? 0);
  return {
    lines: read("lines"),
    functions: read("functions"),
    branches: read("branches"),
    statements: read("statements"),
  };
}

function gitCommit() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "UNKNOWN";
}

const packageJson = await readJson(join(repoRoot, "package.json"));
const workflowText = await readFile(join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");
const workflow = parseYaml(workflowText);
const sourceTests = await listFiles(join(repoRoot, "src"), (path) => path.endsWith(".test.ts"));
const scriptTests = await listFiles(join(repoRoot, "scripts"), (path) => path.endsWith(".test.mjs"));
const runners = await listFiles(join(repoRoot, "scripts"), (path) => /(?:e2e|wave|chaos|swarm|load)/i.test(path) && path.endsWith(".mjs"));
const coveragePath = join(repoRoot, "coverage", "coverage-summary.json");
const coverage = existsSync(coveragePath) ? await readJson(coveragePath) : undefined;
const coverageModules = coverage
  ? Object.entries(coverage)
    .filter(([path]) => path !== "total")
    .map(([path, value]) => ({
      file: repoPath(path),
      lines: value.lines.pct,
      functions: value.functions.pct,
      branches: value.branches.pct,
      line_total: value.lines.total,
    }))
    .filter((module) => module.line_total >= 40)
    .sort((a, b) => a.lines - b.lines)
  : [];
const smokeSteps = workflow?.jobs?.smoke?.steps ?? [];
const stepNames = smokeSteps.map((step) => step.name).filter(Boolean);
const scriptNames = Object.keys(packageJson.scripts ?? {});
const report = {
  schema: "devspace.test-strategy.v1",
  generated_at: new Date().toISOString(),
  repository: repoPath(repoRoot),
  commit: gitCommit(),
  inventory: {
    source_unit_contract_files: sourceTests.length,
    script_e2e_integration_files: scriptTests.length,
    executable_runner_files: runners.length,
    by_layer: {
      unit_contract: sourceTests.length,
      integration_contract: scriptTests.filter((path) => classifyTest(path) === "integration_contract").length,
      end_to_end: scriptTests.filter((path) => classifyTest(path) === "end_to_end").length,
    },
  },
  package_gates: {
    test: commandAvailable(packageJson.scripts, "test"),
    coverage_check: commandAvailable(packageJson.scripts, "coverage:check"),
    build: commandAvailable(packageJson.scripts, "build"),
    security_p0: commandAvailable(packageJson.scripts, "security:p0"),
    observability: commandAvailable(packageJson.scripts, "test:observability"),
    swarm_resilience: commandAvailable(packageJson.scripts, "e2e:swarm:resilience"),
    swarm_chaos: commandAvailable(packageJson.scripts, "e2e:swarm:chaos"),
    coverage_thresholds: coverageThresholds(packageJson.scripts?.["coverage:check"] ?? ""),
    names: scriptNames,
  },
  ci: {
    workflow: ".github/workflows/ci.yml",
    smoke_matrix: workflow?.jobs?.smoke?.strategy?.matrix?.os ?? [],
    staging_load_present: Boolean(workflow?.jobs?.["staging-load"]),
    smoke_step_count: smokeSteps.length,
    critical_step_names: stepNames.filter((name) => /test|build|e2e|oauth|idempot|coverage|security|swarm|doctor|bundle/i.test(name)),
  },
  coverage: coverage?.total ?? null,
  coverage_hotspots: coverageModules.slice(0, 15),
  strategy_gaps: {
    npm_test_is_not_real_http_mcp: true,
    real_http_mcp_is_executed_by_separate_ci_steps: true,
    hosted_alert_firing_requires_external_environment: true,
    full_os_matrix_for_all_chaos_and_swarm_runners: false,
    browser_host_visual_trace_is_not_asserted_by_node_contracts: true,
  },
  evidence: {
    report_is_sanitized: true,
    source_tests: sourceTests.map(repoPath),
    script_tests: scriptTests.map(repoPath),
    runners: runners.map(repoPath),
  },
};

await mkdir(join(repoRoot, "artifacts"), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
console.log(JSON.stringify({ schema: report.schema, status: "passed", output: repoPath(outputPath), inventory: report.inventory, coverage: report.coverage, hotspots: report.coverage_hotspots.slice(0, 5) }));
