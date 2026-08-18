# DevSpace — Backlog de Tasks E2E 360º

**Data de revisão:** 18 de agosto de 2026  
**Repositório:** `devspace`  
**Branch:** `main`  
**Commit de referência:** `ca6867a`
**Working tree:** limpo  
**Topologia Canonical 360º:** `MODULAR_MONOLITH`  
**Objetivo:** manter uma matriz executável que prove os caminhos críticos de descoberta, autenticação, MCP, sessão, autorização, persistência, filesystem, processos, UI, performance, observabilidade, CI/CD, operação, release e maturidade de produto.

> Uma task crítica somente pode ser marcada como **Concluída** quando possuir implementação versionada, teste executável, evidência sanitizada, critério de aceite verificável e cleanup determinístico. Quando depender de ambiente externo, identidade real ou credencial não disponível, o status permanece **Parcial** ou **UNKNOWN**.

## 1. Legenda operacional

| Status | Regra |
|---|---|
| **Concluída** | Implementação e evidência executável disponíveis no ambiente validado. |
| **Parcial** | O caminho principal existe, mas falta prova operacional, matriz de sistemas, reconciliação, integração ou requisito de produção. |
| **Backlog** | A task ainda não foi implementada ou não possui evidência suficiente. |
| **UNKNOWN** | A conclusão depende de ambiente, credencial, endpoint, identidade ou execução externa ainda não disponível. |

| Prioridade | Interpretação |
|---|---|
| **P0** | Bloqueia segurança, integridade, release ou caminho crítico. |
| **P1** | Risco alto de produção, autorização, efeitos destrutivos ou operação. |
| **P2** | Performance, resiliência, compatibilidade e integrações. |
| **P3** | Governança, CI/CD, release, documentação e operação repetível. |
| **P4** | Produto, arquitetura, outcomes e maturidade evolutiva. |

## 2. Evidência já consolidada

| Área | Resultado atual | Evidência principal |
|---|---|---|
| Baseline e Canonical 360º | Concluído; scanner, schema, manifest, report, DoR/DoD e backlog gerados. | `artifacts/canonical-360/manifest.json`, `report.md`, `gates-dor-dod.md` |
| Onda 1 P0 | 16/16 gates aprovados; HTTP/MCP real, OAuth, segurança e cleanup. | `artifacts/wave1-p0/summary.json` |
| Matriz negativa | 23/23 IDs OAuth/Bearer/MCP aprovados fail-closed. | `scripts/run-p0-negative-matrix.py`, `artifacts/oauth-mcp-negative-report.json` |
| Device Authorization | Grant HTTP/CLI, migration, hashes HMAC, polling, TTL, consumo único, ACL privada e cancelamento configurável implementados localmente; matriz OS/identidade real permanece UNKNOWN. | `scripts/e2e-oauth-device.test.mjs`, `scripts/e2e-oauth-device-cli.test.mjs`, `artifacts/oauth-device-cli-security-report.json` |
| Idempotência P1 | IDEMP-P1-001..008 aprovados; `effect_count=5`; sem secret leak. | `artifacts/idempotency-p1-report.json` |
| Onda 2 Chaos | 11/11 cenários aprovados; restart, indisponibilidade e recovery comprovados. | `artifacts/wave2-chaos/summary.json` |
| Observabilidade | Métricas de idempotência e eventos Device Flow, nove alertas, sete painéis e validator local aprovados; alert firing hosted permanece UNKNOWN. | `src/metrics.ts`, `observability/`, `artifacts/observability-contract-report.json`, `artifacts/block1-identity-report.json` |
| Baseline de carga | 20 amostras, concorrência 4, p50=14 ms, p95=19 ms, p99=19 ms. | `artifacts/mcp-load-log.json` |
| Onda 3 Performance/Soak | Ramp, sustained, burst e soak aprovados em servidor isolado real na porta 17679. | `artifacts/wave3-performance/summary.json` |
| Retenção de raws | 81 raws arquivados byte a byte, 983.794 bytes, 0 divergências SHA-256. | `evidence/raw-evidence-manifest.json`, `docs/raw-evidence-index.md` |
| Dev environment | `/healthz` respondeu HTTP 200 na última validação. | `http://127.0.0.1:7676/healthz` |

### 2.1. Métricas da Onda 3

| Perfil | Samples | Concorrência | Throughput | p50 | p95 | p99 | Status |
|---|---:|---:|---:|---:|---:|---:|---|
| Ramp `1→4→8→16` | 40 | até 16 | 60,42 req/s | 37 ms | 47 ms | 47 ms | PASS |
| Sustained | 20 | 4 | 128,21 req/s | 30 ms | 36 ms | 36 ms | PASS |
| Burst | 40 | 8 | 239,52 req/s | 31 ms | 36 ms | 37 ms | PASS |
| Soak | 60 | 4 | 133,63 req/s | 25 ms | 47 ms | 51 ms | PASS |

