# Canonical 360° PRD Reverse Engineering

Generated: 2026-08-16T18:53:17.636Z

## Discovery

- Repository: **@waishnav/devspace**
- Topology: **MODULAR_MONOLITH** / modular_monolith
- Stack: **TypeScript + Node.js**
- Package manager: **npm**
- Surfaces: **6**
- Features: **6**
- Routes/APIs: **2**
- Tests: **34**

## Surface map

- {"id":"surface_03b51a594e8b","canonical_name":"DevSpace CLI","family":"CLI","subtype":"package-bin","protocol":"process","entry_point":"src/cli.ts","source_location":["src/cli.ts","package.json"],"owning_package":"@waishnav/devspace","deployable":true,"runtime":"Node.js","personas":["UNKNOWN"],"capabilities":[],"features":[],"routes":[],"dependencies":[],"authentication":[],"authorization":[],"evidence_status":"EXPLICIT","confidence":1,"evidence":[{"type":"file","source":"repository","path":"src/cli.ts","detector":"surface-detector","raw_signal":"src/cli.ts","confidence":1},{"type":"file","source":"repository","path":"package.json","detector":"surface-detector","raw_signal":"package.json","confidence":1}]}
- {"id":"surface_5d95b490f9fe","canonical_name":"Authenticated MCP Server","family":"MCP_SERVER","subtype":"HTTP MCP server","protocol":"HTTP/MCP","entry_point":"src/server.ts","source_location":["src/server.ts"],"owning_package":"@waishnav/devspace","deployable":true,"runtime":"Node.js","personas":["UNKNOWN"],"capabilities":[],"features":[],"routes":[],"dependencies":[],"authentication":["OAuth 2.0 PKCE","Bearer"],"authorization":["resource","scope","session binding"],"evidence_status":"EXPLICIT","confidence":1,"evidence":[{"type":"file","source":"repository","path":"src/server.ts","detector":"surface-detector","raw_signal":"src/server.ts","confidence":1}]}
- {"id":"surface_2c906eee076c","canonical_name":"DevSpace HTTP API","family":"API","subtype":"Express HTTP API","protocol":"HTTP","entry_point":"src/server.ts","source_location":["src/server.ts"],"owning_package":"@waishnav/devspace","deployable":true,"runtime":"Node.js","personas":["UNKNOWN"],"capabilities":[],"features":[],"routes":[],"dependencies":[],"authentication":["OAuth 2.0 PKCE","Bearer"],"authorization":["resource","scope","session binding"],"evidence_status":"EXPLICIT","confidence":0.98,"evidence":[{"type":"file","source":"repository","path":"src/server.ts","detector":"surface-detector","raw_signal":"src/server.ts","confidence":0.98}]}
- {"id":"surface_451923c6e2ed","canonical_name":"DevSpace Web UX","family":"WEB_APP","subtype":"Vite React UI","protocol":"HTTP","entry_point":"src/ui","source_location":["src/ui","vite.config.ts"],"owning_package":"@waishnav/devspace","deployable":true,"runtime":"Node.js","personas":["UNKNOWN"],"capabilities":[],"features":[],"routes":[],"dependencies":[],"authentication":[],"authorization":[],"evidence_status":"EXPLICIT","confidence":0.96,"evidence":[{"type":"file","source":"repository","path":"src/ui","detector":"surface-detector","raw_signal":"src/ui","confidence":0.96},{"type":"file","source":"repository","path":"vite.config.ts","detector":"surface-detector","raw_signal":"vite.config.ts","confidence":0.96}]}
- {"id":"surface_f27f28db5b26","canonical_name":"DevSpace Documentation","family":"DOCUMENTATION","subtype":"repository docs","protocol":"Markdown","entry_point":"README.md","source_location":["README.md","docs"],"owning_package":"@waishnav/devspace","deployable":false,"runtime":"Node.js","personas":["UNKNOWN"],"capabilities":[],"features":[],"routes":[],"dependencies":[],"authentication":[],"authorization":[],"evidence_status":"EXPLICIT","confidence":1,"evidence":[{"type":"file","source":"repository","path":"README.md","detector":"surface-detector","raw_signal":"README.md","confidence":1},{"type":"file","source":"repository","path":"docs","detector":"surface-detector","raw_signal":"docs","confidence":1}]}
- {"id":"surface_cf302234e82b","canonical_name":"@waishnav/devspace","family":"PACKAGE","subtype":"npm package","protocol":"npm","entry_point":"package.json","source_location":["package.json","package-lock.json"],"owning_package":"@waishnav/devspace","deployable":true,"runtime":"Node.js","personas":["UNKNOWN"],"capabilities":[],"features":[],"routes":[],"dependencies":[],"authentication":[],"authorization":[],"evidence_status":"EXPLICIT","confidence":1,"evidence":[{"type":"file","source":"repository","path":"package.json","detector":"surface-detector","raw_signal":"package.json","confidence":1},{"type":"file","source":"repository","path":"package-lock.json","detector":"surface-detector","raw_signal":"package-lock.json","confidence":1}]}

## Self-scan

