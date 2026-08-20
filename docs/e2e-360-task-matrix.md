# Matriz E2E 360° do DevSpace

## Objetivo e baseline

Este documento consolida o histórico de execução do DevSpace em uma matriz única de cobertura ponta a ponta. O objetivo é provar não apenas que funções isoladas executam, mas que os caminhos críticos atravessam corretamente host, transporte HTTP/MCP, OAuth, sessão, autorização, workspace, filesystem, processos, persistência, UI, observabilidade, CI/CD e release.

O baseline desta revisão é o commit `258dee10a1d7bc0bdfc8c6aa22f6e8b288ecd5b5`, branch `main`, com working tree limpo no momento da inspeção. O runtime observado foi Node.js `v24.18.0`, npm `11.16.0` e Git `2.55.0.windows.4`. As alterações deste ciclo devem preservar o baseline, os raws e os artefatos anteriores; nenhum resultado histórico RED deve ser apagado para melhorar o status.

> Regra de evidência: uma task somente pode ser marcada como **Concluída** quando possuir implementação versionada, teste executável, saída preservada, critério de aceite verificável e cleanup determinístico. Dependências externas permanecem **Parcial** ou **UNKNOWN** até serem executadas no ambiente autorizado.

## Status executivo

| Área | Estado atual | Próximo fechamento |
|---|---|---|
| Descoberta, arquitetura e baseline | Concluída | Revalidar em cada mudança de superfície |
| OAuth PKCE, Device Grant, Bearer e binding de sessão | GREEN local | Provar gateway de identidade, RBAC e rotação em staging |
| Matriz negativa OAuth/MCP | GREEN local, 23/23 IDs | Reexecutar na matriz completa de sistemas suportados |
| Idempotência e recuperação | GREEN local para caminhos implementados | Fechar o intervalo write→ACK de efeitos não reversíveis |
| UI, acessibilidade e responsividade | GREEN por contratos locais | Executar browser-host E2E e inspeção visual autorizada |
| Performance de UI | Bundle audit GREEN, warning contextual >500 kB | Medir entrypoint, requests e custo de parse por jornada |
| Observabilidade | Contrato local GREEN | Provar scrape, firing, notificação e recovery hosted |
| CI/CD e supply chain | Matriz configurada | Gerar SBOM, provenance assinado e promover digest imutável |
| Deploy, rollback e restore | RED/UNKNOWN | Provisionar staging autorizado e executar drill completo |
| Produto e outcomes | UNKNOWN | Obter fonte autoritativa de WHY, WHO, JTBD, owner e outcome |

## Matriz de tasks end to end

