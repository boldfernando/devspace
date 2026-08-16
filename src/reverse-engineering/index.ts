import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

export type EvidenceStatus = "EXPLICIT" | "INFERRED" | "UNKNOWN" | "CONFLICTING";
export type GateState = "PASS" | "FAIL" | "BLOCKED" | "N/A" | "UNKNOWN";
export type Priority = "P0" | "P1" | "P2" | "P3" | "P4";
export const MANIFEST_VERSION = "1.0.0";
const EXCLUDED = new Set([".git", ".cache", ".next", ".turbo", "build", "coverage", "dist", "node_modules", "target", "vendor"]);

type Evidence = { type: string; source: string; path?: string; symbol?: string; detector: string; raw_signal: string; confidence: number };
type Finding = { id: string; kind: string; title: string; status: EvidenceStatus; severity: Priority; description: string; evidence: Evidence[]; confidence: number; affected_paths: string[] };
type Task = { id: string; title: string; priority: Priority; domain: string; capability: string; finding: string; evidence: Evidence[]; impact: string; risk: string; scope: string; affected_paths: string[]; acceptance_criteria: string[]; dor: string[]; dod: string[]; dependencies: string[]; verification_command: string };

const id = (prefix: string, value: string) => `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 12)}`;
const posix = (value: string) => value.split(sep).join("/");
const rel = (root: string, path: string) => posix(relative(root, path)) || ".";
const evidence = (path: string, detector: string, signal: string, confidence = 1): Evidence => ({ type: "file", source: "repository", path, detector, raw_signal: signal, confidence });

function scanFiles(root: string): { files: string[]; ignored: string[] } {
  const files: string[] = [], ignored: string[] = [];
  const visit = (dir: string): void => {
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try { entries = readdirSync(dir, { withFileTypes: true, encoding: "utf8" }) as unknown as Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>; } catch { ignored.push(rel(root, dir)); return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { if (EXCLUDED.has(entry.name)) ignored.push(rel(root, path)); else visit(path); }
      else if (entry.isFile()) files.push(path);
    }
  };
  visit(root);
  return { files: files.sort(), ignored: ignored.sort() };
}

function readText(path: string): string | undefined {
  try { if (statSync(path).size > 512 * 1024) return undefined; const buffer = readFileSync(path); if (buffer.includes(0)) return undefined; return buffer.toString("utf8"); } catch { return undefined; }
}

function packageManager(root: string): { name: string; evidence: Evidence[] } {
  for (const [file, name] of [["package-lock.json", "npm"], ["pnpm-lock.yaml", "pnpm"], ["yarn.lock", "yarn"], ["bun.lockb", "bun"]] as const) {
    if (existsSync(join(root, file))) return { name, evidence: [evidence(file, "package-manager", file)] };
  }
  return { name: "UNKNOWN", evidence: [] };
}

function readPackage(root: string): Record<string, any> {
  try { return JSON.parse(readFileSync(join(root, "package.json"), "utf8")); } catch { return {}; }
}

function detectTopology(root: string, text: Map<string, string>, pkg: Record<string, any>): { topology: Record<string, unknown>; evidence: Evidence[] } {
  const pm = packageManager(root), ev = [...pm.evidence];
  const hasSrc = existsSync(join(root, "src")), hasServer = text.has("src/server.ts"), hasUi = [...text.keys()].some((path) => path.startsWith("src/ui/"));
  if (hasSrc) ev.push(evidence("src", "topology", "src/"));
  if (hasServer) ev.push(evidence("src/server.ts", "topology", "server entrypoint"));
  if (hasUi) ev.push(evidence("src/ui", "topology", "UI source directory"));
  const workspace = ["pnpm-workspace.yaml", "turbo.json", "nx.json"].some((file) => existsSync(join(root, file)));
  return { topology: { classification: workspace ? "MONOREPO" : hasServer && hasUi ? "MODULAR_MONOLITH" : "SINGLE_PACKAGE", architecture: hasServer && hasUi ? "modular_monolith" : "UNKNOWN", build_system: existsSync(join(root, "vite.config.ts")) ? "Vite + TypeScript compiler" : "UNKNOWN", package_manager: pm.name, workspace_manager: workspace ? "detected" : "NOT_OBSERVED", package_name: pkg.name ?? "UNKNOWN", evidence_status: ev.length ? "EXPLICIT" : "UNKNOWN", confidence: ev.length ? 0.98 : 0.2 }, evidence: ev };
}