Essas métricas qualificam o build e o servidor isolado testados. Não constituem, isoladamente, uma declaração de capacidade de produção, múltiplos nós, rede externa ou autoscaling.

### 2.2. Linha do tempo consolidada do histórico

| Marco | Resultado consolidado | Evidência/rastreabilidade |
|---|---|---|
| Reverse Engineering Canonical 360º | Scanner, schema, manifest, report, gates DoR/DoD e self-scan concluídos. | `7c10538f`, `artifacts/canonical-360/` |
| OAuth Device Authorization | Migration, HMAC, TTL, polling, consumo único, endpoints HTTP, CLI e E2E concluídos. | `593d0779`, `scripts/e2e-oauth-device*.test.mjs` |
| Wave 1 P0 | 16/16 gates aprovados contra HTTP/MCP real. | `acd2d8c`, `artifacts/wave1-p0/summary.json` |
| Wave 2 Chaos | 11/11 cenários aprovados, incluindo restart e recuperação. | `16c1df2`, `artifacts/wave2-chaos/summary.json` |
| Wave 3 Performance/Soak | Ramp, sustained, burst e soak aprovados com percentis e throughput. | `2c74ea2`, `e5dc207`, `artifacts/wave3-performance/summary.json` |
| Monitor Bearer | Monitor Node/PowerShell, contrato E2E real e integração CI concluídos localmente. | `537f567`, `artifacts/mcp-monitor-contract.json` |
| Bloco 1 de identidade | Trusted identity HMAC, scopes por tool, token subject, rotation e `/revoke` concluídos localmente. | `f018a7b`, `evidence/raw/block1-identity-report.json` |
| Observabilidade Device Flow | Eventos requested/pending/slow_down/approved/consumed/denied/expired/rejected/rate_limited instrumentados e observados no `/metrics`. | `6df43d3`, `99d7e9d`, `mcp_oauth_device_event_total` |
| Retenção de evidências | Raws preservados byte a byte com manifest SHA-256 e índice navegável. | `evidence/raw-evidence-manifest.json`, `docs/raw-evidence-index.md` |

### 2.3. Próximos cortes de maior impacto

| Ordem | Issue | Foco | Condição de encerramento |
|---:|---|---|---|
| 1 | `P1-OBS-002` | Alertas Prometheus/Grafana em ambiente operacional | Alert firing, recovery, scrape externo e ausência de secrets comprovados. |
| 2 | `P1-DEVICE-009` | Gateway de identidade real | Sessão autenticada, ACL, audit trail e headers forjados bloqueados em staging/produção. |
| 3 | `P1-DEVICE-012..013` | ACL e cancelamento CLI | Matriz OS, Ctrl-C, timers, credenciais e cleanup comprovados. |
| 4 | `P3-CI-002`, `P2-LOAD-002..003` | Carga hosted e calibração | `staging-load` publicado, três rodadas calibradas e artifacts versionados. |
| 5 | `P2-PROC-001`, `P2-RES-002` | Processos e infraestrutura | `write_stdin`, bash, SQLite lock/cheio, filesystem read-only e cleanup comprovados. |

## 3. Tasks P0 — descoberta, contratos, segurança e release