| Question | Answer | Status |
|---|---|---|
| Topology | MODULAR_MONOLITH / modular_monolith | EXPLICIT |
| CLI | Detected | EXPLICIT |
| MCP server | Detected | EXPLICIT |
| Web app | Detected | EXPLICIT |
| Next.js | NOT_OBSERVED | UNKNOWN |
| Monorepo | Not observed | EXPLICIT |
| Routes | 2 | EXPLICIT |
| Gaps | 7 | EXPLICIT |
| Orphans | 13 | EXPLICIT |

## Gates G0–G9

| Gate | Name | State | Critical | Rationale |
|---|---|---|---|---|
| G0 | DISCOVERED | PASS | yes | Discovery executado. |
| G1 | MAPPED | PASS | yes | Topologia, surfaces, rotas e features mapeadas. |
| G2 | CONTRACTED | PASS | yes | Manifest e schema produzidos. |
| G3 | IMPLEMENTED | PASS | yes | Capability integrada ao source tree. |
| G4 | VERIFIED | PASS | yes | Self-scan executado e outputs validados. |
| G5 | RELEASED | UNKNOWN | yes | Deployment/release não observado. |
| G6 | OBSERVED | UNKNOWN | yes | Runtime telemetry não observada. |
| G7 | OUTCOME_VERIFIED | UNKNOWN | yes | Outcomes de negócio não observados. |
| G8 | REVERSE_TRACEABLE | BLOCKED | yes | WHY/WHO/JTBD permanecem UNKNOWN. |
| G9 | AGENT_READY | PASS | no | CLI, manifest, schema, gates e backlog disponíveis. |

## DoR / DoD

### DoR
- scope conhecido
- package manager conhecido
- test framework conhecido
- source of truth conhecido
- estratégia de validação definida
- breaking change avaliado

Unknowns:
- WHY
- WHO
- JTBD
- runtime telemetry
- deployment provenance

### DoD
Status: **IN_PROGRESS**

- code created
- integration completed
- schema validates
- formatter/linter
- typecheck
- unit/integration/E2E tests
- CLI executes
- self-scan outputs
- regressions corrected
- evidence recorded

## Backlog P0–P4

| ID | Priority | Finding | Verification |
|---|---|---|---|
| CANONICAL-P1-001 | P1 | Persona não observada: Workspace and process tools | npm run prd:reverse -- --strict --fail-on P1 |
| CANONICAL-P1-002 | P1 | Proveniência de deployment não observada | npm run prd:reverse -- --strict --fail-on P1 |
| CANONICAL-P1-003 | P1 | Persona não observada: MCP session binding and isolation | npm run prd:reverse -- --strict --fail-on P1 |
| CANONICAL-P1-004 | P1 | Persona não observada: CLI runtime doctor | npm run prd:reverse -- --strict --fail-on P1 |
| CANONICAL-P1-005 | P1 | Runtime telemetry não observada no self-scan | npm run prd:reverse -- --strict --fail-on P1 |
| CANONICAL-P1-006 | P1 | Persona não observada: OAuth PKCE authenticated MCP handshake | npm run prd:reverse -- --strict --fail-on P1 |
| CANONICAL-P1-007 | P1 | Persona não observada: Selective language catalog and lazy loading | npm run prd:reverse -- --strict --fail-on P1 |
| CANONICAL-P1-008 | P1 | Route sem feature: /healthz | npm run prd:reverse -- --strict --fail-on P1 |
| CANONICAL-P1-009 | P1 | Persona não observada: Durable write idempotency | npm run prd:reverse -- --strict --fail-on P1 |
| CANONICAL-P2-010 | P2 | Feature sem owner: Workspace and process tools | npm run prd:reverse -- --strict --fail-on P1 |
| CANONICAL-P2-011 | P2 | Documentação e runtime não formalmente reconciliados | npm run prd:reverse -- --strict --fail-on P1 |
| CANONICAL-P2-012 | P2 | Feature sem owner: Selective language catalog and lazy loading | npm run prd:reverse -- --strict --fail-on P1 |
| CANONICAL-P2-013 | P2 | Feature sem owner: OAuth PKCE authenticated MCP handshake | npm run prd:reverse -- --strict --fail-on P1 |
| CANONICAL-P2-014 | P2 | Feature sem owner: CLI runtime doctor | npm run prd:reverse -- --strict --fail-on P1 |
| CANONICAL-P2-015 | P2 | Feature sem owner: MCP session binding and isolation | npm run prd:reverse -- --strict --fail-on P1 |
| CANONICAL-P2-016 | P2 | Feature sem owner: Durable write idempotency | npm run prd:reverse -- --strict --fail-on P1 |

## Scoring

Evidence coverage: **100**. Reverse traceability: **100**. Drift risk: **75**. Agent readiness: **82**. Evidence coverage is explicit-node coverage; UNKNOWN is preserved rather than promoted to truth.

## Limitations

WHY/WHO/JTBD, runtime telemetry, deployment provenance and business outcomes remain **UNKNOWN** unless an authoritative source or instrumented runtime evidence is added.
