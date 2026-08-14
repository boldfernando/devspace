# Problemas e armadilhas

Esta página reúne os problemas de configuração que os usuários têm mais probabilidade de encontrar.

## `devspace` Command Not Found

Use `npx`:

```bash
npx @waishnav/devspace init
npx @waishnav/devspace serve
```

Se você instalou globalmente, confirme que o diretório global de binários do npm está no `PATH`.

## Versão do Node não suportada

O DevSpace requer Node `>=22.19 <27`.

Verifique:

```bash
node --version
```

Instale o Node 22 LTS com seu gerenciador de versões preferido, como `nvm`, `fnm` ou `mise`.

## `better-sqlite3` Could Not Load

Isso normalmente significa que as dependências nativas foram instaladas em uma runtime de Node diferente.

Tente:

```bash
npm rebuild better-sqlite3
```

Em seguida, execute:

```bash
npx @waishnav/devspace doctor
```

A inicialização faz uma verificação de dependência nativa antes de iniciar.

## URL pública inclui `/mcp`

Use a origem para a configuração:

```text
https://your-tunnel-host.example.com
```

Use o endpoint MCP no cliente:

```text
https://your-tunnel-host.example.com/mcp
```

Se você salvou o valor errado:

```bash
npx @waishnav/devspace config set publicBaseUrl https://your-tunnel-host.example.com
```

## A URL do túnel mudou

Túneis temporários costumam mudar de URL entre execuções.

Para uma execução pontual:

```bash
DEVSPACE_PUBLIC_BASE_URL="https://new-tunnel.example.com" npx @waishnav/devspace serve
```

Para uma URL estável:

```bash
npx @waishnav/devspace config set publicBaseUrl https://devspace.example.com
```

## Problemas de Host Header ou 403

O DevSpace deriva hosts permitidos a partir da URL pública configurada.

Execute:

```bash
npx @waishnav/devspace doctor
```

Confirme que o hostname da URL pública aparece nos hosts permitidos. Se você mudou URLs do túnel, atualize `publicBaseUrl`.

Use isso apenas para depuração local intencional:

```bash
DEVSPACE_ALLOWED_HOSTS="*" npx @waishnav/devspace serve
```

## Host de redirecionamento OAuth rejeitado

Por padrão, o DevSpace permite redirecionamentos para:

```text
chatgpt.com
localhost
127.0.0.1
```

Se outro cliente MCP usa um host de redirecionamento diferente, configure:

```bash
DEVSPACE_OAUTH_ALLOWED_REDIRECT_HOSTS="chatgpt.com,example.com" npx @waishnav/devspace serve
```

## Senha do proprietário não aceita

Certifique-se de que está digitando a senha do proprietário de:

```text
~/.devspace/auth.json
```

Para regenerar a configuração:

```bash
npx @waishnav/devspace init --force
```

## `workspaceId` desconhecido

Valores de `workspaceId` são identificadores de sessão. Se o servidor reiniciar e o cliente receber um erro de workspace desconhecido, chame `open_workspace` novamente para esse projeto.

Metadados de sessão do workspace são persistidos. O ChatGPT pode fornecer metadados opcionais de conversa que permitem ao DevSpace retomar o mesmo workspace de checkout para o mesmo projeto naquela conversa; aberturas repetidas reutilizam o `workspaceId` e não repetem o contexto já fornecido para esse checkout reutilizado. O modo worktree sempre cria um novo workspace isolado com seu próprio contexto completo.
Hosts sem metadados de conversa suportados recebem um workspace novo normal. Em todos os casos, continue passando o `workspaceId` retornado por `open_workspace` para ferramentas posteriores. Outros hosts MCP usam este fluxo explícito de workspace também.

Para revisar o trabalho, chame `show_changes` uma vez após a alteração final do arquivo relacionado. Ele mostra as alterações combinadas e avança o ponto de revisão automaticamente.

## Retenção de dados

Atualmente, o DevSpace não faz limpeza de sessões de workspace, vínculos de conversa nem refs de revisão. Uma futura política de retenção do produto definirá a limpeza segura para esses registros; nenhuma exclusão automática é feita hoje.

## Caminho do workspace rejeitado

O caminho deve estar dentro de uma das raízes permitidas configuradas durante a instalação.

Execute:

```bash
npx @waishnav/devspace config get
```

Em seguida, abra um projeto em uma raiz permitida ou execute a configuração novamente:

```bash
npx @waishnav/devspace init --force
```

## O modo worktree falha

O modo worktree exige:

- Git instalado
- o caminho está dentro de um repositório Git
- o repositório tem pelo menos um commit
- a `baseRef` solicitada resolve para um commit

Para um novo repositório, crie o primeiro commit ou use o modo checkout.

Alterações não confirmadas do checkout de origem não são copiadas para o worktree gerenciado.
Confirme, faça stash ou peça ao modelo para trabalhar em modo checkout se essas alterações forem necessárias.

## Comandos do Windows falham

A execução do shell do DevSpace exige Bash. A execução nativa de PowerShell e `cmd.exe` ainda não é suportada.

Instale o Git for Windows e use o Git Bash, ou use WSL, MSYS2 ou Cygwin Bash.

Execute:

```bash
npx @waishnav/devspace doctor
```

Confirme que o Bash foi detectado.

## Skills não aparecem

As skills estão habilitadas por padrão. Verifique:

```bash
DEVSPACE_SKILLS=1 npx @waishnav/devspace serve
```

O DevSpace procura em locais padrão de Agent Skills:

- `~/.agents/skills`
- projeto `.agents/skills`
- `~/.devspace/skills`

Ele também verifica compatibilidade e caminhos personalizados:

- a skill embutida `subagent-delegation` quando `DEVSPACE_SUBAGENTS=1`, a menos que `~/.devspace/skills/subagent-delegation/SKILL.md` exista
- `DEVSPACE_AGENT_DIR/skills`, padrão `~/.codex/skills`

