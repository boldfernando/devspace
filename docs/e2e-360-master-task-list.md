# DevSpace — Backlog Mestre E2E 360°

**Data da consolidação:** 20 de agosto de 2026
**Repositório:** `devspace`
**Fonte:** histórico completo da execução, `docs/e2e-360-task-list.md`, `docs/e2e-360-task-matrix.md`, `artifacts/canonical-360/`, `artifacts/storybook-360-mcp-e2e/`, scripts E2E, testes, CI e anexos fornecidos.
**Regra:** nenhum item é promovido a PASS por inferência. Dependências externas, identidade real, hosted alerting, cross-OS, deployment, rollback, produto e credenciais permanecem **PARTIAL** ou **UNKNOWN** quando não há prova executável.

> **Decisão atual:** a plataforma possui cobertura local substancial e vários gates críticos comprovados, mas o estado global continua **YELLOW / NOT RELEASE-READY** por blockers de release, gaps hosted/cross-OS, risco residual de ACK após crash, gateway de identidade/RBAC, alert firing externo, provenance/rollback e ausência de fonte autoritativa de produto.

---

## 1. Resumo executivo da cobertura já comprovada

| Área | Resultado consolidado | Status |
|---|---|---|
| Descoberta/Canonical 360 | scanner, topology, surfaces, manifest, schema, report, DoR/DoD e backlog existentes | GREEN local |
| Wave 1 P0 | 16/16 gates HTTP/MCP reais | GREEN local |
| Matriz negativa OAuth/Bearer/MCP | 23/23 cenários fail-closed; secret scan sem leak | GREEN local |
| OAuth PKCE | metadata, registration, S256, authorization, token, replay/expiry/revocation | GREEN local |
| Device Authorization | migration, HMAC, TTL, polling, approve/deny, single-use, CLI, ACL e cancelamento | GREEN local; OS/identity hosted UNKNOWN |
| Idempotência file write | IDEMP-P1-001..008 e crash/reconciliation de `write` | GREEN local; interface operacional hosted UNKNOWN |
| `write_stdin` | owner/replay/conflict/gap/sequence/key/polling | PARTIAL; crash entre write e ACK UNKNOWN |
| Wave 2 Chaos | 11/11 cenários | GREEN local |
| Wave 3 Performance/Soak | ramp, sustained, burst e soak 4/4 | GREEN local; hosted UNKNOWN |
| Agents Swarm | 8 agentes lógicos, 6 rounds, 96/96 operações | GREEN local; provider/model runtime UNKNOWN |
| Segurança de filesystem | traversal/symlink/parent-symlink e root containment | GREEN local Windows; matriz OS UNKNOWN |
| Observabilidade | métricas/logs sanitizados, dashboards/alert contracts e monitor local | GREEN local; scrape/firing hosted UNKNOWN |
| Storybook Mock Layer | 7 fixtures/stories, 4 contract tests, MSW e fail-closed missing scenario | GREEN local |
| Storybook browser/a11y/visual | 7/7 Chromium, 7/7 axe, 7/7 visual, 7 PNG + 7 WEBM | GREEN local; cross-OS/host bridge UNKNOWN |
| PRD + Blueprint canônico | 38 itens numerados do template 0–38, PRD/Blueprint JSON, matriz, relatório e SHA-256 | GREEN como extração; negócio UNKNOWN |
| Release | build/test/coverage/CI local; deploy, SBOM, provenance, rollback/restore hosted | RED blocker / NOT RELEASE-READY |

**Evidências principais:** `artifacts/wave1-p0/summary.json`, `artifacts/wave2-chaos/summary.json`, `artifacts/wave3-performance/summary.json`, `artifacts/oauth-mcp-negative-report.json`, `artifacts/idempotency-p1-report.json`, `artifacts/idempotency-recovery-report.json`, `artifacts/write-stdin-idempotency-report.json`, `artifacts/swarm-resilience-report.json`, `artifacts/swarm-chaos-report.json`, `artifacts/storybook-360-mcp-e2e/10-browser360-gate-summary.json`, `artifacts/canonical-prd-blueprint-360/09-validation.json`.

---

# 2. Tasks P0 — caminhos críticos e bloqueios de segurança