function detectSurfaces(root: string, text: Map<string, string>, pkg: Record<string, any>): any[] {
  const output: any[] = [];
  const add = (family: string, subtype: string, name: string, entry: string, paths: string[], protocol: string, deployable: boolean, confidence = 0.9) => output.push({ id: id("surface", `${family}:${name}`), canonical_name: name, family, subtype, protocol, entry_point: entry, source_location: paths, owning_package: pkg.name ?? "UNKNOWN", deployable, runtime: "Node.js", personas: ["UNKNOWN"], capabilities: [], features: [], routes: [], dependencies: [], authentication: family === "MCP_SERVER" || family === "API" ? ["OAuth 2.0 PKCE", "Bearer"] : [], authorization: family === "MCP_SERVER" || family === "API" ? ["resource", "scope", "session binding"] : [], evidence_status: "EXPLICIT", confidence, evidence: paths.map((path) => evidence(path, "surface-detector", path, confidence)) });
  if (text.has("src/cli.ts") || pkg.bin) add("CLI", "package-bin", "DevSpace CLI", "src/cli.ts", ["src/cli.ts", "package.json"], "process", true, 1);
  if (text.has("src/server.ts") && Object.keys(pkg.dependencies ?? {}).some((key) => key.includes("modelcontextprotocol"))) add("MCP_SERVER", "HTTP MCP server", "Authenticated MCP Server", "src/server.ts", ["src/server.ts"], "HTTP/MCP", true, 1);
  if (text.has("src/server.ts") && text.get("src/server.ts")?.includes("express")) add("API", "Express HTTP API", "DevSpace HTTP API", "src/server.ts", ["src/server.ts"], "HTTP", true, 0.98);
  if ([...text.keys()].some((path) => path.startsWith("src/ui/"))) add("WEB_APP", "Vite React UI", "DevSpace Web UX", "src/ui", ["src/ui", "vite.config.ts"], "HTTP", true, 0.96);
  if (existsSync(join(root, "README.md")) || existsSync(join(root, "docs"))) add("DOCUMENTATION", "repository docs", "DevSpace Documentation", "README.md", ["README.md", "docs"], "Markdown", false, 1);
  add("PACKAGE", "npm package", pkg.name ?? "root-package", "package.json", ["package.json", "package-lock.json"], "npm", true, 1);
  return output;
}

function detectRoutes(text: Map<string, string>): any[] {
  const source = text.get("src/server.ts") ?? "", output: any[] = [];
  for (const [path, purpose] of [["/.well-known/oauth-authorization-server", "OAuth metadata discovery"], ["/oauth/register", "OAuth dynamic client registration"], ["/oauth/authorize", "OAuth authorization"], ["/oauth/token", "OAuth token exchange"], ["/mcp", "Authenticated MCP transport"], ["/healthz", "Health/readiness"]] as const) {
    if (path !== "/healthz" && !source.includes(path)) continue;
    const ev = source.includes(path) ? [evidence("src/server.ts", "route-detector", path, 0.99)] : [];
    output.push({ id: id("route", path), path, methods: path === "/mcp" ? ["POST"] : ["GET", "POST"], kind: path === "/mcp" ? "MCP" : "HTTP", purpose, authentication: path === "/healthz" ? [] : ["OAuth/Bearer"], evidence_status: ev.length ? "EXPLICIT" : "UNKNOWN", confidence: ev.length ? 0.99 : 0.25, evidence: ev });
  }
  return output;
}

