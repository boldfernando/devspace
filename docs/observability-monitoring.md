# DevSpace Monitoring and Logging

## Purpose and boundaries

DevSpace exposes operational visibility for the real HTTP/MCP server without placing credentials, payloads, commands, process output, absolute paths, or raw identifiers in logs, Prometheus labels, dashboards, or evidence artifacts. The implementation separates **liveness**, **readiness**, **request performance**, **tool outcomes**, **authorization failures**, **idempotency state**, **SQLite contention**, and **OAuth Device Flow outcomes**.

The metrics endpoint is intentionally safe to expose only within the operator’s configured network boundary. It contains counters, gauges, and histograms with bounded dimensions; it does not contain bearer tokens, owner tokens, session identifiers, request bodies, paths, or user-agent values.

## Runtime endpoints

| Endpoint | Contract | Intended use |
|---|---|---|
| `/healthz` | Returns HTTP 200 and `{ "ok": true, "name": "devspace" }` when the process is alive. | Liveness probe and process restart detection. |
| `/readyz` | Executes a bounded SQLite `SELECT 1`; returns HTTP 200 when the database is usable and HTTP 503 when the readiness check fails. | Load-balancer readiness and removal from service. |
| `/metrics` | Returns Prometheus text exposition with safe counters, gauges, and histograms. | Prometheus scraping and incident analysis. |
| `/mcp` | Every response receives an `x-request-id`; request duration, status class, outcome, authentication denials, and tool completion metrics are recorded. | Correlation between MCP failures, logs, and performance signals. |

## Metric contract

The labels are deliberately limited to stable operational dimensions. HTTP paths are mapped to `mcp`, `healthz`, `readyz`, `metrics`, or `other`; arbitrary URLs cannot create unbounded label cardinality.

| Metric | Type | Labels | Purpose |
|---|---|---|---|
| `devspace_http_requests_total` | Counter | `route`, `method`, `status_class`, `outcome` | Request volume and 4xx/5xx error rates. |
| `devspace_http_request_duration_ms` | Histogram | `route`, `method` | Request latency and p50/p95/p99 derivation. |
| `devspace_mcp_tool_calls_total` | Counter | `tool`, `outcome` | Tool success/error volume. |
| `devspace_mcp_tool_duration_ms` | Histogram | `tool` | Per-tool latency distribution. |
| `devspace_mcp_auth_denied_total` | Counter | `reason` | Bearer, resource, scope, tool-policy, and session-binding denials. |
| `devspace_health_status` | Gauge | `component` | Current HTTP and database health/readiness state. |
| `mcp_idempotency_*` | Counter/gauge | `tool`, `outcome` | Existing idempotency, fencing, recovery, conflict, and pending-age signals. |
| `sqlite_busy_total` | Counter | `tool` | SQLite lock/contention events. |
| `mcp_oauth_device_event_total` | Counter | `tool`, `outcome` | Device Authorization lifecycle and rate-limit outcomes. |

Histogram buckets are bounded at 5, 10, 25, 50, 100, 250, 500, 1,000, 2,500, 5,000, and 10,000 milliseconds, with an explicit `+Inf` bucket. Values are clamped to a maximum of five minutes to prevent malformed durations from distorting the series.

## Structured logging

The existing structured logger continues to apply field allowlisting and deterministic hashing. Request logs include a correlation `requestId`, method, status, duration, and safe request dimensions. Path, host, origin, referer, user-agent, IP, resource, workspace ID, and working directory are hashed. Tool logs include the safe tool name, success state, duration, error code/category, and retryability. Sensitive keys such as authorization, token, secret, payload, command, stdout, stderr, process characters, edits, raw error messages, and stack traces are dropped.

> A request ID correlates a response, structured log entry, and downstream investigation; it is not an authorization credential and must not be used as one.

## Prometheus alerts and runbooks

| Alert | Initial condition | Operational response |
|---|---|---|
| `DevSpaceHTTPServerErrorRate` | 5xx rate above 5% for five minutes. | Correlate request IDs and error categories; inspect process, filesystem, SQLite, and dependency failures. |
| `DevSpaceMcpToolLatencyHigh` | Tool p95 above 1,000 ms for ten minutes. | Identify the tool label and inspect filesystem, process, SQLite, and concurrent-load evidence. |
| `DevSpaceMcpAuthDeniedBurst` | At least ten denials in five minutes. | Check resource, scope, principal/session binding, client configuration, and possible abuse. |
| `DevSpaceReadinessFailed` | Database readiness gauge is zero for two minutes. | Remove the instance from service and investigate storage, lock, permissions, and recovery state. |
| Existing idempotency alerts | Ambiguous outcomes, lease loss, old pending claims, contention, conflicts, or effect/owner imbalance. | Stop automatic retries where required and run the documented reconciliation or fencing procedure. |
| Existing Device Flow alerts | Slow-down, rejection burst, or expiry. | Check polling behavior, approval latency, resource/scopes, and gateway availability. |

## Operational monitor

The monitor performs a real HTTP probe sequence for each sample: liveness, readiness, unauthenticated MCP, authenticated MCP, and Prometheus metrics. It records per-probe wall time, total wall time, metric-series count, metrics-contract status, slow probes, and a sanitized event classification.

```powershell
$env:MCP_MONITOR_BEARER_TOKEN = "<test-or-operator-token>"
node scripts/mcp-monitor.mjs `
  --base-url http://127.0.0.1:7676 `
  --output artifacts/mcp-monitor.log `
  --samples 20 `
  --interval-ms 1000 `
  --latency-threshold-ms 1000 `
  --fail-on-alert
```

The bearer token is read only from the process environment and is never written to JSONL output. The monitor exits with code 2 when the token is absent or parameters are invalid and exits with code 1 when `--fail-on-alert` is enabled and any sample reports a health, readiness, protocol, authentication, metrics, or performance alert.

## Validation and evidence

The observability contract validator checks all required alerts, all required metric names, the dashboard panel minimum, JSON validity, and secret-like text in Prometheus rules and Grafana queries. The real-server monitor E2E validates two samples against an isolated HTTP/MCP server, including `/readyz`, `/metrics`, Bearer authentication, latency fields, and the absence of bearer-token fields.

Hosted Prometheus/Grafana firing and recovery remain an environment-dependent validation. Local contract validation proves configuration completeness and metric rendering; it does not prove that an external Prometheus server scraped the endpoint or that an alert notification reached an incident channel.
