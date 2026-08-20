#!/usr/bin/env node
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const argv = process.argv.slice(2);
function getArg(name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : fallback;
}

const baseUrl = getArg("--base-url", process.env.MCP_MONITOR_BASE_URL ?? process.env.MCP_MONITOR_URL ?? "http://127.0.0.1:7676").replace(/\/$/, "");
const safeBaseUrl = (() => {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return "invalid";
  }
})();
const outputPath = getArg("--output", process.env.MCP_MONITOR_OUTPUT ?? process.env.MCP_MONITOR_LOG ?? "artifacts/mcp-monitor.log");
const samples = Math.max(0, Number(getArg("--samples", process.env.MCP_MONITOR_SAMPLES ?? "0")));
const intervalMs = Math.max(250, Number(getArg("--interval-ms", process.env.MCP_MONITOR_INTERVAL_MS ?? "60000")));
const latencyThresholdMs = Math.max(1, Number(getArg("--latency-threshold-ms", process.env.MCP_MONITOR_LATENCY_THRESHOLD_MS ?? "1000")));
const failOnAlert = argv.includes("--fail-on-alert");
const bearerToken = process.env.MCP_MONITOR_BEARER_TOKEN;
const schema = "devspace.mcp-monitor.v1";

if (!Number.isInteger(samples) || !Number.isInteger(intervalMs) || !Number.isFinite(latencyThresholdMs)) {
  console.error("invalid_monitor_parameters");
  process.exit(2);
}
if (!bearerToken) {
  const record = {
    schema,
    event: "configuration_error",
    reason: "bearer_token_required_via_environment",
    baseUrl: safeBaseUrl,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await appendFile(outputPath, `${JSON.stringify(record)}\n`, "utf8");
  console.error("monitor_configuration_error");
  process.exit(2);
}

function rpcBody(id) {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "devspace-mcp-monitor", version: "1.0.0" },
    },
  });
}

async function probeStatus(url, options = {}, readText = false) {
  const started = performance.now();
  try {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(5000) });
    const text = readText ? await response.text() : undefined;
    return {
      status: response.status,
      wallMs: Math.round(performance.now() - started),
      ...(readText ? { text } : {}),
    };
  } catch {
    return { status: 0, wallMs: Math.round(performance.now() - started) };
  }
}

async function probe(sample) {
  const started = performance.now();
  const health = await probeStatus(`${baseUrl}/healthz`);
  const ready = await probeStatus(`${baseUrl}/readyz`);
  const unauthenticated = await probeStatus(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { Accept: "application/json, text/event-stream", "content-type": "application/json" },
    body: rpcBody(9001),
  });
  const authenticated = await probeStatus(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      Accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: rpcBody(9002),
  });
  const metrics = await probeStatus(`${baseUrl}/metrics`, {}, true);
  const metricsText = metrics.text ?? "";
  const metricsContractOk = metrics.status === 200
    && metricsText.includes("devspace_http_requests_total")
    && metricsText.includes("devspace_mcp_tool_duration_ms");
  const slowProbes = [
    ["health", health.wallMs],
    ["ready", ready.wallMs],
    ["unauthenticated_mcp", unauthenticated.wallMs],
    ["authenticated_mcp", authenticated.wallMs],
    ["metrics", metrics.wallMs],
  ].filter(([, wallMs]) => wallMs > latencyThresholdMs).map(([probeName, wallMs]) => ({ probe: probeName, wallMs }));
  const event = health.status !== 200
    ? "health_alert"
    : ready.status !== 200
      ? "readiness_alert"
      : unauthenticated.status !== 401
        ? "protocol_alert"
        : authenticated.status !== 200
          ? "bearer_auth_alert"
          : !metricsContractOk
            ? "metrics_alert"
            : slowProbes.length > 0
              ? "performance_alert"
              : "mcp_monitor_ok";
  return {
    schema,
    ts: new Date().toISOString(),
    sample,
    event,
    healthStatus: health.status,
    readyStatus: ready.status,
    unauthenticatedStatus: unauthenticated.status,
    authenticatedStatus: authenticated.status,
    metricsStatus: metrics.status,
    metricsSeriesCount: metricsText.split("\n").filter((line) => line && !line.startsWith("#")).length,
    metricsContractOk,
    healthWallMs: health.wallMs,
    readyWallMs: ready.wallMs,
    unauthenticatedWallMs: unauthenticated.wallMs,
    authenticatedWallMs: authenticated.wallMs,
    metricsWallMs: metrics.wallMs,
    wallMs: Math.round(performance.now() - started),
    latencyThresholdMs,
    slowProbes,
    baseUrl: safeBaseUrl,
  };
}

await mkdir(dirname(outputPath), { recursive: true });
let alertCount = 0;
let sample = 0;
while (samples === 0 || sample < samples) {
  sample += 1;
  const record = await probe(sample);
  await appendFile(outputPath, `${JSON.stringify(record)}\n`, "utf8");
  console.log(JSON.stringify(record));
  if (record.event !== "mcp_monitor_ok") alertCount += 1;
  if (samples !== 0 && sample >= samples) break;
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}
if (failOnAlert && alertCount > 0) process.exitCode = 1;
