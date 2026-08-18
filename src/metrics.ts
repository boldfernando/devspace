export type IdempotencyClaimOutcome =
  | "owner"
  | "replay"
  | "conflict"
  | "pending"
  | "failed"
  | "ambiguous";

export type IdempotencyEffectOutcome = "started";

type CounterKey = string;

type MetricSnapshot = {
  counters: Record<CounterKey, number>;
  gauges: Record<CounterKey, number>;
};

const SAFE_LABEL = /^[a-zA-Z0-9_.:-]{1,64}$/;

function safeLabel(value: string): string {
  return SAFE_LABEL.test(value) ? value : "unknown";
}

function labels(tool: string, extra?: Record<string, string>): string {
  const values = { tool: safeLabel(tool), ...extra };
  return Object.entries(values)
    .map(([key, value]) => `${key}="${safeLabel(value)}"`)
    .join(",");
}

function metricKey(name: string, labelText: string): string {
  return `${name}{${labelText}}`;
}

export interface RuntimeMetrics {
  recordIdempotencyClaim(tool: string, outcome: IdempotencyClaimOutcome): void;
  recordIdempotencyEffect(tool: string, outcome: IdempotencyEffectOutcome): void;
  recordIdempotencyLeaseLost(tool: string): void;
  recordIdempotencyRecovery(tool: string, outcome: "ambiguous"): void;
  recordIdempotencyPendingAge(tool: string, ageSeconds: number): void;
  recordSqliteBusy(operation: string): void;
  snapshot(): MetricSnapshot;
  renderPrometheus(): string;
}

export function createRuntimeMetrics(): RuntimeMetrics {
  const counters = new Map<CounterKey, number>();
  const gauges = new Map<CounterKey, number>();

  const increment = (name: string, labelText: string, amount = 1): void => {
    const key = metricKey(name, labelText);
    counters.set(key, (counters.get(key) ?? 0) + amount);
  };

  const setGauge = (name: string, labelText: string, value: number): void => {
    const key = metricKey(name, labelText);
    gauges.set(key, Number.isFinite(value) && value >= 0 ? value : 0);
  };

  return {
    recordIdempotencyClaim(tool, outcome) {
      increment("mcp_idempotency_claim_total", labels(tool, { outcome }));
      if (outcome === "conflict") {
        increment("mcp_idempotency_conflict_total", labels(tool));
      }
      if (outcome === "pending") {
        increment("mcp_idempotency_pending_total", labels(tool));
      }
      if (outcome === "failed") {
        increment("mcp_idempotency_failed_total", labels(tool));
      }
      if (outcome === "ambiguous") {
        increment("mcp_idempotency_ambiguous_total", labels(tool));
      }
    },
    recordIdempotencyEffect(tool, outcome) {
      increment("mcp_idempotency_effect_total", labels(tool, { outcome }));
    },
    recordIdempotencyLeaseLost(tool) {
      increment("mcp_idempotency_lease_lost_total", labels(tool));
    },
    recordIdempotencyRecovery(tool, outcome) {
      increment("mcp_idempotency_recovery_total", labels(tool, { outcome }));
    },
    recordIdempotencyPendingAge(tool, ageSeconds) {
      setGauge("mcp_idempotency_pending_age_seconds", labels(tool), ageSeconds);
    },
    recordSqliteBusy(operation) {
      increment("sqlite_busy_total", labels(operation));
    },
    snapshot() {
      return {
        counters: Object.fromEntries(counters.entries()),
        gauges: Object.fromEntries(gauges.entries()),
      };
    },
    renderPrometheus() {
      const lines = [
        "# HELP mcp_idempotency_claim_total Idempotency claims by safe outcome.",
        "# TYPE mcp_idempotency_claim_total counter",
        ...Array.from(counters.entries())
          .filter(([key]) => key.startsWith("mcp_idempotency_claim_total{"))
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value]) => `${key} ${value}`),
        "# HELP mcp_idempotency_effect_total Idempotency effects started by tool.",
        "# TYPE mcp_idempotency_effect_total counter",
        ...Array.from(counters.entries())
          .filter(([key]) => key.startsWith("mcp_idempotency_effect_total{"))
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value]) => `${key} ${value}`),
        "# HELP mcp_idempotency_conflict_total Idempotency payload conflicts.",
        "# TYPE mcp_idempotency_conflict_total counter",
        ...Array.from(counters.entries())
          .filter(([key]) => key.startsWith("mcp_idempotency_conflict_total{"))
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value]) => `${key} ${value}`),
        "# HELP mcp_idempotency_ambiguous_total Idempotency outcomes requiring reconciliation.",
        "# TYPE mcp_idempotency_ambiguous_total counter",
        ...Array.from(counters.entries())
          .filter(([key]) => key.startsWith("mcp_idempotency_ambiguous_total{"))
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value]) => `${key} ${value}`),
        "# HELP mcp_idempotency_recovery_total Idempotency recovery outcomes.",
        "# TYPE mcp_idempotency_recovery_total counter",
        ...Array.from(counters.entries())
          .filter(([key]) => key.startsWith("mcp_idempotency_recovery_total{"))
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value]) => `${key} ${value}`),
        "# HELP mcp_idempotency_lease_lost_total Idempotency fencing failures.",
        "# TYPE mcp_idempotency_lease_lost_total counter",
        ...Array.from(counters.entries())
          .filter(([key]) => key.startsWith("mcp_idempotency_lease_lost_total{"))
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value]) => `${key} ${value}`),
        "# HELP sqlite_busy_total SQLite busy or locked events.",
        "# TYPE sqlite_busy_total counter",
        ...Array.from(counters.entries())
          .filter(([key]) => key.startsWith("sqlite_busy_total{"))
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value]) => `${key} ${value}`),
        "# HELP mcp_idempotency_pending_age_seconds Age of the latest pending claim.",
        "# TYPE mcp_idempotency_pending_age_seconds gauge",
        ...Array.from(gauges.entries())
          .filter(([key]) => key.startsWith("mcp_idempotency_pending_age_seconds{"))
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value]) => `${key} ${value}`),
      ];
      return `${lines.join("\n")}\n`;
    },
  };
}