| ID | Domínio | Task | Status | Dependências | Critério de aceite / evidência |
|---|---|---|---|---|---|
| P0-DISC-001 | Descoberta | Registrar branch, commit, working tree, `AGENTS.md`, runtime, package manager, entrypoints e scripts oficiais. | Concluída | — | Baseline reproduzível e instruções locais preservadas. |
| P0-DISC-002 | Canonical | Executar scanner 360º e gerar topology, surfaces, features, routes, tests e evidence. | Concluída | P0-DISC-001 | Manifest determinístico e schema válido. |
| P0-DISC-003 | Contratos | Gerar report, DoR/DoD, gates e backlog inicial P0–P4. | Concluída | P0-DISC-002 | Artefatos presentes e findings com evidência ou `UNKNOWN`. |
| P0-BUILD-001 | Build | Rodar typecheck, testes, build, coverage, bundle audit e doctor antes/depois das alterações. | Concluída | P0-DISC-001 | Gates retornam exit code 0; thresholds não são reduzidos. |
| P0-CI-001 | CI | Manter install reproduzível com lockfile e matriz Linux/macOS/Windows. | Concluída | P0-BUILD-001 | `npm ci` não altera lockfile; matriz configurada no CI. |
| P0-AUTH-001 | OAuth PKCE | Validar metadata, dynamic registration, verifier, challenge S256, authorization e token exchange. | Concluída | P0-BUILD-001 | Happy path contra servidor real com artifact sanitizado. |
| P0-AUTH-002 | OAuth PKCE | Rejeitar verifier incorreto, redirect divergente, cliente inexistente, code expirado e replay. | Concluída | P0-AUTH-001 | Erros esperados sem emissão ou uso privilegiado. |
| P0-AUTH-003 | Bearer | Rejeitar token ausente, scheme inválido, token inválido, expirado/revogado e resource incompatível. | Concluída | P0-AUTH-001 | Nenhuma tool ou sessão privilegiada após rejeição. |
| P0-AUTH-004 | Sessão | Vincular sessão a `clientId`, `resource` e principal; impedir transferência. | Concluída | P0-AUTH-001 | `SESSION-NEG-001..004` passam fail-closed. |
| P0-MCP-001 | MCP | Executar `initialize`, `mcp-session-id`, `notifications/initialized`, `tools/list`, leitura e escrita. | Concluída | P0-AUTH-001 | Handshake e tools contra HTTP/MCP real. |
| P0-MCP-002 | MCP negativo | Rejeitar JSON-RPC inválido, content type, método desconhecido, lifecycle fora de ordem e sessão desconhecida. | Concluída | P0-MCP-001 | Nenhum efeito colateral; IDs negativos aprovados. |
| P0-SEC-001 | Segurança | Executar a matriz de 23 IDs negativos OAuth/MCP no runner real. | Concluída | P0-AUTH-002, P0-AUTH-003, P0-MCP-002 | 23/23 pass, cleanup em `finally`, exit code 0. |
| P0-SEC-002 | Segurança | Sanitizar stdout, stderr, logs, banco exportado e artifacts. | Concluída | P0-SEC-001 | `secret_leak_detected=false` e scan limpo. |
| P0-IDEMP-001 | Idempotência | Integrar a store durável no handler real de escrita com scope derivado do principal. | Concluída | P0-MCP-001 | Retry não duplica efeito; cliente não fornece scope. |
| P0-IDEMP-002 | SQLite | Persistir `pending`, `succeeded`, `failed`, hash canônico e fencing `lease_token`. | Concluída | P0-IDEMP-001 | Migration idempotente; finalização exige lease correto. |
| P0-PERF-001 | Bundle | Gerar manifest de entrypoint, chunks lazy, dynamic imports e assets maiores. | Concluída | P0-BUILD-001 | JSON válido e gate de budget funcional. |
| P0-PERF-002 | UI | Preservar lazy loading de módulos pesados sem contaminar o caminho inicial. | Concluída | P0-PERF-001 | Grafo de imports e comportamento funcional aprovados. |
| P0-REL-001 | Release | Bloquear release quando build, typecheck, E2E, P0, coverage, bundle ou secret scan falhar. | Concluída | Todas P0 | Qualquer exit code não zero interrompe pipeline. |

## 4. Tasks P0 — Device Authorization Grant

| ID | Task | Status | Dependências | Critério de aceite / evidência |
|---|---|---|---|---|
| P0-DEVICE-001 | Criar migration da tabela `oauth_device_authorizations`, estados, TTL, polling e timestamps. | Concluída | P0-BUILD-001 | Migration 6 atualiza estado existente sem destruição; migration 7 adiciona subject_id aos tokens. |
| P0-DEVICE-002 | Gerar `device_code`/`user_code` e persistir apenas hashes HMAC com pepper configurável. | Concluída | P0-DEVICE-001 | Códigos em claro não aparecem no banco ou artifacts. |
| P0-DEVICE-003 | Implementar pending/approved/denied/consumed/expired e consumo único. | Concluída | P0-DEVICE-002 | Replay retorna `invalid_grant`; estados finais não emitem token. |
| P0-DEVICE-004 | Expor metadata, request device, verification web, aprovação/negação e token exchange. | Concluída | P0-DEVICE-003 | Grant compatível com RFC 8628 e erros sanitizados. |
| P0-DEVICE-005 | Validar binding de `client_id`, `resource` e scopes antes do consumo. | Concluída | P0-DEVICE-004 | Divergência rejeitada sem consumir autorização válida. |
| P0-DEVICE-006 | Implementar CLI `auth login --device`, polling, `--no-browser`, logout e persistência. | Concluída | P0-DEVICE-004 | CLI E2E completa login real e não imprime secrets. |
| P0-DEVICE-007 | Preservar fallback `auth login --pkce`. | Concluída | P0-AUTH-001 | Callback valida state/verifier e troca code por token. |
| P0-DEVICE-008 | Integrar contract, E2E HTTP e E2E CLI ao CI. | Concluída | P0-DEVICE-006 | Gates executáveis na matriz suportada. |