| ID | Domínio | Task | Status | Dependências | Critério de aceite / evidência |
|---|---|---|---|---|---|
| P0-DISC-001 | Discovery | Capturar branch, commit, worktree, `AGENTS.md`, runtime, package manager, entrypoints, scripts e CI. | Concluída | — | Baseline reproduzível; `artifacts/canonical-360/` e logs preservados. |
| P0-DISC-002 | Canonical | Executar reverse engineering 360° de stack, topology, routes, features, tests e evidence. | Concluída | P0-DISC-001 | Manifest/schema/report válidos; `prd:reverse` e self-scan executados. |
| P0-DISC-003 | Governance | Gerar DoR/DoD, gates, risks, backlog e mapa AS IS→TO BE. | Concluída | P0-DISC-002 | Findings têm evidência ou `UNKNOWN`; `docs/e2e-360-task-list.md`. |
| P0-CANON-001 | PRD/Blueprint | Extrair PRD + Blueprint canônico do template anexado sem inferências. | Concluída como extração | P0-DISC-002 | PRD/Blueprint JSON, relatório, matriz 0–38, manifest SHA-256 e validação estrutural PASS. |
| P0-BUILD-001 | Build | Executar typecheck, testes, build, coverage, bundle audit e doctor antes/depois de mudanças. | Concluída localmente | P0-DISC-001 | Exit codes 0; thresholds não reduzidos; warnings registrados. |
| P0-CI-001 | CI | Manter install reproduzível com lockfile e matriz Linux/macOS/Windows. | Concluída localmente; hosted parcial | P0-BUILD-001 | `npm ci` não altera lockfile; matriz CI existente; execução hosted ainda deve ser provada. |
| P0-AUTH-001 | OAuth | Validar metadata, dynamic registration, PKCE verifier/challenge S256, authorization e token exchange. | Concluída | P0-BUILD-001 | Happy path HTTP real, Bearer emitido e artifact sanitizado. |
| P0-AUTH-002 | OAuth negativo | Rejeitar verifier incorreto, redirect divergente, cliente inexistente, code expirado e replay. | Concluída | P0-AUTH-001 | Erros esperados sem emissão privilegiada. |
| P0-AUTH-003 | Bearer | Rejeitar ausência, scheme inválido, token inválido/expirado/revogado e resource incompatível. | Concluída | P0-AUTH-001 | Nenhuma tool/sessão privilegiada após rejeição. |
| P0-AUTH-004 | Session | Vincular MCP session a `clientId`, `resource` e principal; impedir transferência. | Concluída | P0-AUTH-001 | `SESSION-NEG-001..004` fail-closed. |
| P0-MCP-001 | MCP | Executar initialize, session ID, initialized, tools/list, leitura e escrita. | Concluída | P0-AUTH-001 | Handshake e tools contra servidor HTTP/MCP real. |
| P0-MCP-002 | MCP negativo | Rejeitar JSON-RPC/body/content type/método/lifecycle/sessão inválidos. | Concluída | P0-MCP-001 | Nenhuma sessão/efeito indevido; matrix negativa passa. |
| P0-SEC-001 | Security | Executar matriz de 23 IDs negativos OAuth/Bearer/MCP. | Concluída | P0-AUTH-002/003; P0-MCP-002 | 23/23 PASS, cleanup em `finally`, exit 0. |
| P0-SEC-002 | Secret safety | Sanitizar stdout, stderr, logs, banco exportado, reports e artifacts. | Concluída | P0-SEC-001 | `secret_leak_detected=false`; nenhum token/payload/comando exposto. |
| P0-IDEMP-001 | Idempotência | Integrar store durável ao handler real de escrita com scope derivado do principal. | Concluída | P0-MCP-001 | Retry não duplica efeito; cliente não controla scope. |
| P0-IDEMP-002 | SQLite | Persistir pending/succeeded/failed, payload hash e `lease_token`. | Concluída | P0-IDEMP-001 | Migration idempotente; finalização exige lease correto. |
| P0-PERF-001 | Bundle | Gerar manifest de entrypoint, chunks lazy, dynamic imports e assets maiores. | Concluída localmente | P0-BUILD-001 | JSON válido e gate funcional; warnings não são silenciados. |
| P0-PERF-002 | UI | Preservar lazy loading de módulos pesados sem contaminar caminho inicial. | Concluída localmente | P0-PERF-001 | Grafo de imports e comportamento funcional aprovados. |
| P0-REL-001 | Release gate | Bloquear release se build, typecheck, E2E, coverage, bundle ou security falhar. | Concluída localmente | Todas P0 | Qualquer exit code não zero interrompe a cadeia. |

---

# 3. Tasks P0 — Device Authorization Grant

| ID | Task | Status | Dependências | Critério de aceite / evidência |
|---|---|---|---|---|
| P0-DEVICE-001 | Criar migration `oauth_device_authorizations`, estados, TTL, polling e timestamps. | Concluída | P0-BUILD-001 | Migration aditiva e preservação de estado. |
| P0-DEVICE-002 | Gerar device/user code e persistir apenas hashes HMAC com pepper. | Concluída | P0-DEVICE-001 | Códigos em claro ausentes do banco/artifacts. |
| P0-DEVICE-003 | Implementar pending/approved/denied/consumed/expired e single-use. | Concluída | P0-DEVICE-002 | Replay retorna `invalid_grant`; estados finais não emitem token. |
| P0-DEVICE-004 | Expor metadata, request, verification, approve/deny e token exchange. | Concluída | P0-DEVICE-003 | Grant compatível com RFC 8628 e erros sanitizados. |
| P0-DEVICE-005 | Validar binding de client/resource/scopes antes do consumo. | Concluída | P0-DEVICE-004 | Divergência rejeitada sem consumir autorização válida. |
| P0-DEVICE-006 | Implementar CLI `auth login --device`, polling, no-browser, logout e persistência. | Concluída localmente | P0-DEVICE-004 | Login E2E e ACL privada sem secrets em logs. |
| P0-DEVICE-007 | Preservar fallback `auth login --pkce`. | Concluída | P0-AUTH-001 | State/verifier e troca de code preservados. |
| P0-DEVICE-008 | Integrar contracts, HTTP E2E e CLI E2E ao CI. | Concluída localmente | P0-DEVICE-006 | Gates executáveis; OS/hosted ainda parcialmente provados. |

---

# 4. Tasks P1 — integridade, autorização e operação

## 4.1 Idempotência, ACK e efeitos destrutivos