| ID | Domínio | Task | Prioridade | Estado | Evidência atual | Critério de aceite |
|---|---|---|---:|---|---|---|
| E2E-BASE-001 | Baseline | Registrar AGENTS.md, branch, HEAD, working tree, runtime, package manager, scripts e CI. | P0 | Concluída | `artifacts/e2e-360-baseline-current.log` | Baseline reproduzível antes de cada corte; mudanças preexistentes preservadas. |
| E2E-BASE-002 | Baseline | Executar typecheck, `npm test` e build limpo antes/depois da implementação. | P0 | Concluída | `artifacts/e2e-360-baseline-gates.log` | Exit code 0; qualquer warning de performance é separado de falha funcional. |
| E2E-BASE-003 | Dev environment | Disponibilizar comandos locais equivalentes aos comandos documentados. | P1 | Em implementação | `docs/setup.md`, `src/cli.ts`, `package.json` | `npm run doctor` executa o mesmo diagnóstico público que `devspace doctor`. |
| E2E-AUTH-001 | OAuth PKCE | Descobrir metadata, registrar cliente, gerar verifier/challenge S256, autorizar e trocar token. | P0 | Concluída localmente | `scripts/e2e-http-mcp.test.mjs` | Handshake autenticado contra servidor real, sem secrets nos artifacts. |
| E2E-AUTH-002 | OAuth negativo | Rejeitar verifier, redirect, client, code replay/expirado, resource e scopes inválidos. | P0 | Concluída localmente | `artifacts/oauth-mcp-negative-report.json` | Casos negativos rejeitam antes do contexto privilegiado. |
| E2E-AUTH-003 | Device Grant | Provar request, pending, approval, polling, TTL, consumo único, deny e replay. | P0 | Concluída localmente | `scripts/e2e-oauth-device.test.mjs` | RFC 8628 localmente exercitado; estados finais não emitem novo token. |
| E2E-AUTH-004 | Device CLI | Provar login, armazenamento privado, timeout, Ctrl-C e cleanup de processo/stdin. | P1 | Concluída localmente em Windows | `scripts/e2e-oauth-device-cli.test.mjs` | Exit limpo, ACL equivalente a 0600 e nenhum processo órfão; macOS/Linux permanecem UNKNOWN. |
| E2E-AUTH-005 | IAM | Introduzir e validar RBAC explícito por principal, tenant, workspace e ação. | P1 | Backlog prioritário | `artifacts/canonical-platform-review-360-audit/RECONCILED_FINDINGS.json` | Evaluator fail-closed, grants versionados, revogação e matriz Actor×Resource×Action×Context. |
| E2E-SESSION-001 | MCP session | Executar initialize, session ID, initialized notification, tools/list e tools/call. | P0 | Concluída localmente | `scripts/e2e-http-mcp.test.mjs` | Sessão é criada somente após autenticação válida e segue lifecycle correto. |
| E2E-SESSION-002 | Session isolation | Rejeitar sessão desconhecida, close/replay, transferência de client/resource/principal e lifecycle inválido. | P0 | Concluída localmente | `artifacts/oauth-mcp-negative-report.json`, `artifacts/block1-identity-report.json` | Nenhum contexto ou efeito cruza principal, client ou resource. |
| E2E-API-001 | MCP contracts | Validar schema, content-type, JSON-RPC, método desconhecido, payload inválido e tamanho máximo. | P0 | Parcial | `scripts/e2e-http-mcp-negative.test.mjs` | Cada rejeição tem erro estável, não cria sessão e não executa tool. |
| E2E-API-002 | Tool authorization | Validar read/write por tool, deny-by-default e classificação de `exec_command`. | P1 | Concluída localmente | `src/mcp-request-policy.ts`, testes de contrato | Toda tool mutante exige autorização write; tool desconhecida é negada. |
| E2E-IDEMP-001 | Idempotência | Primeira escrita executa exatamente um efeito persistido. | P1 | Concluída | `artifacts/idempotency-p1-report.json` | Snapshot antes/depois e effect count único. |
| E2E-IDEMP-002 | Idempotência | Replay da mesma chave/payload devolve resultado persistido sem segundo efeito. | P1 | Concluída | `scripts/e2e-http-mcp-idempotency-recovery.test.mjs` | Filesystem, processo e banco não sofrem mutação adicional. |
| E2E-IDEMP-003 | Idempotência | Payload diferente na mesma chave retorna conflito fail-closed. | P1 | Concluída | `artifacts/idempotency-p1-report.json` | Conflito 409; nenhum efeito novo. |
| E2E-IDEMP-004 | Concorrência | Claims concorrentes preservam um único owner via lease/fencing. | P1 | Concluída | `src/idempotency-store.ts`, relatório P1 | Apenas o owner finaliza; worker sem lease é rejeitado. |
| E2E-IDEMP-005 | Crash | Reconciliar pending/ambiguous após crash sem retry cego. | P1 | Parcial | `artifacts/idempotency-recovery-report.json` | Estado ambíguo persistido; recuperação explícita; nenhum efeito não compensável é duplicado. |
| E2E-IDEMP-006 | write_stdin | Validar sequence monotônica, replay, conflito, gap, polling e ausência de key/sequence. | P1 | Parcial | `artifacts/write-stdin-idempotency-report.json` | Input confirmado não é reenviado; crash entre write e ACK permanece explicitamente UNKNOWN. |
| E2E-FS-001 | Filesystem | Validar roots, traversal, symlink, parent-symlink, permissões e arquivos grandes/binários. | P1 | Parcial | `artifacts/path-containment-report.json` | Nenhum escape ou mutação fora do root; matriz de OS concluída. |
| E2E-PROC-001 | Processes | Validar bash, timeout, abort, process group, restart, PID reuse e cleanup. | P1 | Parcial | `artifacts/p2-res-002-report.json` | Falha é segura, processo é encerrado, grupo não fica órfão e retry segue política explícita. |
| E2E-DATA-001 | SQLite | Validar migrations, WAL, índices, query plans, lock, full storage e readonly. | P1 | Concluída localmente | `src/db/query-performance.test.ts`, `src/db/resilience.test.ts` | Schema reproduzível, queries críticas index-friendly e erros bounded. |
| E2E-DATA-002 | Backup/restore | Executar backup, restore, retenção e disaster recovery. | P1 | UNKNOWN | `platform-review-gate-matrix.json` | Restore reproduzível, perda silenciosa zero e RTO/RPO registrados. |
| E2E-UI-001 | UI journey | Validar workspace, explore, change, verify, retry, lazy payload e estado obsoleto. | P2 | Concluída por contratos locais | `src/ui/*test.ts`, `src/ui/sync-state.ts` | Jornada não perde estado, não aceita callback antigo e expõe recovery acionável. |
| E2E-UI-002 | Accessibility | Validar landmarks, disclosure, live status, keyboard, focus, touch target e reduced motion. | P1 | Concluída por contratos locais | `src/ui/accessibility-contract.test.ts` | Browser-host confirma foco/teclado e ausência de bloqueio para teclado/screen reader. |
| E2E-UI-003 | Browser host | Executar interação real, screenshots e trace sanitizado como evidência auxiliar. | P2 | UNKNOWN | `test-strategy-report.json` | Assertions funcionais passam; screenshots/vídeo não substituem assertions. |
| E2E-PERF-001 | Bundle | Auditar entrypoint, chunks síncronos/lazy, gzip/brotli, requests e maiores assets. | P1 | Parcial | `artifacts/ui-bundle-report.json` | Budget por categoria; warning >500 kB tratado por impacto no caminho inicial. |
| E2E-PERF-002 | Language catalog | Carregar Emacs Lisp, C++, WASM e grammars pesadas somente sob demanda. | P2 | Parcial | `src/ui/language-catalog.test.ts` | Entrypoint não cresce; seleção explícita funciona; requests e parse cost medidos. |
| E2E-PERF-003 | Load/soak | Executar smoke, ramp, sustained, burst, soak e calibração regional. | P2 | Local concluída; hosted UNKNOWN | `artifacts/wave3-performance/summary.json` | p50/p95/p99, throughput, 429/5xx, timeout e saturação são versionados por região/tool. |
| E2E-SWARM-001 | Agents Swarm | Validar concorrência, isolamento, close/replay, recovery e cleanup. | P2 | Local concluída | `artifacts/swarm-resilience-report.json` | Nenhum contexto cruza sessão; sem processo ou artifact órfão. |
| E2E-SWARM-002 | Chaos | Validar timeout, 429, 5xx, disconnect, retry bounded e fail-closed. | P2 | Local concluída; hosted UNKNOWN | `artifacts/swarm-chaos-report.json` | Transitórios recuperam; persistentes exaurem sem duplicar ou vazar contexto. |
| E2E-OBS-001 | Telemetry | Validar request ID, métricas bounded, logs sanitizados e readiness SQLite. | P1 | Concluída localmente | `artifacts/observability-contract-report.json` | Dimensões seguras; nenhum token, payload, comando, stdout ou path sensível. |
| E2E-OBS-002 | Alerting | Provar scrape, firing, notification, recovery e runbooks em hosted. | P1 | UNKNOWN | `docs/observability-monitoring.md` | Synthetic failure aciona alerta correto e recuperação limpa o estado. |
| E2E-CI-001 | CI matrix | Executar install, typecheck, test, build, E2E, coverage, security, bundle e doctor. | P1 | Parcial | `.github/workflows/ci.yml`, baseline log | Matriz suportada e artifacts publicados; nenhum gate pode ser silenciosamente omitido. |
| E2E-CI-002 | Supply chain | Gerar SBOM, provenance assinada, digest imutável e secret scan. | P1 | Backlog | `GITHUB-INTELLIGENCE.json` | Commit→artifact→deployment verificável; falha bloqueia promoção. |
| E2E-REL-001 | Release | Promover build único com post-deploy smoke e readiness. | P1 | RED/UNKNOWN | `platform-review-gate-matrix.json` | Release candidate identificável e smoke autenticado contra o artefato promovido. |
| E2E-REL-002 | Rollback | Executar rollback de aplicação e restore SQLite/DR. | P1 | RED/UNKNOWN | `ROLLBACK_POINT.json` | Reversão e restore têm exit 0, evidência e cleanup; sem reset destrutivo do checkout. |
| E2E-PROD-001 | Product authority | Definir WHY, WHO, JTBD, persona, owner e outcome por superfície. | P4 | UNKNOWN | `platform-review-gate-matrix.json` | Fonte autoritativa versionada; G8 deixa de estar bloqueado. |
| E2E-EXT-001 | LlamaParse/external MCP | Somente com endpoint, credencial e região autorizados, validar OAuth, schemas, quota, load, isolation e recovery. | P2 | UNKNOWN | Backlog histórico | Nenhuma documentação é tratada como prova de execução real. |

