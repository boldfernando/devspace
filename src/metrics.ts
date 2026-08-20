export type IdempotencyClaimOutcome =
  | "owner"
  | "replay"
  | "conflict"
  | "pending"
  | "failed"
  | "ambiguous"
  | "sequence_replay"
  | "sequence_gap";

export type IdempotencyEffectOutcome = "started";
export type OAuthDeviceFlowOutcome =
  | "requested"
  | "pending"
  | "slow_down"
  | "approved"
  | "consumed"
  | "denied"
  | "expired"
  | "rejected"
  | "rate_limited";
export type ToolCallOutcome = "success" | "error";

type CounterKey = string;
type HistogramKey = string;
type MetricSnapshot = {
  counters: Record<CounterKey, number>;
  gauges: Record<CounterKey, number>;
};
type HistogramState = {
  count: number;
  sum: number;
  buckets: Map<number, number>;
};

const SAFE_LABEL = /^[a-zA-Z0-9_.:-]{1,64}$/;
const HISTOGRAM_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000];

function safeLabel(value: string): string {
  return SAFE_LABEL.test(value) ? value : "unknown";
}

function labelsFrom(values: Record<string, string>): string {
  return Object.entries(values)
    .map(([key, value]) => `${key}="${safeLabel(value)}"`)
    .join(",");
}

function labels(tool: string, extra?: Record<string, string>): string {
  return labelsFrom({ tool: safeLabel(tool), ...extra });
}

function metricKey(name: string, labelText: string): string {
  return `${name}{${labelText}}`;
}

function routeLabel(route: string): string {
  const knownRoutes: Record<string, string> = {
    "/mcp": "mcp",
    "/healthz": "healthz",
    "/readyz": "readyz",
    "/metrics": "metrics",
  };
  return knownRoutes[route] ?? "other";
}

function statusClass(status: number): string {
  if (status >= 500 && status <= 599) return "5xx";
  if (status === 401 || status === 403) return "auth_error";
  if (status >= 400 && status <= 499) return "4xx";
  if (status >= 200 && status <= 399) return "2xx";
  return "unknown";
}

function requestOutcome(status: number): string {
  if (status >= 500 && status <= 599) return "server_error";
  if (status === 401 || status === 403) return "auth_error";
  if (status >= 400 && status <= 499) return "client_error";
  if (status >= 200 && status <= 399) return "success";
  return "unavailable";
}

function boundedDuration(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.min(value, 300_000) : 0;
}

function renderCounters(counters: Map<CounterKey, number>, name: string, help: string): string[] {
  return [
    `# HELP ${name} ${help}`,
    `# TYPE ${name} counter`,
    ...Array.from(counters.entries())
      .filter(([key]) => key.startsWith(`${name}{`))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key} ${value}`),
  ];
}

function renderGauges(gauges: Map<CounterKey, number>, name: string, help: string): string[] {
  return [
    `# HELP ${name} ${help}`,
    `# TYPE ${name} gauge`,
    ...Array.from(gauges.entries())
      .filter(([key]) => key.startsWith(`${name}{`))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key} ${value}`),
  ];
}

function renderHistograms(histograms: Map<HistogramKey, HistogramState>, name: string, help: string): string[] {
  const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} histogram`];
  for (const [key, state] of Array.from(histograms.entries()).sort(([left], [right]) => left.localeCompare(right))) {
    const labelsText = key.slice(name.length + 1, -1);
    for (const bucket of HISTOGRAM_BUCKETS) {
      lines.push(`${name}_bucket{${labelsText},le="${bucket}"} ${state.buckets.get(bucket) ?? 0}`);
    }
    lines.push(`${name}_bucket{${labelsText},le="+Inf"} ${state.count}`);
    lines.push(`${name}_sum{${labelsText}} ${state.sum}`);
    lines.push(`${name}_count{${labelsText}} ${state.count}`);
  }
  return lines;
}

export interface RuntimeMetrics {
  recordIdempotencyClaim(tool: string, outcome: IdempotencyClaimOutcome): void;
  recordIdempotencyEffect(tool: string, outcome: IdempotencyEffectOutcome): void;
  recordIdempotencyLeaseLost(tool: string): void;
  recordIdempotencyRecovery(tool: string, outcome: "ambiguous"): void;
  recordIdempotencyPendingAge(tool: string, ageSeconds: number): void;
  recordSqliteBusy(operation: string): void;
  recordOAuthDeviceEvent(outcome: OAuthDeviceFlowOutcome): void;
  recordHttpRequest(route: string, method: string, status: number, durationMs: number): void;
  recordToolCall(tool: string, outcome: ToolCallOutcome, durationMs: number): void;
  recordAuthDenied(reason: string): void;
  recordHealthStatus(component: string, healthy: boolean): void;
  snapshot(): MetricSnapshot;
  renderPrometheus(): string;
}