## 5. Tasks P1 — riscos altos de produção

### 5.1. Idempotência e efeitos destrutivos

| ID | Task | Status | Dependências | Critério de aceite / próxima evidência |
|---|---|---|---|---|
| IDEMP-P1-001 | Primeira escrita com uma chave produz exatamente um efeito. | Concluída | P0-IDEMP-001 | Snapshot antes/depois e `effect_count` único. |
| IDEMP-P1-002 | Replay de mesma chave/payload retorna resultado persistido sem segundo efeito. | Concluída | IDEMP-P1-001 | Filesystem e banco sem mutação adicional. |
| IDEMP-P1-003 | Mesma chave com payload diferente retorna conflito 409. | Concluída | IDEMP-P1-002 | Hash divergente rejeitado antes do efeito. |
| IDEMP-P1-004 | Claims concorrentes mantêm um owner efetivo. | Concluída | P0-IDEMP-002 | Um lease executa; concorrente recebe pending/conflict. |
| IDEMP-P1-005 | Timeout pós-commit é tratado como `ambiguous`, sem retry cego. | Concluída localmente; interface operacional UNKNOWN | IDEMP-P1-004 | E2E HTTP/MCP real mata servidor entre claim e efeito, preserva pending, retorna ambiguous, reconcilia explicitamente e bloqueia retry; falta superfície operacional autenticada. |
| IDEMP-P1-006 | Mesma chave em scopes diferentes permanece isolada. | Concluída | P0-IDEMP-001 | Dois scopes produzem efeitos independentes. |
| IDEMP-P1-007 | Retenção expirada exige nova intenção explícita. | Parcial | IDEMP-P1-002 | Validar retenção durante operação prolongada e restart. |
| IDEMP-P1-008 | Banco, logs e artifacts não contêm secrets/payloads sensíveis. | Concluída | P0-SEC-002 | Report P1 e archive RAW sem potential match. |
| P1-IDEMP-009 | Estender idempotência para `write_stdin` e comandos bash. | Backlog | IDEMP-P1-005, P2-PROC-001 | Replay, conflito, lease e crash sem reexecução cega. |

### 5.2. Autorização, recursos, tools e CLI

| ID | Task | Status | Dependências | Critério de aceite / próxima evidência |
|---|---|---|---|---|
| P1-SEC-001 | Rate limiting para request device, approval e polling por client/IP. | Parcial — local aprovado, hosted UNKNOWN | P0-DEVICE-004 | 429/`slow_down`, `Retry-After`, legítimo preservado e métrica consultável. |
| P1-SEC-002 | Cobrir traversal, symlink escape, roots allowlist, hosts e origins por OS. | Concluída localmente em Windows; traversal/OS matrix UNKNOWN | P0-MCP-001 | `resolveAllowedPathReal` bloqueia symlink e parent symlink em `read`, `write` e `bash` antes do efeito; E2E HTTP/MCP Windows PASS; falta matriz macOS/Linux, hosts/origins e traversal completo. |
| P1-SEC-003 | Validar scopes por ferramenta, resource e cliente. | Concluída localmente; gateway/hosted UNKNOWN | P0-AUTH-003 | `read` permite leitura, bloqueia escrita/processo com 403, resource/client binding e matriz negativa passam; falta prova hosted do gateway. |
| P1-SEC-004 | Cobrir expiração, revogação e rotação de tokens PKCE/device. | Concluída localmente; key rotation UNKNOWN | P0-AUTH-001, P0-DEVICE-004 | Refresh rotation, replay denial, `/revoke`, Bearer 401 e persistência após restart passam; rotação de chaves ainda não executada. |
| P1-SESSION-001 | Rejeitar replay após close, reconexão parcial, ID desconhecido e lifecycle inválido. | Concluída | P0-AUTH-004 | Casos SESSION negativos aprovados. |
| P1-SESSION-002 | Adicionar binding workspace/tenant/region para evolução multi-tenant. | Backlog | P1-SEC-003 | Nenhuma transferência cross-tenant/workspace/region. |
| P1-MCP-001 | Cobrir matriz tool-by-tool para leitura, escrita, processos e artifacts. | Parcial | P0-MCP-001 | Cada tool tem auth, scope, root e idempotência testados. |
| P1-MCP-002 | Cobrir body inválido, tamanho máximo, JSON-RPC duplicado e content type. | Parcial | P0-MCP-002 | Falha não cria sessão nem efeito. |
| P1-DEVICE-009 | Substituir owner-token form por sessão de usuário autenticada na aprovação web. | Parcial — trusted gateway local; identidade real UNKNOWN | P0-DEVICE-004 | Modo `trusted_header`, HMAC subject-bound, UI sem owner field e Device E2E passam; falta gateway de identidade real, ACL e audit trail hosted. |
| P1-DEVICE-010 | Implementar refresh-token rotation e revocation endpoint. | Concluída localmente; hosted UNKNOWN | P0-DEVICE-006 | `/revoke` anunciado no metadata, refresh antigo falha após rotation/replay e access revogado retorna 401. |
| P1-DEVICE-011 | Completar `verification_uri_complete` e UX de copiar código sem browser. | Concluída | P0-DEVICE-006 | URL/código informados sem vazar token. |
| P1-DEVICE-012 | Validar armazenamento local e ACL equivalente a 0600 em Windows/macOS/Linux. | Concluída localmente em Windows; macOS/Linux UNKNOWN | P0-DEVICE-006 | `credential-security.ts` aplica/inspeciona modo 0600 em POSIX e ACL sem herança em Windows; E2E Windows PASS; falta executar matriz macOS/Linux. |
| P1-DEVICE-013 | Tornar timeout e cancelamento de polling configuráveis. | Concluída localmente em Windows; matriz OS/hosted UNKNOWN | P0-DEVICE-006 | `--poll-timeout-seconds`, `DEVSPACE_OAUTH_POLL_TIMEOUT_SECONDS`, Ctrl-C/byte ETX, timers e cleanup de processo passam no E2E real; falta matriz OS e operação hosted. |