## Checklist DoR — Definition of Ready

A execução de uma task somente começa quando o escopo, o alvo e o rollback são claros. O checklist de alto nível é o seguinte:

| Gate DoR | Pergunta de controle | Evidência mínima |
|---|---|---|
| Escopo | O fluxo, superfície e risco estão delimitados? | Task ID, owner, prioridade e dependências |
| Baseline | Branch, commit, working tree, runtime e instruções foram capturados? | Log de baseline e `AGENTS.md` |
| Ambiente | O alvo é local, staging ou hosted? Há autorização explícita? | URL/porta/root/tenant e autorização |
| Identidade | Há credencial de teste exclusiva e política de segredo? | Nome do segredo, nunca o valor |
| Contrato | Entradas, saídas, erros, efeitos e invariantes estão definidos? | Schema, assertions e oráculos |
| Dados | SQLite, migrations, fixtures e snapshots estão isolados? | Banco temporário e plano de cleanup |
| Segurança | Allowlist, scope, resource, principal, path e tool estão definidos? | Matriz positiva/negativa |
| Observabilidade | Request ID, métricas, logs e redaction estão disponíveis? | Contrato de sinais e dimensões seguras |
| Performance | Budget, carga, percentis e saturação estão definidos? | Perfil de execução e threshold versionado |
| Rollback | Existe caminho reversível e seguro? | Commit, digest, restore ou plano explícito |
| Cleanup | Processos, sockets, timers, sessões, roots e artifacts serão removidos ou preservados de forma controlada? | `finally`, snapshot e manifest |