export function createRuntimeMetrics(): RuntimeMetrics {
  const counters = new Map<CounterKey, number>();
  const gauges = new Map<CounterKey, number>();
  const histograms = new Map<HistogramKey, HistogramState>();

  const increment = (name: string, labelText: string, amount = 1): void => {
    const key = metricKey(name, labelText);
    counters.set(key, (counters.get(key) ?? 0) + amount);
  };

  const setGauge = (name: string, labelText: string, value: number): void => {
    const key = metricKey(name, labelText);
    gauges.set(key, Number.isFinite(value) && value >= 0 ? value : 0);
  };

  const observe = (name: string, labelText: string, value: number): void => {
    const key = metricKey(name, labelText);
    const duration = boundedDuration(value);
    let state = histograms.get(key);
    if (!state) {
      state = { count: 0, sum: 0, buckets: new Map(HISTOGRAM_BUCKETS.map((bucket) => [bucket, 0])) };
      histograms.set(key, state);
    }
    state.count += 1;
    state.sum += duration;
    for (const bucket of HISTOGRAM_BUCKETS) {
      if (duration <= bucket) state.buckets.set(bucket, (state.buckets.get(bucket) ?? 0) + 1);
    }
  };

  return {
    recordIdempotencyClaim(tool, outcome) {
      increment("mcp_idempotency_claim_total", labels(tool, { outcome }));
      if (outcome === "conflict") increment("mcp_idempotency_conflict_total", labels(tool));
      if (outcome === "pending") increment("mcp_idempotency_pending_total", labels(tool));
      if (outcome === "failed") increment("mcp_idempotency_failed_total", labels(tool));
      if (outcome === "ambiguous") increment("mcp_idempotency_ambiguous_total", labels(tool));
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
    recordOAuthDeviceEvent(outcome) {
      increment("mcp_oauth_device_event_total", labels("oauth_device", { outcome }));
    },
    recordHttpRequest(route, method, status, durationMs) {
      const safeRoute = routeLabel(route);
      const safeMethod = safeLabel(method.toUpperCase());
      increment("devspace_http_requests_total", labelsFrom({ route: safeRoute, method: safeMethod, status_class: statusClass(status), outcome: requestOutcome(status) }));
      observe("devspace_http_request_duration_ms", labelsFrom({ route: safeRoute, method: safeMethod }), durationMs);
    },
    recordToolCall(tool, outcome, durationMs) {
      increment("devspace_mcp_tool_calls_total", labels(tool, { outcome }));
      observe("devspace_mcp_tool_duration_ms", labels(tool), durationMs);
    },
    recordAuthDenied(reason) {
      increment("devspace_mcp_auth_denied_total", labelsFrom({ reason: safeLabel(reason) }));
    },
    recordHealthStatus(component, healthy) {
      setGauge("devspace_health_status", labelsFrom({ component: safeLabel(component) }), healthy ? 1 : 0);
    },
    snapshot() {
      return {
        counters: Object.fromEntries(counters.entries()),
        gauges: Object.fromEntries(gauges.entries()),
      };
    },
    renderPrometheus() {
      const lines = [
        ...renderCounters(counters, "mcp_idempotency_claim_total", "Idempotency claims by safe outcome."),
        ...renderCounters(counters, "mcp_idempotency_effect_total", "Idempotency effects started by tool."),
        ...renderCounters(counters, "mcp_idempotency_conflict_total", "Idempotency payload conflicts."),
        ...renderCounters(counters, "mcp_idempotency_pending_total", "Idempotency claims waiting on an existing owner."),
        ...renderCounters(counters, "mcp_idempotency_failed_total", "Idempotency claims that failed."),
        ...renderCounters(counters, "mcp_idempotency_ambiguous_total", "Idempotency outcomes requiring reconciliation."),
        ...renderCounters(counters, "mcp_idempotency_recovery_total", "Idempotency recovery outcomes."),
        ...renderCounters(counters, "mcp_idempotency_lease_lost_total", "Idempotency fencing failures."),
        ...renderCounters(counters, "mcp_oauth_device_event_total", "OAuth Device Flow events by sanitized outcome."),
        ...renderCounters(counters, "sqlite_busy_total", "SQLite busy or locked events."),
        ...renderCounters(counters, "devspace_http_requests_total", "HTTP requests by safe route, method, status class, and outcome."),
        ...renderCounters(counters, "devspace_mcp_tool_calls_total", "MCP tool calls by safe tool and outcome."),
        ...renderCounters(counters, "devspace_mcp_auth_denied_total", "MCP authentication and authorization denials by safe reason."),
        ...renderGauges(gauges, "mcp_idempotency_pending_age_seconds", "Age of the latest pending idempotency claim."),
        ...renderGauges(gauges, "devspace_health_status", "Current health status by safe component."),
        ...renderHistograms(histograms, "devspace_http_request_duration_ms", "HTTP request duration in milliseconds."),
        ...renderHistograms(histograms, "devspace_mcp_tool_duration_ms", "MCP tool execution duration in milliseconds."),
      ];
      return `${lines.join("\n")}\n`;
    },
  };
}
