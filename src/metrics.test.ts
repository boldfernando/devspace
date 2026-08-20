import assert from "node:assert/strict";
import test from "node:test";
import { createRuntimeMetrics } from "./metrics.js";

test("runtime metrics render safe dimensions and stable Prometheus names", () => {
  const metrics = createRuntimeMetrics();
  metrics.recordIdempotencyClaim("write_file", "owner");
  metrics.recordIdempotencyClaim("write_file", "conflict");
  metrics.recordIdempotencyClaim("write_file", "ambiguous");
  metrics.recordIdempotencyEffect("write_file", "started");
  metrics.recordIdempotencyLeaseLost("write_file");
  metrics.recordIdempotencyRecovery("write_file", "ambiguous");
  metrics.recordIdempotencyPendingAge("write_file", 12.5);
  metrics.recordSqliteBusy("write_idempotency");
  metrics.recordOAuthDeviceEvent("requested");
  metrics.recordOAuthDeviceEvent("pending");
  metrics.recordOAuthDeviceEvent("consumed");
  metrics.recordHttpRequest("/mcp", "post", 200, 42);
  metrics.recordHttpRequest("/mcp", "post", 401, 7);
  metrics.recordToolCall("write_file", "success", 125);
  metrics.recordToolCall("write_file", "error", 2_500);
  metrics.recordAuthDenied("invalid_oauth_resource");
  metrics.recordHealthStatus("mcp", true);
  const text = metrics.renderPrometheus();
  assert.match(text, /mcp_idempotency_claim_total\{tool="write_file",outcome="owner"\} 1/);
  assert.match(text, /mcp_idempotency_conflict_total\{tool="write_file"\} 1/);
  assert.match(text, /mcp_idempotency_ambiguous_total\{tool="write_file"\} 1/);
  assert.match(text, /mcp_idempotency_lease_lost_total\{tool="write_file"\} 1/);
  assert.match(text, /mcp_idempotency_recovery_total\{tool="write_file",outcome="ambiguous"\} 1/);
  assert.match(text, /mcp_idempotency_pending_age_seconds\{tool="write_file"\} 12\.5/);
  assert.match(text, /sqlite_busy_total\{tool="write_idempotency"\} 1/);
  assert.match(text, /mcp_oauth_device_event_total\{tool="oauth_device",outcome="pending"\} 1/);
  assert.match(text, /mcp_oauth_device_event_total\{tool="oauth_device",outcome="requested"\} 1/);
    assert.match(text, /mcp_oauth_device_event_total\{tool="oauth_device",outcome="consumed"\} 1/);
  assert.match(text, /devspace_http_requests_total\{route="mcp",method="POST",status_class="2xx",outcome="success"\} 1/);
  assert.match(text, /devspace_http_requests_total\{route="mcp",method="POST",status_class="auth_error",outcome="auth_error"\} 1/);
  assert.match(text, /devspace_mcp_tool_calls_total\{tool="write_file",outcome="success"\} 1/);
  assert.match(text, /devspace_mcp_tool_calls_total\{tool="write_file",outcome="error"\} 1/);
  assert.match(text, /devspace_mcp_auth_denied_total\{reason="invalid_oauth_resource"\} 1/);
  assert.match(text, /devspace_health_status\{component="mcp"\} 1/);
  assert.match(text, /devspace_http_request_duration_ms_bucket\{route="mcp",method="POST",le="50"\} 2/);
  assert.match(text, /devspace_mcp_tool_duration_ms_bucket\{tool="write_file",le="2500"\} 2/);

  const samples = text.split("\n").filter((line) => !line.startsWith("#")).join("\n");
  assert.doesNotMatch(samples, /payload|token|secret|key-001/);
  assert.doesNotMatch(samples, /authorization|bearer|workspace-id|unsafe/);

});

test("runtime metrics sanitize unsafe label values", () => {
  const metrics = createRuntimeMetrics();
    metrics.recordIdempotencyClaim("write file\"\nsecret", "owner");
  metrics.recordHttpRequest("/mcp\" secret", "post\n", 503, -1);
  metrics.recordToolCall("bash token=secret", "error", Number.NaN);
  metrics.recordAuthDenied("reason with spaces");
  const text = metrics.renderPrometheus();
  const samples = text.split("\n").filter((line) => !line.startsWith("#")).join("\n");

  assert.match(samples, /tool="unknown"/);
  assert.doesNotMatch(samples, /secret/);
  assert.doesNotMatch(samples, /token|bearer|authorization/);

});