| ID | Task | Status | Dependências | Critério de aceite / próximo raw |
|---|---|---|---|---|
| IDEMP-P1-001 | Primeira escrita com uma chave produz exatamente um efeito. | Concluída | P0-IDEMP-001 | Snapshot antes/depois e `effect_count` único. |
| IDEMP-P1-002 | Replay igual retorna resultado persistido sem segundo efeito. | Concluída | IDEMP-P1-001 | Filesystem/banco sem mutação adicional. |
| IDEMP-P1-003 | Mesma chave com payload diferente retorna conflito. | Concluída | IDEMP-P1-002 | Hash divergente rejeitado antes do efeito. |
| IDEMP-P1-004 | Claims concorrentes mantêm um owner efetivo. | Concluída | P0-IDEMP-002 | Um lease executa; concorrente recebe pending/conflict. |
| IDEMP-P1-005 | Timeout pós-commit vira ambiguous, sem retry cego. | Concluída localmente; operacional parcial | IDEMP-P1-004 | Crash drill de `write`, reconcile explícito, retry bloqueado e métricas; interface operacional autenticada ainda UNKNOWN. |
| IDEMP-P1-006 | Mesmo key em scopes diferentes permanece isolado. | Concluída | P0-IDEMP-001 | Dois scopes produzem efeitos independentes. |
| IDEMP-P1-007 | Retenção expirada exige nova intenção explícita. | Parcial | IDEMP-P1-002 | Operação prolongada e restart validam retenção e cleanup. |
| IDEMP-P1-008 | Banco/logs/artifacts não contêm secrets/payloads. | Concluída | P0-SEC-002 | Report e archive sem potential match. |
| P1-IDEMP-009 | Estender idempotência a `write_stdin`/bash com ACK e crash drill. | Parcial; crash entre `write(chars)` e ACK UNKNOWN | IDEMP-P1-005; P2-PROC-001 | Owner/replay/conflict/gap/sequence já passam; falta servidor real matar/reiniciar entre `process.write()` e `succeed`, preservar ACK/ambiguous, reconciliar sem duplicar chars e provar métricas. |
| P1-IDEMP-010 | Modelar durable ACK/fencing para processo e stdin. | Backlog prioritário | P1-IDEMP-009 | ACK durável ou estado explicitamente ambiguous; instância zumbi não pode confirmar lease perdido; split-brain/restart E2E. |

## 4.2 Autorização, identidade, sessão e tools

| ID | Task | Status | Dependências | Critério de aceite / próximo raw |
|---|---|---|---|---|
| P1-SEC-001 | Rate limiting device request, approval e polling por client/IP. | Parcial; hosted UNKNOWN | P0-DEVICE-004 | 429/`slow_down`, Retry-After, legítimo preservado e métrica consultável. |
| P1-SEC-002 | Matrix traversal, symlink, roots, hosts e origins por OS. | Concluída localmente Windows; OS/hosted UNKNOWN | P0-MCP-001 | Linux/macOS/Windows, host/origin e traversal completo. |
| P1-SEC-003 | Validar scopes por tool, resource e client. | Concluída localmente; gateway UNKNOWN | P0-AUTH-003 | Matriz tool-by-tool e hosted gateway. |
| P1-AUTHZ-001 | Introduzir RBAC explícito, roles, permissions, grants versionados por principal/tenant/workspace. | Backlog prioritário | P1-SEC-003; P1-SESSION-002 | Evaluator puro fail-closed, migrations aditivas, compatibilidade read/write/devspace, revogação e RBAC-001..014. |
| P1-AUTHZ-002 | Definir compatibilidade do scope legado amplo `devspace`. | Backlog | P1-AUTHZ-001 | Política de migração, warnings e testes sem breaking change. |
| P1-SESSION-001 | Rejeitar replay após close, reconexão parcial, ID desconhecido e lifecycle inválido. | Concluída | P0-AUTH-004 | Sessões negativas aprovadas. |
| P1-SESSION-002 | Binding workspace/tenant/region para evolução multiusuário. | Parcial | P1-SEC-003; P1-AUTHZ-001 | Nenhuma transferência cross-tenant/workspace/region após grants explícitos. |
| P1-MCP-001 | Completar matrix tool-by-tool para read/write/process/artifact. | Parcial | P0-MCP-001; P1-SEC-003 | Cada tool com auth/scope/root/idempotency provados. |
| P1-MCP-002 | Body inválido, max size, JSON-RPC duplicado e content type. | Parcial | P0-MCP-002 | Falha não cria sessão nem efeito. |
| P1-DEVICE-009 | Substituir owner-token web por sessão de usuário autenticada. | Parcial; gateway real UNKNOWN | P0-DEVICE-004 | Trusted gateway, ACL, audit trail, headers forjados bloqueados em staging/produção. |
| P1-SEC-004 | Expiração, revogação, refresh rotation e key rotation. | Parcial; key rotation UNKNOWN | P0-AUTH-001; P0-DEVICE-004 | Refresh antigo falha; rotação de pepper/signing/owner secret com recovery. |
| P1-DEVICE-012 | Storage/ACL equivalente a 0600 em Windows/macOS/Linux. | Parcial; Windows local | P0-DEVICE-006 | Matriz OS e artifact sanitizado. |
| P1-DEVICE-013 | Timeout/cancelamento de polling configurável e operacional. | Parcial; Windows local | P0-DEVICE-006 | OS matrix, scheduler/hosted e cleanup. |

## 4.3 Observabilidade e recovery

