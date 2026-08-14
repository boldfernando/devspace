# Planos de perfis de agente e CLI do DevSpace

## Decisão

Perfis de subagente descrevem funções sobre provedores de coding-agent integrados.
O DevSpace possui a invocação e o ciclo de vida do provedor. Agentes personalizados baseados em CLI,
objetos de ação do provedor e detalhes de backend visíveis ao modelo ficam fora do escopo da v1.

O fluxo visível ao modelo continua pequeno:

```bash
devspace agents ls
devspace agents run <profile-or-id> "<prompt>"
devspace agents show <id>
```

A descoberta do perfil acontece por meio do catálogo compacto retornado por `open_workspace`. `devspace agents ls` lista sessões existentes de subagente para o workspace atual; não lista definições de perfil.

## Esquema do perfil

Perfis são descobertos em:

- `~/.devspace/agents/*.md`
- projeto `.devspace/agents/*.md`

Campos de frontmatter suportados:

```yaml
schema: devspace-agent/v1
name: reviewer
description: Read-only reviewer for bugs, security risks, and missing tests.
provider: codex
model: gpt-5.4
disabled: false
```

Provedores suportados:

- `codex`
- `claude`
- `opencode`
- `pi`
- `cursor`
- `copilot`

Removidos do esquema de perfil v1:

- `backend`
- `command`
- `mode`
- `permissions`
- `actions`

## Mapeamento de provedores

O DevSpace mapeia os ids de provedor para integrações nativas:

- `codex`: Codex SDK
- `claude`: Claude Code SDK
- `opencode`: OpenCode SDK
- `pi`: Pi RPC mode
- `cursor`: ACP
- `copilot`: ACP

O registro de adaptadores é a costura interna que ferramentas MCP futuras podem reutilizar se avançarmos de skill + orientação de CLI para ferramentas MCP de agente de primeira classe.

## Exposição ao modelo

`open_workspace` expõe apenas metadados compactos do perfil:

```json
{
  "name": "reviewer",
  "description": "Read-only reviewer for bugs, security risks, and missing tests.",
  "provider": "codex",
  "model": "gpt-5.4"
}
```

O corpo do perfil, o protocolo do provedor, a transcrição bruta do provedor e os detalhes do adaptador ficam fora do contexto padrão do modelo.

Chamadas de shell iniciadas pelo DevSpace recebem `DEVSPACE_WORKSPACE_ID` e `DEVSPACE_WORKSPACE_ROOT`, para que `devspace agents ls` consiga se limitar sem o modelo passar flags de workspace.

## Fora do escopo

- Comandos de subagente personalizados ou arbitrários.
- DSLs de ação específicas do provedor.
- Expor transcrições brutas do provedor por padrão.
- Rastrear arquivos alterados ou testes a partir da saída do provedor.
