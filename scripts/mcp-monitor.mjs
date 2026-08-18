#!/usr/bin/env node
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const argv = process.argv.slice(2);
function getArg(name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : fallback;
}

const baseUrl = getArg("--base-url", process.env.MCP_MONITOR_BASE_URL ?? process.env.MCP_MONITOR_URL ?? "http://127.0.0.1:7676").replace(/\/$/, "");
const outputPath = getArg("--output", process.env.MCP_MONITOR_OUTPUT ?? process.env.MCP_MONITOR_LOG ?? "artifacts/mcp-monitor.log");
const samples = Math.max(0, Number(getArg("--samples", process.env.MCP_MONITOR_SAMPLES ?? "0")));
const intervalMs = Math.max(250, Number(getArg("--interval-ms", process.env.MCP_MONITOR_INTERVAL_MS ?? "60000")));
const failOnAlert = argv.includes("--fail-on-alert");
const bearerToken = process.env.MCP_MONITOR_BEARER_TOKEN;
const schema = "devspace.mcp-monitor.v1";

if (!Number.isInteger(samples) || !Number.isInteger(intervalMs)) {
  console.error("invalid_monitor_parameters");
  process.exit(2);
}
if (!bearerToken) {
  const record = {
    schema,
    event: "configuration_error",
    reason: "bearer_token_required_via_environment",
    baseUrl,
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

async function statusOf(url, options = {}) {
  try {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(5000) });
    return response.status;
  } catch {
    return 0;
  }
}

async function probe(sample) {
  const started = performance.now();
  const healthStatus = await statusOf(`${baseUrl}/healthz`);
  const unauthenticatedStatus = await statusOf(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { Accept: "application/json, text/event-stream", "content-type": "application/json" },
    body: rpcBody(9001),
  });
  const authenticatedStatus = await statusOf(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      Accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: rpcBody(9002),
  });
  const event = healthStatus !== 200
    ? "health_alert"
    : unauthenticatedStatus !== 401
      ? "protocol_alert"
      : authenticatedStatus !== 200
        ? "bearer_auth_alert"
        : "mcp_monitor_ok";
  return {
    schema,
    ts: new Date().toISOString(),
    sample,
    event,
    healthStatus,
    unauthenticatedStatus,
    authenticatedStatus,
    wallMs: Math.round(performance.now() - started),
    baseUrl,
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
