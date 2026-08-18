# Roteiro executivo — DevSpace E2E 360°

**Tema:** Resiliência, performance e soak testing do servidor HTTP/MCP autenticado.  
**Duração estimada:** 8–10 minutos.  
**Base de evidências:** artifacts sanitizados gerados no commit de trabalho `16c1df2`, com a Onda 3 executada em servidor isolado de staging na porta `17679`.

> **Mensagem executiva:** As Ondas 2 e 3 fecharam os gates automatizados de resiliência e performance para o build testado. O sistema recuperou-se de restart sem aceitar tráfego durante a indisponibilidade, preservou as invariantes de idempotência e permaneceu abaixo dos SLOs definidos nos perfis ramp, sustained, burst e soak. A evidência ainda não equivale a prontidão de produção: permanecem os gates externos de alert firing, identidade real, ACL cross-platform, CI hospedado e rollback/restore.

## Slide 1 — Decisão e estado atual

**Tempo:** 60 segundos.

**Mensagem na tela:** `Wave 2 + Wave 3: gates locais aprovados`

**Notas do orador:**

A decisão desta etapa é reconhecer a aprovação dos gates locais de resiliência e performance, sem ampliar a conclusão para produção. A Onda 2 executou onze cenários contra o sistema real e a Onda 3 adicionou quatro perfis de carga autenticada. O resultado é um conjunto de evidências reproduzível: status global `passed`, artifacts JSON sanitizados e working tree tratado como fonte auditável. A recomendação é avançar para os gates operacionais externos, mantendo explícitos os riscos residuais.

## Slide 2 — O que foi exercitado

**Tempo:** 75 segundos.

**Mensagem na tela:** `OAuth PKCE → Bearer → MCP → persistência → observabilidade`

| Superfície | Evidência exercitada |
| --- | --- |
| Autenticação | Registro dinâmico, code verifier, challenge S256, autorização e troca por token |
| Transporte | `initialize`, sessão MCP, `notifications/initialized`, `tools/list` e chamadas autenticadas |
| Persistência | Replay, conflito de hash, concorrência, lease e recuperação após restart |
| Operação | `/healthz`, `/metrics`, logs sanitizados, coverage, bundle e doctor |

**Notas do orador:**

O valor da cobertura não está somente na quantidade de requests. O fluxo percorre as fronteiras de autenticação, sessão, autorização de recurso, filesystem, SQLite e observabilidade. O teste de carga reutiliza o handshake OAuth PKCE real antes de cada execução e mede a operação MCP autenticada, evitando tratar um teste de 401 como substituto do caminho feliz.

## Slide 3 — Onda 2: chaos e recuperação

**Tempo:** 75 segundos.

**Mensagem na tela:** `11/11 cenários aprovados`

| Evidência de restart | Resultado |
| --- | ---: |
| Primeiro servidor pronto | `true` |
| Endpoint rejeitou tráfego após stop | `true` |
| Segundo servidor pronto | `true` |
| `/healthz` após restart | `200` |
| `/metrics` após restart | `200` |

**Notas do orador:**

O cenário crítico foi executado em processo, porta, root e estado isolados. O servidor tornou-se pronto, foi encerrado, a indisponibilidade foi observada de forma negativa e a mesma configuração voltou a responder após restart. O oráculo não aceitava um resultado parcial: readiness, indisponibilidade e recuperação precisavam estar presentes. Os dez cenários complementares cobriram idempotência real, Device Authorization HTTP/CLI, matriz negativa P0, carga autenticada, observabilidade, bundle/coverage e doctor.

## Slide 4 — Invariantes de idempotência

**Tempo:** 75 segundos.

**Mensagem na tela:** `8/8 casos P1; efeito único preservado`

| Invariante | Evidência |
| --- | --- |
| Mesmo hash canônico | Replay retorna resultado persistido sem novo efeito |
| Hash diferente | Conflito sanitizado antes do efeito |
| Concorrência | Um owner de lease; segunda chamada não duplica efeito |
| Lease perdido/expirado | Estado `ambiguous`; sem blind retry |
| Escopo | Client/principal, resource, workspace e tool isolados |
| Segredos | `secret_leak_detected=false` |

**Notas do orador:**

A store de idempotência não transforma uma falha de processo em permissão para executar novamente uma operação não compensável. O resultado registrado foi `effect_count=5` para a suíte de oito casos, com evidência de replay, conflito, concorrência e lease. O estado ambíguo exige reconciliação explícita. Essa propriedade é essencial para ferramentas destrutivas e permanece monitorada por métricas sanitizadas.

## Slide 5 — Onda 3: desenho dos perfis

**Tempo:** 60 segundos.

**Mensagem na tela:** `160 amostras autenticadas em quatro regimes`

| Perfil | Amostras | Concorrência | Gate |
| --- | ---: | ---: | --- |
| Ramp agregado | 40 | 1 → 4 → 8 → 16 | p95 < 100 ms |
| Sustained | 20 | 4 | p50 < 50 ms; p95 < 100 ms |
| Burst | 40 | 8 | p95 < 100 ms |
| Soak | 60 | 4 | p95 < 100 ms |

