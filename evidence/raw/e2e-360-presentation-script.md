# E2E 360º — roteiro de apresentação

## Contexto
Validamos o DevSpace contra o ambiente local com health check, OAuth PKCE, credential e handshake MCP.

## Fluxo OAuth PKCE
Discovery, registro do cliente, code verifier, challenge S256, autorização local, troca do authorization code por access token e uso do credential.

## Handshake MCP
initialize, captura de mcp-session-id, notifications/initialized, tools/list e tools/call. Sem credential, o endpoint deve responder HTTP 401.

## Métricas de carga
20 sessões independentes; wall time 835,87 ms; p50 46,15 ms; p95 47,79 ms; máximo 47,79 ms; 20/20 aprovadas.

## Conclusão
A autenticação está protegida, o protocolo MCP está operacional e o monitor persistente registra alertas de falha credential em artifacts/mcp-monitor.log.