| ID | Task | Status | Dependências | Critério de aceite / próximo raw |
|---|---|---|---|---|
| P1-OBS-001 | Instrumentar claims, replay, conflict, pending age, lease lost, ambiguous, SQLite busy, HTTP, tools, auth e readiness. | Concluída localmente; scrape externo UNKNOWN | P0-IDEMP-002 | Labels bounded, unit/E2E e secret scan. |
| P1-OBS-002 | Implantar alertas Prometheus/Grafana. | Parcial; hosted UNKNOWN | P1-OBS-001 | Scrape real, alert firing, recovery, 13 alertas/15 métricas/12 painéis sem secrets. |
| P1-OBS-003 | Instrumentar device polling/pending/slow_down/denied/expired/replay. | Concluída localmente; alerting hosted UNKNOWN | P0-DEVICE-004 | Eventos presentes no `/metrics` e E2E. |
| P1-OBS-004 | Recovery pós-crash em pending sem reexecução não compensável. | Concluída localmente; runbook hosted UNKNOWN | IDEMP-P1-005 | Crash/reconcile/retry block/metrics e artifact sanitizado. |
| P1-OBS-005 | Monitor contínuo MCP e falhas Bearer. | Concluída localmente; scheduler/hosted UNKNOWN | P1-OBS-001 | Monitor once/continuous, JSONL sanitizado, fail-on-alert e Task Scheduler operacional. |
| P1-OBS-006 | Persistir carga p50/p95/p99, throughput, erros e amostras. | Concluída localmente; hosted UNKNOWN | P1-OBS-001 | Raw log permanente, percentis, samples sanitizadas e hash. |

---

# 5. Tasks P2 — performance, resiliência, UI, compatibilidade e integrações