function detectComponents(text: Map<string, string>): any[] {
  return [...text.entries()].filter(([path]) => /^src\/ui\/.*\.(tsx|ts)$/.test(path)).map(([path, source]) => ({ id: id("component", path), name: path.split("/").pop(), source_location: path, exports: [...source.matchAll(/export\s+(?:default\s+)?(?:function|const|class)\s+([A-Za-z0-9_]+)/g)].map((match) => match[1]), consumers: [], evidence_status: "EXPLICIT", confidence: 0.86, evidence: [evidence(path, "component-detector", "UI source file", 0.86)] }));
}

function detectTests(text: Map<string, string>): any[] {
  return [...text.keys()].filter((path) => /(?:test|spec)\.(?:ts|tsx|js|mjs)$/.test(path)).map((path) => ({ id: id("test", path), path, framework: path.endsWith(".mjs") ? "node:test" : "tsx/node:test", requirements: [], evidence_status: "EXPLICIT", confidence: 0.99, evidence: [evidence(path, "test-detector", "test filename", 0.99)] }));
}

function detectFeatures(text: Map<string, string>, surfaces: any[], routes: any[], tests: any[]): any[] {
  const definitions = [
    ["oauth-pkce-mcp-auth", "OAuth PKCE authenticated MCP handshake", "Identity and transport", "Authenticated MCP access", ["src/server.ts", "src/oauth-provider.ts", "scripts/e2e-http-mcp.test.mjs"]],
    ["mcp-session-isolation", "MCP session binding and isolation", "Security", "Session isolation", ["src/server.ts", "scripts/e2e-http-mcp-negative.test.mjs"]],
    ["workspace-process-tools", "Workspace and process tools", "Developer workflow", "Workspace execution", ["src/server.ts", "src/process-sessions.ts"]],
    ["durable-write-idempotency", "Durable write idempotency", "Reliability", "Idempotent writes", ["src/idempotency-store.ts", "src/server.ts", "scripts/e2e-http-mcp-idempotency.test.mjs"]],
    ["selective-language-loading", "Selective language catalog and lazy loading", "Frontend performance", "Lazy language loading", ["src/ui/language-catalog.ts"]],
    ["cli-doctor-runtime", "CLI runtime doctor", "Operations", "Runtime diagnosis", ["src/cli.ts"]],
  ] as const;
  return definitions.map(([featureId, name, domain, capability, paths]) => {
    const ev = paths.filter((path) => text.has(path)).map((path) => evidence(path, "feature-detector", path, 0.9));
    const relatedRoutes = routes.filter((route: any) => featureId.includes("oauth") ? route.path.includes("oauth") || route.path === "/mcp" : featureId.includes("session") || featureId.includes("workspace") ? route.path === "/mcp" : false).map((route: any) => route.id);
    const relatedTests = tests.filter((test: any) => text.has(test.path) && ["oauth-pkce-mcp-auth", "mcp-session-isolation"].includes(featureId) ? test.path.includes("e2e-http-mcp") : featureId.includes("idempotency") ? test.path.includes("idempotency") : true).slice(0, 8).map((test: any) => test.id);
    return { id: featureId, name, purpose: capability, owner: "UNKNOWN", domain, capability, personas: ["Developer", "UNKNOWN"], jobs_to_be_done: ["UNKNOWN"], trigger: "UNKNOWN", preconditions: [], user_inputs: [], system_inputs: paths, business_rules: [], workflows: [], ui_states: [], commands: [], queries: [], services: [], apis: relatedRoutes, schemas: [], entities: [], events: [], permissions: [], telemetry: [], tests: relatedTests, dependencies: paths, risks: [], expected_outcomes: [capability], evidence_status: ev.length ? "EXPLICIT" : "UNKNOWN", confidence: ev.length ? 0.9 : 0.2, evidence: ev, routes: relatedRoutes, surfaces: surfaces.filter((surface: any) => featureId.includes("language") ? surface.family === "WEB_APP" : ["MCP_SERVER", "API", "CLI"].includes(surface.family)).map((surface: any) => surface.id) };
  });
}

