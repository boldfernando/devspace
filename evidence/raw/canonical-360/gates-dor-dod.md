# Gates / DoR / DoD



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


## DoR

- scope conhecido
- package manager conhecido
- test framework conhecido
- source of truth conhecido
- estratégia de validação definida
- breaking change avaliado

## DoD

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
