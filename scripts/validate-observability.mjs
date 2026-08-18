import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const rulesPath = join(repoRoot, "observability", "prometheus-idempotency-alerts.yml");
const dashboardPath = join(repoRoot, "observability", "grafana-idempotency-dashboard.json");
const reportPath = join(repoRoot, "artifacts", "observability-contract-report.json");

const [rules, dashboardText] = await Promise.all([
  readFile(rulesPath, "utf8"),
  readFile(dashboardPath, "utf8"),
]);
const dashboard = JSON.parse(dashboardText);

const requiredAlerts = [
  "DevSpaceIdempotencyAmbiguousOutcome",
  "DevSpaceIdempotencyLeaseLost",
  "DevSpaceIdempotencyPendingTooOld",
  "DevSpaceSQLiteContention",
  "DevSpaceIdempotencyEffectsExceedOwners",
  "DevSpaceIdempotencyConflictBurst",
  "DevSpaceOAuthDeviceSlowDown",
  "DevSpaceOAuthDeviceRejected",
  "DevSpaceOAuthDeviceExpired",
];
const requiredMetrics = [
  "mcp_idempotency_claim_total",
  "mcp_idempotency_effect_total",
  "mcp_idempotency_conflict_total",
  "mcp_idempotency_ambiguous_total",
  "mcp_idempotency_lease_lost_total",
  "mcp_idempotency_pending_age_seconds",
  "mcp_idempotency_recovery_total",
  "sqlite_busy_total",
  "mcp_oauth_device_event_total",
];
const secretLike = /(bearer\s+|owner[_-]?token|access[_-]?token|code[_-]?verifier|device[_-]?code|secret\s*[:=])/i;
const missingAlerts = requiredAlerts.filter((name) => !rules.includes(`alert: ${name}`));
const missingMetrics = requiredMetrics.filter((name) => !rules.includes(name) && !dashboardText.includes(name));
const panels = Array.isArray(dashboard.panels) ? dashboard.panels : [];
const dashboardMetrics = requiredMetrics.filter((name) => dashboardText.includes(name));
const findings = [];
if (missingAlerts.length) findings.push(`missing_alerts:${missingAlerts.join(",")}`);
if (missingMetrics.length) findings.push(`missing_metrics:${missingMetrics.join(",")}`);
if (panels.length < 5) findings.push("dashboard_panels_below_minimum");
if (secretLike.test(rules) || secretLike.test(dashboardText)) findings.push("secret_like_value_detected");

const report = {
  schema: "devspace.observability-contract.v1",
  status: findings.length === 0 ? "passed" : "failed",
  required_alerts: requiredAlerts.length,
  observed_alerts: requiredAlerts.length - missingAlerts.length,
  required_metrics: requiredMetrics.length,
  observed_metrics: requiredMetrics.length - missingMetrics.length,
  dashboard_panels: panels.length,
  secret_leak_detected: secretLike.test(rules) || secretLike.test(dashboardText),
  findings,
};
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report));
if (report.status !== "passed") process.exitCode = 1;