| ID | Domínio | Task | Status | Dependências | Critério de aceite |
|---|---|---|---|---|---|
| P2-PERF-001 | UI bundle | Medir chunks Emacs Lisp/C++/WASM: raw/gzip/brotli/requests/entrypoint. | Parcial | P0-PERF-001 | Owner, motivo, bytes e impacto medidos. |
| P2-PERF-002 | UI bundle | Catálogo seletivo de linguagens e grammars sob demanda. | Parcial | P2-PERF-001 | Caminho inicial sem opcionais; seleção funcional. |
| P2-PERF-003 | UI performance | Comparar entrypoint, TTI, requests, parse cost antes/depois. | Backlog | P2-PERF-002 | Melhoria mensurável, sem aumento oculto de requests. |
| P2-PERF-004 | CI budget | Separar budgets de entrypoint, lazy chunks e requests. | Parcial | P2-PERF-003 | Cada budget falha somente pelo próprio limite. |
| P2-PERF-005 | Large payload | Medir file/diff/render de payloads grandes e backpressure. | Backlog | P2-PERF-003 | Memória, latência, truncation e visual sem regressão. |
| P2-UI-001 | UI/a11y | Landmarks, disclosure/live status, foco, teclado, touch targets, responsividade e journey recovery. | Concluída localmente; visual anterior parcial | P0-PERF-002 | Contracts, browser/a11y/visual e keyboard evidence. |
| P2-UI-002 | UI state | Epoch/revision contra callbacks obsoletos, retry, teardown e lazy result fora de ordem. | Concluída localmente; production host trace UNKNOWN | P2-UI-001 | Browser host/context e trace real. |
| STORYBOOK-360-001 | Storybook | Storybook 10, addon MCP/a11y, MSW e ESLint zero-warning. | Concluída | P0-BUILD-001 | Build/contracts/lint pass. |
| STORYBOOK-360-002 | Mock | Mock Layer determinística typed/interchangeable, states success/error/empty/loading/timeout/retry, streaming/tool-calling. | Concluída | STORYBOOK-360-001 | 4/4 contracts, no external calls by default. |
| STORYBOOK-360-003 | Stories | 7 fixtures/stories, play functions de retry/tool-calling/streaming. | Concluída | STORYBOOK-360-002 | Catalog coverage e story build. |
| STORYBOOK-360-BROWSER-001 | Browser | Playwright Chromium, webServer, reporter, trace/video/screenshot opt-in. | Concluída localmente | STORYBOOK-360-003 | Runner reproduzível e sanitizado. |
| STORYBOOK-360-BROWSER-002 | Browser interaction | Executar 7 stories e 2 interações críticas. | Concluída localmente | BROWSER-001 | 7/7, 2/2 PASS. |
| STORYBOOK-360-BROWSER-003 | A11y | axe `wcag2a`/`wcag2aa` nas 7 stories. | Concluída localmente após reparo | BROWSER-001 | 7/7 sem violações; sem supressão. |
| STORYBOOK-360-BROWSER-004 | Visual | Baselines 1280×720/light, diff e manifest. | Concluída localmente | BROWSER-001 | 7/7 visual PASS, 7 PNG + 7 WEBM hashados. |
| STORYBOOK-360-BROWSER-005 | Cross-OS | Browser-host em Windows/macOS/Linux e browsers suportados. | UNKNOWN | BROWSER-002 | Matrix real, artifacts por OS/browser e diff controlado. |
| STORYBOOK-360-BROWSER-006 | Host bridge | Exercitar MCP host-context/renderer direto, além do harness Storybook. | UNKNOWN | BROWSER-002 | Host real recebe schema, card, events, asset e lifecycle. |
| P2-API-001 | API | Extrair políticas MCP e reduzir acoplamento sem breaking change. | Concluída | P0-MCP-001; P1-SEC-003 | Policy tests, deny unknown e comandos preservados. |
| P2-API-002 | API/UI | Reduzir amplificação de resposta e rerender de cards. | Concluída localmente; trace UNKNOWN | P2-API-001 | content não duplicado; normalizador e carga reais. |
| P2-REST-001 | API | Revisar métodos, recursos, status, errors e compatibilidade REST. | Concluída como documentação | P2-API-001 | Matriz sem mudança breaking. |
| P2-DB-001 | Database | Índices/predicates quentes, cleanup e EXPLAIN. | Concluída | P0-IDEMP-002; P0-DEVICE-001 | Migration aditiva, cinco índices, query plan aprovado. |
| P2-LOAD-001 | Load | Smoke/baseline/ramp/sustained/burst/soak autenticados. | Concluída localmente; hosted UNKNOWN | P0-MCP-001; P1-OBS-006 | Wave 3 pass, percentis e raw. |
| P2-LOAD-002 | Chaos | Timeout/429/5xx/disconnect/reconnect/overload fail-closed. | Parcial; local PASS/hosted UNKNOWN | P2-LOAD-001 | Transitórios recuperam; persistentes exaurem; cleanup e secrets false. |
| P2-LOAD-003 | Calibration | Thresholds por região/tool em 3 execuções. | Backlog | P2-LOAD-001 | Variabilidade, intervalos e baseline versionados. |
| P2-SWARM-001 | Swarm | Agentes lógicos concorrentes, isolation, close/replay/recovery. | Concluída localmente; provider runtime UNKNOWN | P2-LOAD-001; P1-SESSION-001 | 96/96, isolamento/replay/recovery/cleanup. |
| P2-SWARM-002 | Swarm chaos | Falhas transitórias/persistentes com recovery fail-closed. | Concluída localmente; external UNKNOWN | SWARM-001; LOAD-002 | 7/7 cenários, fan-out, cleanup, secrets false. |
| P2-RES-001 | Operation | Indisponibilidade, restart, reauth e recovery de sessões. | Parcial | P1-OBS-004 | Restart/recovery local; reauth hosted. |
| P2-RES-002 | SQLite/fs | SQLite busy/full/readonly, missing root, child failure, cleanup. | Concluída localmente; OS/hosted UNKNOWN | P1-OBS-001 | HTTP/MCP real, no mutation, sanitization, cleanup. |
| P2-ERR-001 | Errors | Taxonomia centralizada, retryability, safe code/message. | Concluída localmente | P2-RES-002; P1-OBS-001 | FS/SQLite/timeout/auth/conflict/process/dependency sem leak. |
| P2-ERR-002 | Logging | Correlacionar HTTP/MCP sem secrets, commands, stdout, paths. | Concluída localmente; tracing external UNKNOWN | P2-ERR-001 | allowlist, truncated hashes, request ID e scan. |
| P2-FS-001 | Filesystem | Grandes/binários, symlink, case-insensitive e permissões por OS. | Parcial | P1-SEC-002 | Arquivos limites e OS matrix sem mutação indevida. |
| P2-PROC-001 | Process | timeout, abort, process group, crash ambiguity e PID reuse. | Parcial | P0-IDEMP-001; P1-IDEMP-009 | write_stdin ACK/fencing, cleanup e PID identity provados. |
| P2-LLAMA-001 | External MCP | Validar endpoint, schema, OAuth, quotas e região somente com acesso autorizado. | UNKNOWN | P0-MCP-001 | Endpoint/credencial/região reais ou UNKNOWN preservado. |
| P2-LLAMA-002 | External load | Carga docs pequena/grande, tool mix, timeout, 429/5xx/retries. | Backlog | LLAMA-001; LOAD-001 | Métricas por MB/tool e isolamento. |
| P2-LLAMA-003 | External authz | Cross-tenant, session transfer, duplicate e cleanup externo. | Backlog | LLAMA-001 | Nenhum contexto cruza identidade. |
| P2-LLAMA-004 | BYOC | Self-host/BYOC com cluster, values, secrets, upgrade e rollback. | UNKNOWN | LLAMA-001 | Prova autorizada, não documentação isolada. |
| P2-NET-001 | Dev env | Network share, discovery, firewall, DNS, SSDP/UPnP e ACL. | Backlog | P2-RES-002 | Runbook separa conectividade, discovery, ACL e credenciais. |

---

# 6. Tasks P3 — CI/CD, release, operação e evidência

