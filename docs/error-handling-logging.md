# Estratégia de tratamento de erros e logging

**Status:** implementada localmente no commit `905a43a`
**Escopo:** HTTP/MCP, ferramentas, CLI, artifacts, UI e observabilidade operacional


## Objetivo

O DevSpace deve preservar detalhes técnicos para diagnóstico interno sem devolver paths absolutos, comandos, payloads, tokens, conteúdo de processos ou mensagens do sistema operacional ao cliente MCP, à UI ou aos artifacts. A implementação separa o erro bruto, que permanece disponível apenas no boundary interno necessário ao diagnóstico, do descritor seguro usado em respostas e logs.

> Uma resposta segura não é uma resposta silenciosa: ela fornece um código estável, uma categoria, uma indicação de retryabilidade e um identificador de correlação quando o transporte o suporta.

## Classificação centralizada

`src/error-policy.ts` expõe `classifyError()` e `safeToolErrorContent()`. O classificador reconhece falhas de autenticação, autorização, validação, recurso inexistente, conflito, rate limit, capacidade, filesystem, processo, timeout, dependência e erro interno. Cada resultado possui `code`, `category`, `retryable` e `userMessage`.

| Código | Categoria | Retryável | Mensagem externa |
|---|---|---:|---|
| `AUTHENTICATION_FAILED` | authentication | Não | Authentication failed. |
| `AUTHORIZATION_DENIED` | authorization | Não | The operation is not authorized. |
| `INVALID_REQUEST` | validation | Não | The request was invalid. |
| `RESOURCE_NOT_FOUND` | not_found | Não | The requested resource was not found. |
| `OPERATION_CONFLICT` | conflict | Não | The operation conflicts with the current state. |
| `RATE_LIMITED` | rate_limit | Sim | The operation was rate limited. Retry later. |
| `DATABASE_BUSY` | resource | Sim | The database is busy. Retry the operation. |
| `STORAGE_EXHAUSTED` | resource | Não | Storage capacity is exhausted. |
| `FILESYSTEM_PERMISSION_DENIED` | filesystem | Não | The filesystem rejected this operation. |
| `PROCESS_START_FAILED` / `PROCESS_FAILED` | process | Não | The process operation failed. |
| `REQUEST_TIMEOUT` | timeout | Sim | The operation timed out. Retry if the condition persists. |
| `DEPENDENCY_UNAVAILABLE` | dependency | Sim | A dependent service is unavailable. Retry later. |
| `INTERNAL_ERROR` | internal | Não | The operation could not be completed. |

Códigos de domínio previamente seguros, como `PROCESS_START_FAILED`, são preservados. O parser também reconhece o formato já sanitizado `CODE: mensagem`, evitando que a classificação posterior do evento altere o código original para uma categoria genérica.

## Superfície HTTP/MCP e UI

Todas as respostas HTTP recebem `x-request-id` para correlação entre cliente, servidor e logs. O middleware de autorização continua fail-closed e retorna somente status e mensagem protocolar; desconhecidos, requests malformados e escopos insuficientes não chegam ao handler da ferramenta.

Ferramentas Pi, artifacts e CLI usam `safeToolErrorContent()` antes de devolver falhas. Exceções desconhecidas do `download_artifact` são encapsuladas em `ArtifactError` com mensagem segura. A UI usa `classifyError(...).userMessage` para falhas de bootstrap e conexão, em vez de renderizar a mensagem bruta de `Error`.

A política MCP inclui `exec_command` como ferramenta write-scoped no modo Codex. Essa inclusão evita que o fail-closed classifique o comando real como ferramenta desconhecida e bloqueie indevidamente os cenários E2E de processo.

## Sanitização de logs

`sanitizeLogFields()` aplica uma allowlist de dimensões de baixo risco, hashes determinísticos de valores identificáveis e bloqueio explícito de chaves sensíveis. Paths, roots, workspace IDs, origem, referer, user-agent, host e IP não aparecem em claro; são representados por um prefixo SHA-256 de 16 caracteres. O `sessionIdPrefix` legado é convertido para `sessionIdHash`.

| Tratamento | Campos representativos |
|---|---|
| Allowlist textual limitada a 128 caracteres | `tool`, `reason`, `outcome`, `state`, `errorCode`, `errorCategory`, `requiredScope`, `method`, `requestId` |
| Hash SHA-256 truncado | `ip`, `host`, `userAgent`, `origin`, `referer`, `path`, `root`, `workingDirectory`, `workspaceId`, `resource` |
| Bloqueio completo | `authorization`, `token`, `secret`, `cookie`, `password`, `payload`, `stdout`, `stderr`, `command`, `preview`, `content`, `error`, `stack`, `verifier`, `challenge`, `chars`, `edits` |
| Tipos primitivos | Números e booleanos somente quando a chave não estiver bloqueada |

O evento estrutural recebido por `logEvent()` não pode ser sobrescrito por um campo de entrada chamado `event`. A função `commandPreview()` foi removida por não possuir consumidores e por contrariar a regra de não emitir comandos em logs.

## Contratos e evidências

Os testes unitários cobrem classificação sem exposição de paths, retryabilidade de SQLite/timeout, preservação de códigos de processo, hashing determinístico, bloqueio de campos sensíveis, limites de tamanho, imutabilidade do evento e classificação das ferramentas MCP. O runner HTTP/MCP real `P2-RES-002` valida missing-root, falha de escrita em filesystem, falha de processo filho sanitizada, ausência de mutação do filesystem e cleanup. A fault suite SQLite cobre `SQLITE_BUSY`, storage cheio e banco read-only.

Os gates executados para este corte foram `npm test`, `npm run typecheck`, `npm run build`, `npm run security:p0`, `npm run test:observability`, o runner real `node --test scripts/e2e-http-mcp-resilience.test.mjs` e `src/db/resilience.test.ts`. O warning de chunk superior a 500 kB permanece preexistente; o bundle audit continua aprovado.

## Limitações e próximos controles

A classificação é segura por design, mas não substitui um sistema de tracing externo nem prova firing hosted dos alertas. A identidade real do aprovador Device Flow, RBAC multi-tenant e o comportamento em matriz completa de sistemas operacionais continuam dependentes de ambiente. O gap de exatamente-uma-vez entre `write(chars)` e a confirmação de sucesso permanece `UNKNOWN` até a adoção de ACK durável de aplicação.

Toda nova categoria ou código deve receber teste de não vazamento, decisão explícita de retryabilidade e verificação no runner HTTP/MCP real antes de ser promovida ao contrato operacional.