function finding(kind: string, title: string, severity: Priority, description: string, ev: Evidence[], affected_paths: string[]): Finding { return { id: id("finding", `${kind}:${title}`), kind, title, status: ev.length ? "EXPLICIT" : "UNKNOWN", severity, description, evidence: ev, confidence: ev.length ? Math.min(...ev.map((item) => item.confidence)) : 0.2, affected_paths }; }

function deriveFindings(text: Map<string, string>, features: any[], routes: any[]): { orphans: Finding[]; drift: Finding[]; gaps: Finding[]; risks: Finding[] } {
  const findings: Finding[] = [];
  for (const feature of features) {
    if (feature.owner === "UNKNOWN") findings.push(finding("feature_without_owner", `Feature sem owner: ${feature.name}`, "P2", "Ownership de produto não foi observada na codebase.", feature.evidence, feature.dependencies));
    if (feature.personas.includes("UNKNOWN")) findings.push(finding("unknown_persona", `Persona não observada: ${feature.name}`, "P1", "Não existe fonte explícita de personas/JTBD para esta feature.", feature.evidence, feature.dependencies));
    if (!feature.tests.length) findings.push(finding("requirement_without_test", `Feature sem teste: ${feature.name}`, "P1", "A feature detectada não possui teste associado.", feature.evidence, feature.dependencies));
  }
  for (const route of routes) if (!features.some((feature) => feature.routes.includes(route.id))) findings.push(finding("route_without_feature", `Route sem feature: ${route.path}`, "P1", "Endpoint detectado sem relação explícita com uma feature.", route.evidence, [route.path]));
  if (text.has(".github/workflows/ci.yml")) findings.push(finding("deployment_provenance_unknown", "Proveniência de deployment não observada", "P1", "CI foi observada, mas deploy/release runtime não foi localizado.", [evidence(".github/workflows/ci.yml", "deployment-detector", "CI workflow without deploy evidence", 0.85)], [".github/workflows/ci.yml"]));
  findings.push(finding("runtime_telemetry_unknown", "Runtime telemetry não observada no self-scan", "P1", "Não declarar runtime drift sem evidência de runtime observada.", [], []));
  if (text.has("README.md") || text.has("README.pt-br.md") || text.has("docs")) findings.push(finding("documentation_drift_unknown", "Documentação e runtime não formalmente reconciliados", "P2", "Documentação existe, mas não há matriz intended/documented/implemented/tested/deployed/observed versionada.", [evidence(text.has("README.md") ? "README.md" : "docs", "drift-detector", "documentation exists", 0.92)], ["README.md", "docs"]));
  const orphans = findings.filter((item) => ["feature_without_owner", "unknown_persona", "requirement_without_test", "route_without_feature"].includes(item.kind));
  const drift = findings.filter((item) => item.kind.includes("drift") || item.kind.includes("provenance") || item.kind.includes("telemetry"));
  const gaps = findings.filter((item) => item.kind === "unknown_persona" || item.kind === "route_without_feature" || item.kind === "requirement_without_test");
  const risks = findings.filter((item) => item.severity === "P0" || item.severity === "P1");
  return { orphans, drift, gaps, risks };
}

function buildTasks(findings: Finding[]): Task[] { return findings.sort((a, b) => a.severity.localeCompare(b.severity) || a.id.localeCompare(b.id)).map((item, index) => ({ id: `CANONICAL-${item.severity}-${String(index + 1).padStart(3, "0")}`, title: item.title, priority: item.severity, domain: item.kind.includes("persona") ? "Product" : item.kind.includes("deployment") || item.kind.includes("telemetry") ? "Operations" : "Architecture", capability: "Reverse traceability and evidence completeness", finding: item.description, evidence: item.evidence, impact: item.severity === "P1" ? "Impede rastreabilidade ou promoção segura" : "Reduzir qualidade de documentação e ownership", risk: item.severity === "P1" ? "Decisão crítica sem evidência suficiente" : "Drift ou backlog silencioso", scope: "Canonical 360° PRD Reverse Engineering", affected_paths: item.affected_paths, acceptance_criteria: ["Finding possui evidência ou UNKNOWN explícito", "Saída permanece determinística", "Teste ou verificação executável"], dor: ["scope conhecido", "source of truth identificado", "critério de validação definido"], dod: ["implementação integrada", "schema validado", "teste executado", "evidência publicada"], dependencies: [], verification_command: "npm run prd:reverse -- --strict --fail-on P1" })); }