| ID | Domínio | Task | Status | Dependências | Critério de aceite |
|---|---|---|---|---|---|
| P3-CI-001 | CI/CD | Separar PR smoke, matriz completa e nightly load/chaos. | Parcial | P0-CI-001; P2-LOAD-001 | PR rápido; nightly/release completo e artifacts publicados. |
| P3-CI-002 | Staging | Executar `staging-load` hospedado com `CI=true`, roots temporários e token exclusivo. | Parcial; hosted UNKNOWN | P0-REL-001 | Job real, logs, metrics, cleanup, secrets false. |
| P3-REL-001 | Supply chain | Dependency audit, secret scan, SBOM, provenance, assinatura/checksum. | Backlog | P0-REL-001 | Artifact rastreável ao commit e sem credenciais. |
| P3-REL-002 | Recovery | Rollback, disaster recovery, SQLite backup/restore e retenção. | Backlog | P3-REL-001 | Drill restaura serviço sem perda silenciosa. |
| P3-REL-003 | Governance | Gates corporativos de security/compliance/reviewer/owner/promoção versionada. | Parcial | P3-REL-001 | Aprovação, audit trail e rollback auditáveis. |
| P3-OPS-001 | Operations | Documentar deps, dev env, build, test, deploy, actions, tasks, auth e diagnostics. | Parcial | P0-BUILD-001 | Novo operador executa caminhos principais. |
| P3-OPS-002 | Scheduling | Registrar monitor em Windows Task Scheduler ou alternativa autorizada. | Parcial | P1-OBS-005 | Conta/ACL, intervalo, output, restart e rollback operacional. |
| P3-OPS-003 | Evidence | Preservar screenshots/vídeos como suporte, nunca como assertion única. | Parcial | P0-MCP-001 | Mídia sanitizada ligada a RAW-ID e hash. |
| P3-EVID-001 | Evidence | Indexar raws byte a byte com SHA-256. | Concluída localmente | P3-DOC-001 | Manifest e índice sem divergências. |
| P3-DOC-001 | Docs | Manter matriz de fluxos, aceite, DoR/DoD, reports e evidence map. | Concluída localmente | P0-DISC-003 | Findings referenciam artifact ou UNKNOWN. |
| P3-DOC-002 | Docs | Gerar scripts, slides e notas sem contradizer evidências. | Parcial | P3-DOC-001 | Cada número tem fonte e status. |
| P3-SKILL-001 | Skills | Manter `e2e-360-engineering` reutilizável. | Concluída | P0-BUILD-001 | Workflow e self-test disponíveis. |
| P3-SKILL-002 | Skills | Manter `e2e-oauth-mcp-p0` com 23 IDs e secret scan. | Concluída | P0-SEC-001 | IDs estáveis e CI. |
| P3-SKILL-003 | Skills | Manter `e2e-idempotency-mcp-p1` com hash/lease/recovery/obs. | Concluída | IDEMP-P1 | Fixture não apresentada como E2E real. |
| P3-SKILL-004 | Skills | Manter skills Wave 1/2/3, swarm resilience e chaos. | Concluída | Waves 1–3 | `quick_validate.py` e runners executáveis. |
| P3-SKILL-005 | Skills | Reconciliar skills externas/Medusa somente no repositório correto. | Externo / fora do escopo DevSpace | — | Branch, remotes, PR/roadmap e working tree do repo externo não devem ser alterados pelo DevSpace sem autorização explícita. |

---

# 7. Tasks P4 — produto, arquitetura e maturidade

| ID | Domínio | Task | Status | Dependências | Critério de aceite |
|---|---|---|---|---|---|
| P4-PROD-001 | Product | Obter fonte autoritativa de WHY, WHO, personas, JTBDs e outcomes. | Backlog | — | PRD de negócio e owner sign-off; G8 desbloqueado. |
| P4-PROD-002 | Product | Definir owner/persona/outcome para cada feature/route/surface. | Backlog | P4-PROD-001 | Orphans e route-without-feature justificados ou eliminados. |
| P4-PROD-003 | Product | Medir outcome real, adoção, sucesso e falha, não apenas execução técnica. | Backlog | P4-PROD-001 | Métricas com owner, janela e baseline. |
| P4-OBS-001 | Observability | Fechar provenance, telemetry e outcome verification do Canonical 360. | Backlog | P3-REL-001; P4-PROD-003 | G5/G6/G7 com runtime verificável. |
| P4-OBS-002 | Observability | Criar tendência histórica de p50/p95, erros, retries, chunks, coverage e drift. | Backlog | P1-OBS-006; P2-PERF-003 | Regressões comparadas a baseline versionado. |
| P4-ARCH-001 | Architecture | Reavaliar modular monolith versus serviços separados por carga/ownership. | Backlog | P2-LOAD-001; P4-PROD-002 | ADR com custo, risco, latência e evidência. |
| P4-ARCH-002 | Architecture | Avaliar isolamento tenant/workspace/region para expansão multiusuário. | Backlog | P1-SESSION-002 | Cross-tenant E2E e ADR de isolamento. |
| P4-SEC-001 | Security | Rotacionar pepper, owner secret e signing keys com recovery. | Backlog | P1-OBS-001; P3-REL-002 | Rotação sem invalidação indevida e rollback. |
| P4-SEC-002 | Supply chain | Threat model de SDK MCP, agent/model adapters e dependências nativas. | Backlog | P3-REL-001 | Riscos, mitigação, owner e prazo. |
| P4-UX-001 | UX | Medir login PKCE/device, tempo até autorização, cancelamento e erros. | Backlog | P0-DEVICE-006; P1-DEVICE-013 | UX report baseado em métricas reais. |
| P4-UI-001 | UI | Expandir Atomic Design somente se a arquitetura real justificar; não criar taxonomia artificial. | Parcial/intencional | Storybook integration | Componentes novos devem reconciliar Component↔Story↔Unit↔E2E↔Mock e preservar tokens/a11y. |
| P4-PRD-001 | Governance | Manter PRD/Blueprint canônico sincronizado com AS IS/TO BE e UNKNOWNs. | Concluída como extração; atualização contínua | P0-CANON-001 | Reexecutar após mudanças estruturais; hashes e matriz atualizados. |

---

# 8. Matriz de cobertura por domínio