### 5.3. Observabilidade e recuperação

| ID | Task | Status | Dependências | Critério de aceite / próxima evidência |
|---|---|---|---|---|
| P1-OBS-001 | Instrumentar claim, replay, conflict, pending age, lease lost, ambiguous e SQLite busy. | Concluída localmente; scrape externo UNKNOWN | P0-IDEMP-002 | `/metrics`, dimensões seguras, unit/E2E e scan. |
| P1-OBS-002 | Implantar alertas Prometheus/Grafana para idempotência e Device Flow. | Parcial — contrato local aprovado; hosted UNKNOWN | P1-OBS-001 | 9/9 alertas, 9/9 métricas e 7 painéis validados sem secrets; falta scrape, alert firing e recovery em Prometheus/Grafana operacional. |
| P1-OBS-003 | Instrumentar polling device, pending, slow_down, denied, expired e replay. | Concluída localmente; alerting hosted UNKNOWN | P0-DEVICE-004 | `mcp_oauth_device_event_total` registra requested/pending/slow_down/approved/consumed/denied/expired/rejected/rate_limited; E2E confirma requested/approved/consumed e sem secrets. |
| P1-OBS-004 | Definir recovery pós-crash em pending sem reexecutar efeito não compensável. | Concluída localmente; runbook/hosted UNKNOWN | IDEMP-P1-005 | Crash drill real, métricas ambiguous/pending age, reconciliação explícita, retry bloqueado e artifact sanitizado passam. |
| P1-OBS-005 | Monitorar continuamente MCP e alertar falhas Bearer. | Concluída localmente; scheduler/hosted UNKNOWN | P1-OBS-001 | `scripts/mcp-monitor.mjs` e wrapper PowerShell validam health, 401 anônimo, Bearer 200/401, configuração ausente, JSONL sanitizado e `--fail-on-alert`; falta instalar/agendar no ambiente operacional. |
| P1-OBS-006 | Persistir carga com p50/p95/p99, throughput, erros e amostras sanitizadas. | Concluída localmente | P1-OBS-001 | Baseline e Wave 3 versionados; hosted ainda UNKNOWN. |

## 6. Tasks P2 — performance, resiliência, filesystem e integrações

