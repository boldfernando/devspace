#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.argv[2] ?? process.cwd();
const errors = [];
const load = async (name) => {
  try { return JSON.parse(await readFile(join(root, name), "utf8")); }
  catch (error) { errors.push(`${name}: ${error.message}`); return null; }
};
const workgraph = await load("v4-workgraph.json");
const buildbacks = await load("v4-buildbacks.json");
const plane = await load("PLANE-STATE.json");
const reconcile = await load("RECONCILIATION.json");
const conflict = await load("CONFLICT-GRAPH.json");
const addresses = await load("AGENT-ADDRESSES.json");
const h2a = JSON.parse(await readFile(join(root, "06-h2a-interaction.json"), "utf8"));
const a2a = JSON.parse(await readFile(join(root, "05-a2a-local-evidence.json"), "utf8"));
if (workgraph) {
  const ids = new Set(workgraph.tasks.map((task) => task.task_id));
  for (const task of workgraph.tasks) {
    for (const dep of task.dependencies) if (!ids.has(dep)) errors.push(`unresolved dependency: ${task.task_id}->${dep}`);
    if (!task.claims?.length) errors.push(`missing claims: ${task.task_id}`);
    if (!task.mode) errors.push(`missing mode: ${task.task_id}`);
  }
  const waveIds = (conflict?.waves ?? []).flat();
  if (new Set(waveIds).size !== waveIds.length) errors.push("duplicate task in conflict waves");
  if (waveIds.length !== workgraph.tasks.length) errors.push("conflict waves do not cover all tasks");
}
if (buildbacks) for (const b of buildbacks.buildbacks) for (const field of ["buildback_id", "baseline_sha", "state", "tasks"]) if (!(field in b)) errors.push(`buildback missing ${field}`);
if (plane?.secrets_included !== false) errors.push("plane state secret flag is not false");
if (reconcile?.leases?.acquisition_failures !== 0) errors.push("lease acquisition failures present");
if (h2a.state !== "DRAFT") errors.push(`H2A state must remain DRAFT, got ${h2a.state}`);
if (a2a.interop_record?.status !== "NOT_READY") errors.push("A2A status must remain NOT_READY without remote card");
if (addresses && new Set(addresses.map((x) => x.address)).size !== addresses.length) errors.push("duplicate agent address");
const result = { schema: "devspace.canonical-platform-review-360-v4/artifact-gate.v1", status: errors.length ? "FAIL" : "PASS", errors, checked: ["v4-workgraph.json", "v4-buildbacks.json", "PLANE-STATE.json", "RECONCILIATION.json", "CONFLICT-GRAPH.json", "AGENT-ADDRESSES.json", "06-h2a-interaction.json", "05-a2a-local-evidence.json"] };
console.log(JSON.stringify(result, null, 2));
process.exit(errors.length ? 1 : 0);