**Resultado DoR:** `READY` quando todos os itens críticos estão comprovados; `CONDITIONAL` quando a execução local é segura, mas falta ambiente externo; `NOT_READY` quando identidade, alvo, contrato ou rollback estão ausentes.

## Checklist DoD — Definition of Done

Uma task não é encerrada porque o código compilou. O encerramento exige demonstração do caminho real e rastreabilidade do resultado:

| Gate DoD | Critério de encerramento |
|---|---|
| Implementação | Código, schema, migration, configuração ou documentação estão versionados e limitados ao escopo. |
| Contrato | O comportamento positivo e os erros esperados têm assertions estáveis. |
| E2E real | O fluxo crítico usou servidor/processo/SQLite/MCP reais quando esse era o objetivo. |
| Segurança | Rejeições ocorrem antes de sessão privilegiada ou efeito; não há secret leak. |
| Isolamento | Principal, client, resource, workspace, tenant, root e processo não cruzam indevidamente. |
| Persistência | Estados, leases, replay, conflito, recovery e retenção estão demonstrados. |
| Performance | Métricas e budgets foram medidos; build aprovado não é confundido com performance aprovada. |
| Observabilidade | Logs, métricas, readiness, alertas e correlation IDs são sanitizados e acionáveis. |
| CI | O mesmo comando executado localmente está conectado ao gate apropriado e publica artifact válido. |
| Cleanup | Nenhum processo, socket, timer, sessão, root ou diretório temporário ficou órfão. |
| Evidência | JSON/Markdown/logs têm timestamp, comando, exit code, run ID e hash quando aplicável. |
| Regressão | Typecheck, testes, build, E2E crítico, security P0, coverage e diff check passam após a mudança. |
| Rollback | A alteração pode ser revertida ou o desconhecido foi explicitamente registrado. |
| Comunicação | Backlog, riscos residuais, owner e próximo corte foram atualizados. |