| Domínio | Componentes/artefatos | Unit/contract | Integration/HTTP | E2E real | UI/browser | Mock/fixture | Gap principal |
|---|---|---|---|---|---|---|---|
| Auth PKCE | `oauth-provider`, store, routes | PASS | PASS | PASS | n/a | OAuth test helpers | key rotation/hosted gateway |
| Device Grant | device store/routes/CLI | PASS | PASS | PASS | parcial | device fixtures | OS matrix/identity hosted |
| MCP session | `server`, policy, transport | PASS | PASS | PASS | host bridge UNKNOWN | MCP request fixtures | full host lifecycle matrix |
| Workspace | `workspaces`, roots, store | PASS | PASS | PASS | n/a | temp roots | cross-OS/tenant binding |
| Filesystem | roots/file tools | PASS | PASS | PASS | n/a | temp filesystem | large/binary/case OS |
| Process/stdin | process sessions/server | PASS | PASS parcial | PASS parcial | n/a | process fixtures | ACK/fencing/crash/PID reuse |
| Idempotency | store/server/migrations | PASS | PASS | write PASS | n/a | deterministic payloads | write_stdin durable ACK |
| Observability | logger/metrics/monitor | PASS | PASS | local PASS | n/a | sanitized events | hosted scrape/firing/recovery |
| Storybook/UI | stories/mocks/MSW/UI | PASS | build/contracts PASS | browser PASS | 7/7 Chromium | 7 fixtures | cross-OS/host-context |
| Performance | bundle audit/load runners | PASS | local PASS | Wave 3 PASS | Storybook visual PASS | fixed fixtures | chunks/hosted calibration |
| Swarm | resilience/chaos runners | PASS | local PASS | 96/96 local | n/a | fault adapters | provider/real model/external network |
| CI/release | workflows/scripts/artifacts | partial | local gates PASS | hosted UNKNOWN | n/a | n/a | deploy/SBOM/provenance/rollback |
| Product | PRD/Blueprint/backlog | schema validation PASS | n/a | n/a | n/a | n/a | business source/KPIs/owner |

---

# 9. Sequência recomendada por sprints

| Sprint | Foco | Tasks principais | Saída de aceite |
|---|---|---|---|
| 1 | Efeitos e processos | `P1-IDEMP-009`, `P1-IDEMP-010`, `P2-PROC-001`, `IDEMP-P1-005` | Crash entre write e ACK provado; ambiguous/reconcile/fencing sem duplicação. |
| 2 | Identidade e autorização | `P1-AUTHZ-001`, `P1-AUTHZ-002`, `P1-SESSION-002`, `P1-DEVICE-009`, `P1-SEC-004` | RBAC/grants, gateway, ACL, key rotation e cross-scope fail-closed. |
| 3 | Observabilidade operacional | `P1-OBS-002`, `P1-OBS-005`, `P3-OPS-002` | Scrape, firing/recovery, scheduler, runbook e logs sanitizados. |
| 4 | Compatibilidade e UI | `P1-SEC-002`, `P1-DEVICE-012`, `STORYBOOK-360-BROWSER-005`, `STORYBOOK-360-BROWSER-006`, `P2-FS-001` | Linux/macOS/Windows, browsers, host bridge e filesystem matrix. |
| 5 | Performance e carga | `P2-PERF-001..005`, `P2-LOAD-002..003`, `P4-OBS-002` | Budgets separados, bytes/TTI/requests, calibração e tendência. |
| 6 | Staging e release | `P3-CI-001..002`, `P3-REL-001..003`, `P3-REL-002` | SBOM/provenance, artifact, deploy, rollback, restore e smoke pós-release. |
| 7 | Integrações autorizadas | `P2-LLAMA-001..004`, `P2-NET-001` | Somente com endpoint/credencial/região autorizados; caso contrário UNKNOWN preservado. |
| 8 | Produto e arquitetura | `P4-PROD-001..003`, `P4-ARCH-001..002`, `P4-UX-001`, `P4-UI-001` | PRD de negócio, ownership, outcomes, ADR e evolução sem drift. |

A ordem prioriza primeiro integridade destrutiva, identidade e observabilidade, porque esses itens são pré-condições para declarar readiness. Integrações externas não devem bloquear nem ser marcadas como concluídas sem autorização e execução real.

---

# 10. Gates de saída E2E 360°

| Gate | Condição de passagem |
|---|---|
| G0 — Descoberto | topology, stack, surfaces, routes, features, tests e evidence manifest presentes |
| G1 — Contratado | schemas, contratos HTTP/MCP, PRD/Blueprint, DoR e DoD definidos |
| G2 — Implementado | código, migrations, CLI, handlers, adapters e docs versionados |
| G3 — Testado | unit, contract, HTTP E2E, MCP E2E e matriz negativa cobrem caminho crítico |
| G4 — Reproduzível | self-scan, build, artifacts, hashes, seeds, cleanup e resultados determinísticos |
| G5 — Deployable | provenance, SBOM, artifact, promoção, rollback e restore comprovados |
| G6 — Operável | health, telemetry, logs sanitizados, alertas firing/recovery e runbooks ativos |
| G7 — Runtime verified | outcome, latência, erro, recovery, carga e comportamento real medidos |
| G8 — Produto | WHY, WHO, JTBD, owner, personas, KPIs e outcomes têm fonte autoritativa |
| G9 — Evolução | backlog, riscos, dependências, DoR/DoD e evidências atualizados a cada ciclo |

**Estado atual:** G0–G4 comprovados localmente; G5 RED/PARTIAL; G6 PARTIAL; G7 GREEN local/PARTIAL hosted; G8 BLOCKED por ausência de fonte de negócio; G9 ativo.

---

# 11. DoR/DoD mínimo para cada nova task