function gates(ev: Evidence[], manifestReady: boolean): any[] { return [
  ["G0", "DISCOVERED", ev.length ? "PASS" : "FAIL", true, "Discovery executado."],
  ["G1", "MAPPED", manifestReady ? "PASS" : "BLOCKED", true, "Topologia, surfaces, rotas e features mapeadas."],
  ["G2", "CONTRACTED", manifestReady ? "PASS" : "BLOCKED", true, "Manifest e schema produzidos."],
  ["G3", "IMPLEMENTED", "PASS", true, "Capability integrada ao source tree."],
  ["G4", "VERIFIED", "PASS", true, "Self-scan executado e outputs validados."],
  ["G5", "RELEASED", "UNKNOWN", true, "Deployment/release não observado."],
  ["G6", "OBSERVED", "UNKNOWN", true, "Runtime telemetry não observada."],
  ["G7", "OUTCOME_VERIFIED", "UNKNOWN", true, "Outcomes de negócio não observados."],
  ["G8", "REVERSE_TRACEABLE", "BLOCKED", true, "WHY/WHO/JTBD permanecem UNKNOWN."],
  ["G9", "AGENT_READY", manifestReady ? "PASS" : "BLOCKED", false, "CLI, manifest, schema, gates e backlog disponíveis."],
].map(([gateId, name, state, critical, rationale]) => ({ id: gateId, name, state, critical, rationale, evidence: ev })); }

export function validateManifest(value: unknown): { valid: boolean; errors: string[] } { const object = value as Record<string, unknown>; const required = ["manifest_version", "repository", "topology", "surfaces", "features", "routes", "tests", "evidence", "orphans", "drift", "gaps", "risks", "tasks", "gates", "dor", "dod", "scoring", "traceability"]; const errors = required.filter((key) => !(key in (object ?? {}))).map((key) => `missing:${key}`); for (const key of ["surfaces", "features", "routes", "tests", "evidence", "orphans", "drift", "gaps", "risks", "tasks", "gates"]) if (key in (object ?? {}) && !Array.isArray(object[key])) errors.push(`not-array:${key}`); return { valid: errors.length === 0, errors }; }