| ID | Domínio | Task | Status | Dependências | Critério de aceite / evidência |
|---|---|---|---|---|---|
| P2-PERF-001 | UI | Medir chunks lazy de Emacs Lisp, C++ e WASM em bytes bruto, gzip, brotli, requests e entrypoint. | Parcial | P0-PERF-001 | Cada chunk tem owner, motivo e impacto medido. |
| P2-PERF-002 | UI | Implementar catálogo seletivo de linguagens e carregar grammars sob demanda. | Parcial | P2-PERF-001 | Caminho inicial sem módulos opcionais e seleção funcional. |
| P2-PERF-003 | UI | Comparar entrypoint, TTI, requests, parse cost e regressão antes/depois. | Backlog | P2-PERF-002 | Melhoria demonstrada por métricas comparáveis. |
| P2-PERF-004 | CI | Separar budgets de entrypoint, lazy chunks e requests. | Parcial | P2-PERF-003 | Cada budget falha somente por seu próprio limite. |
| P2-LOAD-001 | MCP | Manter smoke, baseline, ramp, sustained, burst e soak autenticados. | Concluída localmente; hosted UNKNOWN | P0-MCP-001, P1-OBS-006 | Wave 3 4/4 pass; job hospedado ainda necessário. |
| P2-LOAD-002 | MCP | Exercitar timeout, 429, 5xx, disconnect, reconnect e overload fail-closed. | Parcial | P2-LOAD-001 | Retry limitado, `Retry-After` respeitado, sem efeito duplicado. |
| P2-LOAD-003 | MCP | Calibrar thresholds por região/tool em três execuções independentes. | Backlog | P2-LOAD-001 | Variabilidade, intervalo e baseline versionados. |
| P2-RES-001 | Operação | Simular indisponibilidade, restart e recuperação de sessões. | Concluída localmente | P1-OBS-004 | Wave 2 comprovou health/metrics após restart; ampliar reauth. |
| P2-RES-002 | Operação | Testar SQLite cheio/lock, filesystem read-only, root ausente e processo filho falho. | Backlog | P1-OBS-001 | Erro sanitizado, fail-closed e cleanup. |
| P2-FS-001 | Filesystem | Cobrir arquivos grandes/binários, symlink, case-insensitive e permissões por OS. | Parcial — symlink containment local aprovado | P1-SEC-002 | `path-containment-report.json` comprova read/write/cwd symlink bloqueados e filesystem inalterado; faltam arquivo grande/binário, case-insensitive e matriz OS. |
| P2-PROC-001 | Processos | Cobrir bash, `write_stdin`, timeout, abort, process group, crash e PID reuse. | Parcial | P0-IDEMP-001 | Não reexecutar comandos cegamente; stdin com sequence/ack. |
| P2-LLAMA-001 | LlamaParse MCP | Validar documentação, endpoint, schemas, OAuth, quotas e região autorizada com acesso real. | UNKNOWN | P0-MCP-001 | Não marcar como executada sem endpoint/credencial autorizados. |
| P2-LLAMA-002 | LlamaParse MCP | Executar carga de documentos pequenos/grandes, tool mix, timeout, 429/5xx e retries. | Backlog | P2-LLAMA-001, P2-LOAD-001 | Métricas por MB/tool e isolamento de sessão. |
| P2-LLAMA-003 | LlamaParse MCP | Validar cross-tenant, sessão transferida, duplicidade e cleanup externo. | Backlog | P2-LLAMA-001 | Nenhum documento/contexto cruza identidade. |
| P2-LLAMA-004 | LlamaParse MCP | Avaliar self-host/BYOC somente com cluster, values e secrets autorizados. | UNKNOWN | P2-LLAMA-001 | Evidência real de instalação, health, upgrade e rollback. |
| P2-NET-001 | Dev environment | Investigar network share, descoberta, firewall, DNS, SSDP/UPnP, ACL e conectividade Windows. | Backlog | P2-RES-002 | Runbook separa conectividade, discovery, ACL, firewall e credenciais. |

## 7. Tasks P3 — CI/CD, release, skills, operação e evidência