**Resultado DoD:** `DONE` somente com todas as evidências críticas; `PARTIAL` quando o caminho local está comprovado, mas faltam hosted/OS/deploy; `NOT_DONE` quando assertions, cleanup, segurança ou rastreabilidade falham.

## Priorização do próximo ciclo

O próximo corte de maior impacto é de baixo risco e fecha um gap de automação reproduzível: alinhar o script `npm run doctor` ao comando público `devspace doctor`, adicionar regressão de CLI e manter o baseline utilizável por operadores e CI. Em seguida, a ordem recomendada é provisionar staging para deploy/rollback/restore, provar gateway de identidade e hosted alerting, e só então fechar browser-host, SBOM/provenance e calibração regional.

| Ordem | Corte | Por que agora |
|---:|---|---|
| 1 | `E2E-BASE-003` — alias `npm run doctor` + teste | O baseline detectou exit code 1 em um comando documentado implicitamente pelo fluxo local; correção pequena, reversível e sem dependência externa. |
| 2 | `E2E-REL-001/002` — staging, promoção, rollback e restore | É o gate RED que mantém o release bloqueado e desbloqueia as demais provas operacionais. |
| 3 | `E2E-AUTH-005` — gateway/RBAC/key rotation | Risco P1 de autorização produtiva; exige ambiente e identidades autorizados. |
| 4 | `E2E-OBS-002` — alert firing/recovery hosted | Fecha a distância entre contrato local GREEN e operação real. |
| 5 | `E2E-IDEMP-005/006` — ACK durável e crash de efeitos não reversíveis | Reduz o risco residual de duplicação ou intervenção manual em processos/stdin. |

## Política de evidência e rollback

Os raws anteriores continuam byte-exact e não devem ser reformatados para esconder divergências. Cada nova execução deve usar diretórios, portas, tokens de teste e banco isolados; preservar stdout/stderr sanitizados; registrar exit code; atualizar `evidence/raw-evidence-manifest.json`; e manter o working tree livre de artefatos temporários não intencionais.

A declaração final deve separar quatro estados: **PASS** prova executada e válida; **FAIL** prova executada e falhou; **UNKNOWN** prova não executável por ausência de ambiente/autorização; **NOT_APPLICABLE** superfície fora do escopo. A média dos gates nunca pode esconder um P1 ou um gate RED.