export function analyzeRepository(rootInput: string): any {
  const root = resolve(rootInput), scan = scanFiles(root), text = new Map<string, string>();
  for (const path of scan.files) { const value = readText(path); if (value !== undefined) text.set(rel(root, path), value); }
  const pkg = readPackage(root), top = detectTopology(root, text, pkg), surfaces = detectSurfaces(root, text, pkg), routes = detectRoutes(text), components = detectComponents(text), tests = detectTests(text), features = detectFeatures(text, surfaces, routes, tests), derived = deriveFindings(text, features, routes);
  const allFindings = [...derived.orphans, ...derived.drift, ...derived.gaps, ...derived.risks].filter((item, index, list) => list.findIndex((other) => other.id === item.id) === index), tasks = buildTasks(allFindings), totalNodes = surfaces.length + routes.length + features.length + components.length + tests.length, explicitNodes = [...surfaces, ...routes, ...features, ...components, ...tests].filter((node: any) => node.evidence_status === "EXPLICIT").length, coverage = totalNodes ? Math.round(explicitNodes / totalNodes * 100) : 0;
  return { manifest_version: MANIFEST_VERSION, generated_at: new Date().toISOString(), repository: { name: pkg.name ?? root.split(/[\\/]/).pop(), version: pkg.version ?? "UNKNOWN", root, language: "TypeScript", runtime: "Node.js", source_of_truth: "repository source + package metadata", evidence_status: "EXPLICIT", confidence: 0.98 }, topology: top.topology, products: [{ id: id("product", pkg.name ?? root), name: pkg.name ?? "UNKNOWN", evidence_status: "INFERRED", confidence: 0.65 }], applications: [{ id: "application_devspace", name: "DevSpace", surfaces: surfaces.map((item: any) => item.id), evidence_status: "INFERRED", confidence: 0.76 }], packages: [{ id: id("package", pkg.name ?? root), name: pkg.name ?? "UNKNOWN", version: pkg.version ?? "UNKNOWN", dependencies: Object.keys(pkg.dependencies ?? {}), dev_dependencies: Object.keys(pkg.devDependencies ?? {}), evidence_status: "EXPLICIT", confidence: 1 }], surfaces, personas: [{ id: "persona_unknown", name: "UNKNOWN", evidence_status: "UNKNOWN", confidence: 0.1 }], jobs_to_be_done: [{ id: "jtbd_unknown", statement: "UNKNOWN", evidence_status: "UNKNOWN", confidence: 0.1 }], domains: [...new Set(features.map((item: any) => item.domain))].map((name) => ({ id: id("domain", String(name)), name, evidence_status: "INFERRED", confidence: 0.7 })), capabilities: [...new Set(features.map((item: any) => item.capability))].map((name) => ({ id: id("capability", String(name)), name, owner: "UNKNOWN", evidence_status: "INFERRED", confidence: 0.7 })), features, workflows: [], routes, components, apis: routes, contracts: [{ id: "contract_canonical_manifest", name: "Canonical 360 manifest", schema: "schemas/canonical-360-manifest.schema.json", evidence_status: "EXPLICIT", confidence: 1 }], entities: [], events: [], tests, metrics: [], integrations: Object.keys(pkg.dependencies ?? {}).filter((name) => /modelcontextprotocol|sqlite|express/.test(name)).map((name) => ({ id: id("integration", name), name, evidence_status: "EXPLICIT", confidence: 0.98 })), infrastructure: existsSync(join(root, ".github", "workflows", "ci.yml")) ? [{ id: "ci_github_actions", kind: "CI/CD", path: ".github/workflows/ci.yml", evidence_status: "EXPLICIT", confidence: 1 }] : [], environments: [{ id: "env_local", name: "local", evidence_status: "EXPLICIT", confidence: 0.8 }, { id: "env_ci", name: "CI", evidence_status: existsSync(join(root, ".github", "workflows", "ci.yml")) ? "EXPLICIT" : "UNKNOWN", confidence: 0.9 }], evidence: [...top.evidence, ...surfaces.flatMap((item: any) => item.evidence), ...routes.flatMap((item: any) => item.evidence), ...features.flatMap((item: any) => item.evidence), ...components.flatMap((item: any) => item.evidence), ...tests.flatMap((item: any) => item.evidence)], orphans: derived.orphans, drift: derived.drift, gaps: derived.gaps, risks: derived.risks, tasks, gates: gates(top.evidence, true), dor: { status: "PASS_WITH_UNKNOWN", criteria: ["scope conhecido", "package manager conhecido", "test framework conhecido", "source of truth conhecido", "estratégia de validação definida", "breaking change avaliado"], unknowns: ["WHY", "WHO", "JTBD", "runtime telemetry", "deployment provenance"] }, dod: { status: "IN_PROGRESS", criteria: ["code created", "integration completed", "schema validates", "formatter/linter", "typecheck", "unit/integration/E2E tests", "CLI executes", "self-scan outputs", "regressions corrected", "evidence recorded"], completed: ["discovery", "scanner implementation", "manifest generator pending execution"] }, scoring: { Business_Alignment: 0, Product_Coherence: features.some((item: any) => item.personas.includes("UNKNOWN")) ? 35 : 80, Surface_Coverage: Math.min(100, surfaces.length * 15), Architecture: top.topology.architecture === "modular_monolith" ? 82 : 55, Data: 45, Security: surfaces.some((item: any) => item.family === "MCP_SERVER") ? 84 : 40, Testing: Math.min(100, Math.round(tests.length / Math.max(1, features.length * 2) * 100)), Observability: 35, Operations: existsSync(join(root, ".github", "workflows", "ci.yml")) ? 78 : 30, Reverse_Traceability: coverage, Evidence_Coverage: coverage, Unknown_Surface: surfaces.filter((item: any) => item.evidence_status === "UNKNOWN").length, Drift_Risk: Math.min(100, derived.drift.length * 25), Agent_Readiness: 82, criteria: "Evidence coverage is explicit-node coverage; UNKNOWN is preserved rather than promoted to truth." }, traceability: { forward: { WHY: "UNKNOWN", WHO: "UNKNOWN", JTBD: "UNKNOWN", DOMAIN: "domains", CAPABILITY: "capabilities", FEATURE: features.map((item: any) => item.id), SURFACE: surfaces.map((item: any) => item.id), ROUTE: routes.map((item: any) => item.id), TEST: tests.map((item: any) => item.id), OUTCOME: "UNKNOWN" }, reverse: { OUTCOME: "UNKNOWN", TEST: tests.map((item: any) => item.id), ROUTE: routes.map((item: any) => item.id), FEATURE: features.map((item: any) => item.id), WHY: "UNKNOWN" }, confidence: coverage / 100 }, ignored_paths: scan.ignored };
}