| DoR | DoD |
|---|---|
| Problema, contrato, actor, inputs/outputs e fora de escopo definidos | Código real implementado, compatível e revisado |
| Componentes, API, banco, segurança e observabilidade afetados mapeados | Lint, typecheck, tests, build e gates do risco passam |
| Oráculo, fixture, ambiente, comando e cleanup definidos | Exit code, stdout/stderr, artifact, duração e SHA-256 preservados |
| Riscos P0–P4, dependências e rollback definidos | Logs/metrics sanitizados; nenhum secret/payload/command leak |
| Status inicial não é promovido por inferência | Status final distingue GREEN/PARTIAL/BLOCKED/RED/UNKNOWN |
| Caminho real de consumo identificado | Backlog, PRD/Blueprint, DoR/DoD e evidence index atualizados |

---

# 12. Decisão e próximo corte

O próximo corte de maior impacto é **P1-IDEMP-009/P1-IDEMP-010**: fechar o crash window entre `process.write(chars)` e a confirmação durable do idempotency store. A execução deve iniciar um servidor HTTP/MCP real com state SQLite temporário, autenticar OAuth, abrir workspace, iniciar processo, enviar stdin com `idempotencyKey` e `inputSequence`, matar o processo no intervalo controlado, reiniciar, observar `pending/ambiguous`, provar que não houve segundo envio de chars, executar reconciliação/fencing e preservar métricas/artifacts sanitizados. A implementação não deve transformar o status em PASS antes de esse oráculo existir.

Em paralelo, o segundo corte é **P1-AUTHZ-001/P1-DEVICE-009** para RBAC/grants e gateway de identidade, seguido de **P1-OBS-002** para alert firing/recovery hosted. O bundle warning, cross-OS browser, host bridge, LlamaParse e release provenance permanecem P2/P3 conforme as dependências acima.

---

## Referências internas

1. `docs/e2e-360-task-list.md` — backlog histórico e evidências já consolidadas.
2. `docs/e2e-360-task-matrix.md` — matriz anterior de cobertura e DoR/DoD.
3. `artifacts/canonical-360/` — reverse engineering, manifest, report e gates.
4. `artifacts/wave1-p0/`, `artifacts/wave2-chaos/`, `artifacts/wave3-performance/` — ondas P0, chaos e performance.
5. `artifacts/oauth-mcp-negative-report.json` — 23 IDs negativos OAuth/Bearer/MCP.
6. `artifacts/idempotency-p1-report.json`, `artifacts/idempotency-recovery-report.json`, `artifacts/write-stdin-idempotency-report.json` — idempotência e recovery.
7. `artifacts/storybook-360-mcp-e2e/` — Mock Layer, Storybook, browser-host, a11y, visual e mídia hashada.
8. `artifacts/canonical-prd-blueprint-360/` — PRD, Blueprint, matriz, resumo, manifest e validação.
9. `scripts/e2e-http-mcp*.test.mjs`, `scripts/run-wave*.mjs`, `scripts/run-p0-negative-matrix.py` — runners reais.
10. `src/server.ts`, `src/idempotency-store.ts`, `src/process-sessions.ts`, `src/oauth-provider.ts`, `src/metrics.ts`, `src/logger.ts` — contratos de runtime.


---

# 13. Ciclo executado — crash recovery durable de `write_stdin`

**Task:** `P1-IDEMP-009/P1-IDEMP-010`
**Status:** **GREEN local / PARTIAL hosted / NOT RELEASE-READY**
**Objetivo:** provar o intervalo real entre o efeito de `process.write(chars)` e a confirmação durable do idempotency store, sem retry automático nem duplicação do efeito.

| Item | Resultado comprovado |
|---|---|
| Transporte | HTTP/MCP real |
| Autorização | OAuth authorization-code PKCE S256 |
| Efeito | `crash-once\\n` observado no arquivo alvo antes do crash |
| Estado durable | registro `pending` preservado no SQLite |
| Retry antes de reconciliação | fail-closed com `IDEMPOTENCY_REQUEST_IN_PROGRESS` |
| Reconciliação | estado convertido explicitamente para `failed` com `IDEMPOTENCY_AMBIGUOUS_RECONCILED` |
| Retry após reconciliação | bloqueado com `IDEMPOTENCY_REQUEST_FAILED` |
| Duplicação | `effect_replayed=false`; conteúdo escrito exatamente uma vez |
| Observabilidade | métricas presentes e sem key/chars nos payloads |
| Secrets | `secrets_included=false` |
| CI | comando incluído em `.github/workflows/ci.yml`; execução hosted do SHA permanece UNKNOWN |

**Implementação:** `scripts/e2e-http-mcp-write-stdin-recovery.test.mjs`, script `e2e:write-stdin:recovery` em `package.json` e gate/upload por OS em `.github/workflows/ci.yml`.

**Evidências:** `artifacts/write-stdin-crash-recovery-report.json`, `artifacts/e2e-360-next-cut-20260820/next-cut-gate-summary.json`, logs por gate no mesmo diretório, `REMOTE-CI-EVIDENCE.md` e manifest SHA-256 a ser gerado após a revisão.

**Limite:** o slice prova reconciliação explícita e fail-closed após restart em ambiente local. Não prova tenant isolation multi-tenant (`tenantId`, workspace/region RBAC), fencing entre duas instâncias concorrentes, execução hosted em Ubuntu/macOS/Windows, alert firing/recovery ou deploy/rollback.

**Próximo aceite P1:** executar o workflow hosted em matriz OS, capturar artifacts por OS, adicionar cenário de fencing/split-brain e definir a identidade durável do process session para evitar colisões de `sessionId` após restart.
