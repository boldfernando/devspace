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
  const text = metrics.renderPrometheus();
  assert.match(text, /mcp_idempotency_claim_total\{tool="write_file",outcome="owner"\} 1/);
  assert.match(text, /mcp_idempotency_conflict_total\{tool="write_file"\} 1/);
  assert.match(text, /mcp_idempotency_ambiguous_total\{tool="write_file"\} 1/);
  assert.match(text, /mcp_idempotency_lease_lost_total\{tool="write_file"\} 1/);
  assert.match(text, /mcp_idempotency_recovery_total\{tool="write_file",outcome="ambiguous"\} 1/);
  assert.match(text, /mcp_idempotency_pending_age_seconds\{tool="write_file"\} 12\.5/);
  assert.match(text, /sqlite_busy_total\{tool="write_idempotency"\} 1/);
  const samples = text.split("\\n").filter((line) => !line.startsWith("#")).join("\\n");
  assert.doesNotMatch(samples, /payload|token|secret|key-001/);
});

test("runtime metrics sanitize unsafe label values", () => {
  const metrics = createRuntimeMetrics();
  metrics.recordIdempotencyClaim("write file\"\nsecret", "owner");
  const text = metrics.renderPrometheus();
  assert.match(text, /tool="unknown"/);
  assert.doesNotMatch(text, /secret/);
});