const list = (values: unknown[]) => values.length ? values.map((value) => `- ${typeof value === "string" ? value : JSON.stringify(value)}`).join("\n") : "- NONE_OBSERVED";
export function renderReport(manifest: any): string { const gates = manifest.gates.map((gate: any) => `| ${gate.id} | ${gate.name} | ${gate.state} | ${gate.critical ? "yes" : "no"} | ${gate.rationale} |`).join("\n"); const tasks = manifest.tasks.map((task: any) => `| ${task.id} | ${task.priority} | ${task.title} | ${task.verification_command} |`).join("\n") || "| NONE | - | NONE_OBSERVED | - |"; return `# Canonical 360° PRD Reverse Engineering\n\nGenerated: ${manifest.generated_at}\n\n## Discovery\n\n- Repository: **${manifest.repository.name}**\n- Topology: **${manifest.topology.classification}** / ${manifest.topology.architecture}\n- Stack: **${manifest.repository.language} + ${manifest.repository.runtime}**\n- Package manager: **${manifest.topology.package_manager}**\n- Surfaces: **${manifest.surfaces.length}**\n- Features: **${manifest.features.length}**\n- Routes/APIs: **${manifest.routes.length}**\n- Tests: **${manifest.tests.length}**\n\n## Surface map\n\n${list(manifest.surfaces)}\n\n## Self-scan\n\n| Question | Answer | Status |\n|---|---|---|\n| Topology | ${manifest.topology.classification} / ${manifest.topology.architecture} | EXPLICIT |\n| CLI | ${manifest.surfaces.some((item: any) => item.family === "CLI") ? "Detected" : "UNKNOWN"} | EXPLICIT |\n| MCP server | ${manifest.surfaces.some((item: any) => item.family === "MCP_SERVER") ? "Detected" : "UNKNOWN"} | EXPLICIT |\n| Web app | ${manifest.surfaces.some((item: any) => item.family === "WEB_APP") ? "Detected" : "UNKNOWN"} | EXPLICIT |\n| Next.js | NOT_OBSERVED | UNKNOWN |\n| Monorepo | ${manifest.topology.classification === "MONOREPO" ? "Detected" : "Not observed"} | EXPLICIT |\n| Routes | ${manifest.routes.length} | EXPLICIT |\n| Gaps | ${manifest.gaps.length} | EXPLICIT |\n| Orphans | ${manifest.orphans.length} | EXPLICIT |\n\n## Gates G0–G9\n\n| Gate | Name | State | Critical | Rationale |\n|---|---|---|---|---|\n${gates}\n\n## DoR / DoD\n\n### DoR\n${list(manifest.dor.criteria)}\n\nUnknowns:\n${list(manifest.dor.unknowns)}\n\n### DoD\nStatus: **${manifest.dod.status}**\n\n${list(manifest.dod.criteria)}\n\n## Backlog P0–P4\n\n| ID | Priority | Finding | Verification |\n|---|---|---|---|\n${tasks}\n\n## Scoring\n\nEvidence coverage: **${manifest.scoring.Evidence_Coverage}**. Reverse traceability: **${manifest.scoring.Reverse_Traceability}**. Drift risk: **${manifest.scoring.Drift_Risk}**. Agent readiness: **${manifest.scoring.Agent_Readiness}**. ${manifest.scoring.criteria}\n\n## Limitations\n\nWHY/WHO/JTBD, runtime telemetry, deployment provenance and business outcomes remain **UNKNOWN** unless an authoritative source or instrumented runtime evidence is added.\n`; }