**Notas do orador:**

O ramp identifica degradação conforme a concorrência aumenta. O sustained preserva a comparação com o baseline anterior. O burst concentra concorrência em uma janela curta. O soak amplia a duração para procurar regressões de estado, crescimento de latência ou falhas cumulativas. Cada perfil rodou contra um servidor real isolado, com estado SQLite e roots temporários, e o runner falha fechado quando o relatório não existe ou não possui a série completa.

## Slide 6 — Resultados de latência e throughput

**Tempo:** 90 segundos.

**Mensagem na tela:** `Todos os SLOs Wave 3 aprovados`

| Perfil | Wall (ms) | Throughput (req/s) | p50 (ms) | p95 (ms) | p99 (ms) | Máx. (ms) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Ramp | 662 | 60,42 | 37 | 47 | 47 | 47 |
| Sustained | 156 | 128,21 | 30 | 36 | 36 | 36 |
| Burst | 167 | 239,52 | 31 | 36 | 37 | 37 |
| Soak | 449 | 133,63 | 25 | 47 | 51 | 51 |

**Notas do orador:**

Os números são observados, não estimados. O sustained ficou em p50 de 30 ms e p95 de 36 ms, abaixo dos limites de 50 e 100 ms. O burst apresentou o maior throughput, 239,52 requests por segundo no intervalo medido, sem ultrapassar p95 de 36 ms. O soak terminou com p95 de 47 ms e p99 de 51 ms. Esses números qualificam o build e o ambiente local isolado; não devem ser convertidos em capacidade de produção sem rede externa, múltiplos nós e infraestrutura equivalente.

## Slide 7 — Segurança da evidência e qualidade do gate

**Tempo:** 60 segundos.

**Mensagem na tela:** `Evidence-first; sem segredos nos artifacts`

**Notas do orador:**

O summary Wave 3 registra `real_http_mcp=true`, `artifacts_sanitized=true`, `secrets_included=false` e `failed_closed_on_missing_report=true`. O relatório consolidado preserva o fato de que o gate de coverage passou, mas marca os percentuais medidos como `UNKNOWN` porque esses valores não estavam no artifact retido; não há inferência artificial. A auditoria de bundle também preserva os maiores assets sem transformar a existência de um chunk lazy em aprovação automática de performance.

## Slide 8 — Riscos residuais e próxima decisão

**Tempo:** 90 segundos.

**Mensagem na tela:** `Aprovado localmente; operacionalização ainda pendente`

| Prioridade | Risco residual | Próximo gate de aceite |
| --- | --- | --- |
| P1 | Alertas Prometheus/Grafana não disparados em ambiente operacional | Scrape real, firing controlado e evidência de recuperação |
| P1 | Aprovação Device com identidade real | Fluxo autenticado por usuário/ACL real em staging |
| P1 | Rotação, revogação e ACL cross-platform | Matriz Windows/macOS/Linux e tokens revogados rejeitados |
| P2 | Medição de chunks lazy Emacs Lisp/C++/WASM | Bytes bruto, gzip/brotli e custo de requests por entrypoint |
| P3 | `staging-load` hospedado | Job CI executado e artifacts publicados |
| P3 | SBOM, provenance e rollback/restore | Evidência assinada e drill documentado |

**Notas do orador:**

A recomendação é aprovar a passagem da engenharia local para os gates externos, não declarar produção pronta. O próximo ciclo deve começar por alert firing real e identidade/ACL, porque ambos validam controles que o ambiente sintético não consegue provar. Em paralelo, o job hospedado e a medição detalhada dos chunks devem tornar a evidência repetível fora da máquina do desenvolvedor. O rollback/restore deve ser um gate de release, não uma atividade posterior.

## Fechamento — frase de decisão

**Tempo:** 30 segundos.

As Ondas 2 e 3 demonstram que os caminhos críticos autenticados podem ser exercitados de ponta a ponta, que restart e idempotência preservam seus invariantes e que os quatro perfis locais ficaram dentro dos SLOs definidos. A decisão responsável é promover o conjunto de evidências para staging operacional com os riscos residuais registrados e sem remover os gates fail-closed.

## Referências internas

[1]: `artifacts/wave2-chaos/summary.json` — summary sanitizado da Onda 2, 11 cenários e restart recovery.  
[2]: `artifacts/idempotency-p1-report.json` — suíte IDEMP-P1-001..008, efeito e secret scan.  
[3]: `artifacts/mcp-load-log.json` — baseline autenticado de 20 amostras, p50 14 ms, p95 19 ms, p99 19 ms.  
[4]: `artifacts/wave3-performance/summary.json` — summary `devspace.wave3-performance.v1` com quatro perfis e percentis observados.  
[5]: `artifacts/consolidated-metrics.json` — consolidação Wave 1, Wave 2, carga, coverage e bundle.  
[6]: `scripts/run-wave3-performance.mjs` — runner isolado, SLOs, cleanup e schema de evidência.