| ID | Domínio | Task | Status | Dependências | Critério de aceite / evidência |
|---|---|---|---|---|---|
| P3-SKILL-001 | Skills | Manter `e2e-360-engineering` como workflow reutilizável. | Concluída | P0-BUILD-001 | Skill contém workflow, critérios e teste próprio. |
| P3-SKILL-002 | Skills | Manter `e2e-oauth-mcp-p0` com 23 IDs, runner e secret scan. | Concluída | P0-SEC-001 | IDs estáveis, pass/fail e CI. |
| P3-SKILL-003 | Skills | Manter `e2e-idempotency-mcp-p1` com hash, lease, recovery e observabilidade. | Concluída | IDEMP-P1 | Fixture não é apresentada como E2E real. |
| P3-SKILL-004 | Skills | Manter `devspace-wave1-p0-e2e`, `devspace-wave2-chaos-testing` e `devspace-wave3-performance-soak`. | Concluída | Ondas 1–3 | `quick_validate.py` passa e scripts são executáveis. |
| P3-CI-001 | CI/CD | Separar smoke rápido de PR, matriz completa e job noturno de carga/resiliência. | Parcial | P0-CI-001, P2-LOAD-001 | PR permanece rápido; nightly/release mantém cobertura completa. |
| P3-CI-002 | CI/CD | Executar `staging-load` hospedado com `CI=true`, roots temporários e owner token exclusivo. | Parcial | P0-REL-001 | Job configurado e localmente reproduzido; execução hospedada ainda UNKNOWN. |
| P3-REL-001 | Supply chain | Dependency audit, secret scan, SBOM, provenance e assinatura/checksum. | Backlog | P0-REL-001 | Artifact rastreável ao commit e sem credenciais. |
| P3-REL-002 | Recovery | Executar rollback, disaster recovery, retenção e restore SQLite. | Backlog | P3-REL-001 | Drill restaura serviço sem perda silenciosa. |
| P3-REL-003 | Governança | Definir gates corporativos de security, compliance, reviewer, owner e promoção versionada. | Parcial | P3-REL-001 | Aprovação e rollback auditáveis. |
| P3-DOC-001 | Documentação | Manter matriz de fluxos, aceite, DoR/DoD e mapa de evidências. | Concluída | P0-DISC-003 | Cada finding referencia artifact ou `UNKNOWN`. |
| P3-DOC-002 | Documentação | Gerar roteiros, slides e notas sem contradizer evidências. | Parcial | P3-DOC-001 | Decks apresentam fontes, riscos e status correto. |
| P3-OPS-001 | Operação | Documentar comandos de deps, dev env, build, test, deploy, actions, tasks, auth e diagnostics. | Parcial | P0-BUILD-001 | Novo operador executa caminhos principais. |
| P3-OPS-002 | Agendamento | Automatizar monitoramento via Windows Task Scheduler ou alternativa suportada. | Parcial | P1-OBS-005 | Wrapper PowerShell, intervalo, amostras, output e fail-on-alert estão implementados; falta registrar a tarefa, definir conta/ACL e validar restart/rollback operacional. |
| P3-OPS-003 | Evidência | Manter screenshots/vídeos como suporte, nunca substituto de assertions. | Parcial | P0-MCP-001 | Artifacts visuais sanitizados e vinculados por RAW-ID. |
| P3-EVID-001 | Retenção | Manter raws de execução em `evidence/raw` com manifest SHA-256. | Concluída | P3-DOC-001 | 80 arquivos, byte-exatos, 0 divergências, `npm run evidence:index`. |

## 8. Tasks P4 — produto, arquitetura e maturidade

| ID | Domínio | Task | Status | Dependências | Critério de aceite |
|---|---|---|---|---|---|
| P4-PROD-001 | Produto | Obter fonte autoritativa para WHY, WHO, JTBD, personas e outcomes. | Backlog | — | G8 deixa de estar bloqueado por ausência de fonte. |
| P4-PROD-002 | Produto | Definir owner, persona e outcome para cada feature, route e surface. | Backlog | P4-PROD-001 | Orphans e route-without-feature justificados ou eliminados. |
| P4-PROD-003 | Produto | Medir outcome real das capabilities, não apenas execução técnica. | Backlog | P4-PROD-001 | Métricas de adoção, sucesso e falha com owner. |
| P4-OBS-001 | Observabilidade | Fechar provenance, telemetry e outcome verification do Canonical 360º. | Backlog | P3-REL-001, P4-PROD-003 | G5/G6/G7 passam com runtime verificável. |
| P4-OBS-002 | Observabilidade | Criar tendência histórica de p50/p95, erros, retries, chunks, coverage e drift. | Backlog | P1-OBS-006, P2-PERF-003 | Regressões comparadas contra baseline versionado. |
| P4-ARCH-001 | Arquitetura | Reavaliar modular monolith versus serviços separados com base em carga e ownership. | Backlog | P2-LOAD-001, P4-PROD-002 | ADR contém custo, risco, latência e evidência. |
| P4-ARCH-002 | Arquitetura | Avaliar isolamento tenant/workspace/region para expansão multiusuário. | Backlog | P1-SESSION-002 | Cross-tenant E2E e ADR de isolamento. |
| P4-SEC-001 | Segurança | Rotacionar pepper, owner secret e signing keys com recovery testado. | Backlog | P1-OBS-001, P3-REL-002 | Rotação sem invalidação indevida fora da janela. |
| P4-SEC-002 | Supply chain | Fazer threat model e revisão de SDK MCP/dependências nativas. | Backlog | P3-REL-001 | Riscos e mitigações com owner e prazo. |
| P4-UX-001 | UX | Medir login PKCE/device, tempo até autorização, cancelamento e erros. | Backlog | P0-DEVICE-006, P1-DEVICE-013 | UX report baseado em métricas e falhas reais. |

## 9. Sequência recomendada de execução

