# Esquema de perfis de subagente

Os perfis de agente do DevSpace são arquivos Markdown do usuário com frontmatter YAML. Eles descrevem funções como reviewer, explorer ou implementer.
O DevSpace possui a invocação do provedor.

Os perfis são descobertos em:

- `~/.devspace/agents/*.md`
- `.devspace/agents/*.md`

Arquivos empacotados em `examples/agents/` são apenas modelos iniciais.

## Forma mínima

```md
---
schema: devspace-agent/v1
name: reviewer
description: Read-only reviewer for bugs, security risks, and missing tests.
provider: codex
model: gpt-5.4
thinking: high
disabled: false
---

You are a read-only reviewer. Do not edit files.
Focus on correctness, security, test gaps, and maintainability.
Cite files and return concise findings.
```

## Campos do frontmatter

### `schema`

Identificador opcional do esquema:

```yaml
schema: devspace-agent/v1
```

### `name`

Identificador estável do perfil exibido ao modelo e aceito por:

```bash
devspace agents run <name> "<prompt>"
```

Use nomes em lowercase kebab-case. Se omitido, o DevSpace usa o nome do arquivo sem `.md`.

### `description`

Propósito curto obrigatório. Isso é exposto por `open_workspace` para que o modelo supervisor escolha o perfil correto.

### `provider`

Identificador obrigatório do provedor incorporado:

```yaml
provider: codex
provider: claude
provider: opencode
provider: pi
provider: cursor
provider: copilot
```

Provedores não suportados ou personalizados são rejeitados. O DevSpace mapeia os provedores para sua integração nativa:

- `codex`: Codex SDK
- `claude`: Claude Code SDK
- `opencode`: OpenCode SDK
- `pi`: Pi RPC mode
- `cursor`: ACP
- `copilot`: ACP

### `model`

Identificador ou alias de modelo opcional do provedor.

```yaml
model: gpt-5.4
model: sonnet
```

### `thinking`

Esforço de raciocínio opcional, nível de thinking ou variante do modelo. Se omitido, o DevSpace deixa o provedor aplicar o padrão. Os valores são strings pass-through específicas do provedor; o DevSpace não traduz nomes entre os harnesses.

```yaml
thinking: low
thinking: high
thinking: xhigh
```

O DevSpace passa isso para provedores que expõem um controle correspondente:

- `claude`: SDK effort com adaptive thinking.
- `codex`: SDK model reasoning effort.
- `pi`: `--thinking`.
- `opencode`: variante do modelo.
- `cursor` e `copilot`: configuração ACP de thought-level quando suportada.

### `disabled`

Booleano opcional. Perfis desabilitados não são expostos.

```yaml
disabled: true
```

## Corpo em Markdown

O corpo é o prefixo do prompt do perfil que o DevSpace antepõe ao iniciar esse perfil. Ele não é incluído em `open_workspace` por padrão.

Conteúdo recomendado para o corpo:

- Quando usar este perfil.
- Se o worker deve atuar somente em leitura ou pode fazer alterações.
- Formato de saída.
- Expectativas de revisão ou testes.

## Fluxo orientado ao modelo

A skill de Subagent ensina apenas:

```bash
devspace agents ls
devspace agents run <profile-or-id> "<prompt>"
devspace agents show <id>
```

`open_workspace` expõe metadados compactos do perfil:

```json
{
  "name": "reviewer",
  "description": "Read-only reviewer for bugs, security risks, and missing tests.",
  "provider": "codex",
  "model": "gpt-5.4",
  "thinking": "high"
}
```

`devspace agents ls` lista sessões existentes de subagente para o workspace atual;
não lista definições de perfil.

O corpo completo do perfil fica fora do contexto do modelo até o DevSpace iniciar o perfil.

## Objetivos atuais fora do escopo

- Agentes personalizados ou arbitrários baseados em CLI.
- Inferir arquivos alterados, testes ou diffs a partir da saída do worker.
- Expor transcrições brutas do provedor por padrão.
- Ensinar ao modelo CLIs específicas do provedor.
- Ferramentas MCP de agente de primeira classe. Futuras ferramentas devem encapsular o mesmo registro de adaptadores usado por `devspace agents`.
