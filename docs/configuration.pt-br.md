# Referência de configuração

O DevSpace pode ser configurado por meio de `devspace init`, arquivos de configuração persistidos ou variáveis de ambiente.

Os arquivos padrão são:

```text
~/.devspace/config.json
~/.devspace/auth.json
```

Use outro diretório de configuração com:

```bash
DEVSPACE_CONFIG_DIR=/path/to/config npx @waishnav/devspace serve
```

## Comandos

```bash
npx @waishnav/devspace init
npx @waishnav/devspace serve
npx @waishnav/devspace doctor
npx @waishnav/devspace config get
npx @waishnav/devspace config set publicBaseUrl https://devspace.example.com
```

## Variáveis principais de ambiente

| Variável | Finalidade |
| --- | --- |
| `HOST` | Host de bind local. Padrão `127.0.0.1`. |
| `PORT` | Porta local. Padrão `7676`. |
| `DEVSPACE_ALLOWED_ROOTS` | Raízes locais separadas por vírgula que os workspaces podem abrir. |
| `DEVSPACE_PUBLIC_BASE_URL` | Origem pública do servidor, sem `/mcp`. |
| `DEVSPACE_ALLOWED_HOSTS` | Substituição opcional da allowlist de Host header. |
| `DEVSPACE_OAUTH_OWNER_TOKEN` | Senha do proprietário para aprovação OAuth. Deve ter pelo menos 16 caracteres. |
| `DEVSPACE_WORKTREE_ROOT` | Diretório para Git worktrees gerenciados. Padrão `~/.devspace/worktrees`. |
| `DEVSPACE_STATE_DIR` | Diretório para estado SQLite. Padrão `~/.local/share/devspace`. |

## Download nativo de artefatos

O download de arquivo nativo está desabilitado por padrão. Habilite quando o ChatGPT precisar entregar um arquivo anexo ou gerado para um workspace já aberto:

```bash
DEVSPACE_ARTIFACTS=1 npx @waishnav/devspace serve
```

Este recurso atualmente suporta Linux. Não está registrado em macOS, Windows ou BSD porque o caminho seguro de publicação depende de caminhos de diretório ancorados por descritores e acessíveis via procfs do Linux.

| Variável | Padrão | Finalidade |
| --- | --- | --- |
| `DEVSPACE_ARTIFACTS` | `0` | Expõe `download_artifact` para arquivos nativos confiáveis. |
| `DEVSPACE_ARTIFACT_MAX_FILE_BYTES` | `104857600` | Tamanho máximo de um arquivo transmitido em streaming (100 MiB). |

As mesmas configurações podem ser persistidas em `~/.devspace/config.json` como `artifactsEnabled` e `artifactMaxFileBytes`.

`download_artifact` aceita o objeto de arquivo nativo fornecido pelo conector MCP, um `workspaceId` retornado por `open_workspace` e um caminho relativo do workspace. O DevSpace cria diretórios pais ausentes com segurança, recusa sobrescrever um destino existente e retorna apenas o caminho normalizado relativo ao workspace. Ele não aceita modos de conflito, hashes esperados, strings URLs arbitrárias, caminhos locais, credenciais embutidas ou campos extras do objeto.

Não há raiz de artefatos, quota total, TTL, pinning, registro persistente no banco de dados nem serviço de limpeza de artefatos em segundo plano. Veja [Download de arquivo nativo](artifact-exchange.md) para entender o formato suportado do conector e os limites de segurança.

## OAuth

O DevSpace usa um fluxo OAuth de usuário único com aprovação.

| Variável | Padrão |
| --- | --- |
| `DEVSPACE_OAUTH_ACCESS_TOKEN_TTL_SECONDS` | `3600` |
| `DEVSPACE_OAUTH_REFRESH_TOKEN_TTL_SECONDS` | `2592000` |
| `DEVSPACE_OAUTH_SCOPES` | `devspace` |
| `DEVSPACE_OAUTH_ALLOWED_REDIRECT_HOSTS` | `chatgpt.com,localhost,127.0.0.1` |

Os clientes MCP descobrem metadados em:

```text
/.well-known/oauth-protected-resource/mcp
/.well-known/oauth-authorization-server
```

## Modos de ferramenta

`DEVSPACE_TOOL_MODE` controla a superfície de ferramentas.

| Valor | Comportamento |
| --- | --- |
| `minimal` | Padrão. Expõe `open_workspace`, `read`, `write`, `edit` e `bash`. Os clientes usam `bash` com ferramentas como `rg`, `find` e `ls` para inspeção. |
| `full` | Expõe as ferramentas mínimas mais `grep`, `glob` e `ls` dedicados. |
| `codex` | Experimental. Expõe `open_workspace`, `read`, `apply_patch`, `exec_command` e `write_stdin`. Ferramentas de mutação e shell existentes ficam ocultas. |