| Sprint | Foco | Tasks prioritárias | Saída de aceite |
|---|---|---|---|
| Sprint 1 | Observabilidade operacional | P1-OBS-002, P1-OBS-003, P1-OBS-005 | Prometheus/Grafana em staging, alert firing controlado e recovery. |
| Sprint 2 | Segurança de autorização | P1-SEC-002..004, P1-DEVICE-009..013 | ACL, scopes, rotação/revogação e identidade real. |
| Sprint 3 | Efeitos e processos | IDEMP-P1-005, P1-IDEMP-009, P2-PROC-001, P2-RES-002 | Crash/reconciliation e commands fail-closed. |
| Sprint 4 | Performance UI | P2-PERF-001..004 | Bytes/gzip/brotli, catalog seletivo e budgets separados. |
| Sprint 5 | Carga hospedada | P2-LOAD-002..003, P3-CI-001..002 | `staging-load` executado com artifacts publicados. |
| Sprint 6 | Release e recovery | P3-REL-001..003, P3-OPS-001..002 | SBOM/provenance, rollback/restore e runbooks testados. |
| Sprint 7 | LlamaParse e rede | P2-LLAMA-001..004, P2-NET-001 | Somente com autorização/endpoint reais; evidência ou UNKNOWN. |
| Sprint 8 | Produto e arquitetura | P4-PROD, P4-OBS, P4-ARCH, P4-UX | Outcomes, ADRs, ownership e G8 fechado. |

A ordem deve ser mantida porque alertas, identidade real e reconciliação são pré-condições para declarar readiness operacional. A integração LlamaParse permanece **UNKNOWN** até que endpoint, credencial e região autorizados estejam disponíveis; documentação pública não substitui execução E2E.

## 10. Gates de saída E2E 360º

| Gate | Condição |
|---|---|
| G0 — Descoberto | Topologia, stack, surfaces, routes, features e evidências no manifest. |
| G1 — Contratado | Schemas, contratos HTTP/MCP, DoR e DoD definidos. |
| G2 — Implementado | Código, migrations, CLI, handlers e integrações versionados. |
| G3 — Testado | Unit, contract, HTTP E2E, MCP E2E e negativos cobrem o caminho crítico. |
| G4 — Reproduzível | Self-scan, build, artifacts, hashes e resultados determinísticos. |
| G5 — Deployable | Provenance, artifact, rollback e ambiente de publicação comprovados. |
| G6 — Operável | Health, telemetry, logs sanitizados, alertas e runbooks ativos. |
| G7 — Runtime verified | Outcome, latência, erro, recovery e comportamento real medidos. |
| G8 — Produto | WHY, WHO, JTBD, owners, personas e outcomes têm fonte autoritativa. |
| G9 — Evolução | Backlog, riscos, dependências e critérios atualizados a cada onda. |

## 11. Referências internas

- `artifacts/canonical-360/manifest.json`, `report.md`, `gates-dor-dod.md`
- `artifacts/wave1-p0/summary.json`
- `artifacts/wave2-chaos/summary.json`
- `artifacts/wave3-performance/summary.json`
- `artifacts/consolidated-metrics.json`
- `artifacts/idempotency-p1-report.json`
- `artifacts/mcp-load-log.json`
- `artifacts/oauth-mcp-negative-report.json`
- `artifacts/observability-contract-report.json`
- `observability/prometheus-idempotency-alerts.yml`
- `observability/grafana-idempotency-dashboard.json`
- `scripts/run-p0-negative-matrix.py`
- `scripts/run-wave1-p0.mjs`, `scripts/run-wave2-chaos.mjs`, `scripts/run-wave3-performance.mjs`
- `scripts/index-raw-evidence.mjs`, `evidence/raw-evidence-manifest.json`, `docs/raw-evidence-index.md`
- `scripts/mcp-monitor.mjs`, `scripts/mcp-monitor.ps1`, `scripts/e2e-mcp-monitor.test.mjs`, `artifacts/mcp-monitor-contract.json`
- `scripts/e2e-block1-identity.test.mjs`, `artifacts/block1-identity-report.json`, `src/db/migrations.ts` migration 7, `mcp_oauth_device_event_total`
- `src/credential-security.ts`, `src/credential-security.test.ts`, `scripts/e2e-oauth-device-cli.test.mjs`, `artifacts/oauth-device-cli-security-report.json`
- `src/roots.ts`, `src/roots.test.ts`, `src/pi-tools.ts`, `src/workspaces.ts`, `scripts/e2e-http-mcp-path-containment.test.mjs`, `artifacts/path-containment-report.json`
- `scripts/e2e-http-mcp-idempotency-recovery.test.mjs`, `artifacts/idempotency-recovery-report.json`, `WriteIdempotencyStore.reconcileExpiredPending`
- `.github/workflows/ci.yml`, especialmente o job `staging-load`
- `src/server.ts`, `src/idempotency-store.ts`, `src/metrics.ts`, `src/oauth-provider.ts`

A lista deve ser revisada após cada onda. Um relatório pode declarar **Concluída localmente** sem declarar produção pronta; qualquer dependência externa, identidade real, alert firing, CI hospedado, provenance ou rollback não comprovado deve continuar como **Parcial** ou **UNKNOWN**.