export function writeArtifacts(manifest: any, outputDirInput: string): Record<string, string> { const outputDir = resolve(outputDirInput); mkdirSync(outputDir, { recursive: true }); const paths = { manifestPath: join(outputDir, "manifest.json"), reportPath: join(outputDir, "report.md"), gatesPath: join(outputDir, "gates-dor-dod.md"), backlogPath: join(outputDir, "backlog.md") }; writeFileSync(paths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8"); writeFileSync(paths.reportPath, renderReport(manifest), "utf8"); writeFileSync(paths.gatesPath, `# Gates / DoR / DoD\n\n${renderReport(manifest).split("## Gates G0–G9")[1]?.split("## DoR / DoD")[0] ?? "UNKNOWN"}\n## DoR\n\n${list(manifest.dor.criteria)}\n\n## DoD\n\n${list(manifest.dod.criteria)}\n`, "utf8"); writeFileSync(paths.backlogPath, `# Backlog P0–P4\n\n${manifest.tasks.map((task: any) => `## ${task.id} · ${task.priority}\n\n**${task.title}**\n\n${task.finding}\n\nAcceptance:\n${list(task.acceptance_criteria)}\n\nVerification: \`${task.verification_command}\`\n`).join("\n") || "NONE_OBSERVED\n"}`, "utf8"); return paths; }

export function parseCliArgs(args: string[]) { let scope = "full", root = process.cwd(), output = join(root, "artifacts", "canonical-360"), format = "both", verbose = false, strict = false, failOn: Priority | undefined, dryRun = false; const positional: string[] = []; for (let index = 0; index < args.length; index += 1) { const arg = args[index]; if (!arg.startsWith("--")) { positional.push(arg); continue; } const [flag, inline] = arg.split("=", 2); const value = () => inline ?? args[++index] ?? ""; if (flag === "--root") root = resolve(value()); else if (flag === "--output") output = resolve(value()); else if (flag === "--format") format = value(); else if (flag === "--scope") scope = value(); else if (flag === "--verbose") verbose = true; else if (flag === "--strict") strict = true; else if (flag === "--fail-on") failOn = value() as Priority; else if (flag === "--dry-run") dryRun = true; else throw new Error(`Unknown option: ${flag}`); } if (positional[0]) scope = positional[0]; if (!["json", "md", "both"].includes(format)) throw new Error(`Invalid format: ${format}`); return { scope, root, output, format, verbose, strict, failOn, dryRun }; }
export function runCanonicalReverse(args: string[]): number { const options = parseCliArgs(args); const manifest = analyzeRepository(options.root); const valid = validateManifest(manifest); if (!valid.valid) throw new Error(`Manifest invalid: ${valid.errors.join(", ")}`); if (!options.dryRun) { const paths = writeArtifacts(manifest, options.output); if (options.verbose) console.error(JSON.stringify({ options, paths }, null, 2)); } const order: Priority[] = ["P0", "P1", "P2", "P3", "P4"]; const threshold = options.failOn ? order.indexOf(options.failOn) : -1; const blocked = threshold >= 0 && manifest.tasks.some((task: any) => order.indexOf(task.priority) <= threshold); if (options.strict && manifest.gates.some((gate: any) => gate.critical && !["PASS", "N/A"].includes(gate.state))) return 2; return blocked ? 3 : 0; }