`DEVSPACE_MINIMAL_TOOLS` continua sendo um alias compatível quando `DEVSPACE_TOOL_MODE` não está definido: `1` seleciona `minimal` e `0` seleciona `full`.
O modo `codex` deve ser selecionado por meio de `DEVSPACE_TOOL_MODE` e sempre usa nomes curtos fixos, independentemente de `DEVSPACE_TOOL_NAMING`.

Comandos em modo Codex rodam sem PTY por padrão. Defina `tty: true` em `exec_command` para programas interativos de terminal. O suporte a PTY usa a dependência opcional `node-pty`; `write_stdin` pode enviar entrada, consultar saída e redimensionar sessões PTY.

## Widgets

`DEVSPACE_WIDGETS` controla o uso de iframe do ChatGPT Apps.

| Valor | Comportamento |
| --- | --- |
| `full` | Padrão. A UI do widget é anexada às ferramentas expostas de workspace, arquivo, edição e shell. |
| `changes` | Habilita a ferramenta agregada `show_changes` e anexa a UI do widget em `open_workspace` e `show_changes`. |
| `off` | Desativa a UI do widget. |

## Skills

| Variável | Finalidade |
| --- | --- |
| `DEVSPACE_SKILLS` | Defina `0` para ocultar skills. Está ativado por padrão. |
| `DEVSPACE_SUBAGENTS` | Defina `1` para expor perfis de agente configurados como Subagents. Experimental e desativado por padrão. |
| `DEVSPACE_AGENT_DIR` | Padrão `~/.codex`; sua subpasta `skills` é carregada para compatibilidade. |
| `DEVSPACE_SKILL_PATHS` | Diretórios adicionais de skills opcionais, separados por vírgula. |

O DevSpace descobre skills padrão do Agent Skills em:

- `~/.agents/skills`
- projeto `.agents/skills`
- `~/.devspace/skills`

Ele também mantém compatibilidade com:

- a skill embutida `subagent-delegation` quando `DEVSPACE_SUBAGENTS=1`, a menos que `~/.devspace/skills/subagent-delegation/SKILL.md` exista
- `DEVSPACE_AGENT_DIR/skills`, padrão `~/.codex/skills`
- caminhos adicionais de `DEVSPACE_SKILL_PATHS`

Quando os Subagents estão habilitados, o DevSpace descobre perfis de agente em:

- `~/.devspace/agents/*.md`
- projeto `.devspace/agents/*.md`

`open_workspace` retorna um catálogo compacto contendo nomes de perfil,
descrições, provedores e modelos/níveis de thinking opcionais para que o host possa escolher um agente sem ler detalhes específicos de início do provedor. `devspace agents ls` lista sessões existentes de subagente para o workspace atual, limitadas pelo ambiente do workspace injetado nos comandos shell. A skill `subagent-delegation` ensina o modelo a usar apenas o fluxo mínimo de `devspace agents ls`, `devspace agents run` e `devspace agents show`.

Templates iniciais de perfis estão disponíveis em `examples/agents/`. Copie ou adapte-os para um dos diretórios ativos de perfis antes de usar.

Caminhos legaics de projetos como `.pi/skills` podem ser adicionados por meio de `DEVSPACE_SKILL_PATHS` quando necessário.

Exemplo:

```bash
DEVSPACE_SKILL_PATHS="$HOME/.claude/skills,$HOME/company/skills" \
 npx @waishnav/devspace serve
```

## Logs

| Variável | Padrão |
| --- | --- |
| `DEVSPACE_LOG_LEVEL` | `info` |
| `DEVSPACE_LOG_FORMAT` | `json` |
| `DEVSPACE_LOG_REQUESTS` | `1` |
| `DEVSPACE_LOG_ASSETS` | `0` |
| `DEVSPACE_LOG_TOOL_CALLS` | `1` |
| `DEVSPACE_LOG_SHELL_COMMANDS` | `0` |
| `DEVSPACE_TRUST_PROXY` | `0` |

Defina `DEVSPACE_LOG_FORMAT=pretty` para depuração local.

Defina `DEVSPACE_LOG_SHELL_COMMANDS=1` apenas quando você quiser intencionalmente pré-visualizar comandos nos logs.

## Exemplo somente por ambiente

```bash
DEVSPACE_OAUTH_OWNER_TOKEN="$(openssl rand -base64 32)" \
DEVSPACE_ALLOWED_ROOTS="$HOME/personal,$HOME/work" \
DEVSPACE_PUBLIC_BASE_URL="https://devspace.example.com" \
DEVSPACE_WORKTREE_ROOT="$HOME/.devspace/worktrees" \
DEVSPACE_ARTIFACTS="1" \
DEVSPACE_TOOL_MODE="minimal" \
DEVSPACE_WIDGETS="full" \
npx @waishnav/devspace serve
```

As atribuições de ambiente devem fazer parte do mesmo comando ou serem exportadas primeiro.
