# Fluxo de trabalho de codificação do ChatGPT

O DevSpace traz um loop de agente de codificação em estilo Codex para o ChatGPT e outros hosts MCP: inspecionar o repositório, seguir instruções locais, fazer edições pontuais, executar verificação e mostrar ao usuário o que mudou.

## Abra um workspace

O ChatGPT deve chamar `open_workspace` uma vez para uma pasta de projeto:

```json
{
  "path": "~/work/my-project"
}
```

O resultado inclui um `workspaceId`. Todas as chamadas posteriores de arquivo, busca, edição, mostrar alterações e shell devem reutilizar o mesmo `workspaceId`.

O ChatGPT pode oferecer recuperação automática de checkout por meio de metadados opcionais de conversa do host. Isso é um detalhe de adaptador do host OpenAI, não um campo padrão da conversa MCP. Quando esse contexto opcional está disponível, abrir novamente o mesmo projeto de checkout na mesma conversa pode continuar no workspace existente, e o contexto já fornecido para esse checkout reutilizado não é repetido. O fluxo portátil continua o mesmo: continue usando o `workspaceId` retornado por `open_workspace` para operações seguintes. Hosts sem contexto de conversa suportado recebem um workspace novo normal e continuam com esse fluxo explícito de `workspaceId`.
O modelo recebe instruções úteis do workspace; a contabilidade de reutilização automática não é uma escolha visível ao modelo.

O modo worktree é deliberadamente diferente: cada chamada cria um worktree gerenciado novo e uma nova sessão de workspace com contexto completo, mesmo para o mesmo caminho e base ref.

A primeira abertura bem-sucedida de um checkout fornece instruções completas e contexto de codificação. Uma abertura repetida que reutiliza o mesmo workspace de checkout não repete o contexto visível ao modelo, mas a UI do workspace continua mostrando os detalhes completos. Cada novo worktree estabelece e retorna seu próprio contexto completo, mesmo quando o mesmo projeto já foi aberto em checkout ou em outro worktree. Abrir checkout após um worktree, portanto, fornece o contexto próprio do checkout.

Não chame `open_workspace` novamente para a mesma pasta de checkout a menos que:

- o `workspaceId` seja rejeitado como desconhecido
- o trabalho passe para outra pasta de projeto
- o trabalho mude entre checkout e worktree mode
- o usuário peça um novo worktree isolado

## Modo checkout

O modo checkout é o padrão. O DevSpace abre o diretório real:

```json
{
  "path": "~/work/my-project"
}
```

Use isso quando o usuário quiser que o ChatGPT trabalhe no checkout atual.

## Modo worktree

Use o modo worktree para trabalho paralelo isolado:

```json
{
  "path": "~/work/my-project",
  "mode": "worktree"
}
```

Worktrees gerenciados são criados em:

```text
~/.devspace/worktrees
```

O modo worktree exige um repositório Git com pelo menos um commit. Ele começa em `HEAD`, a menos que `baseRef` seja fornecido.

Cada chamada em modo worktree cria um novo worktree gerenciado e retorna um novo `workspaceId`. Reutilize esse ID para o trabalho dentro desse worktree; chame `open_workspace` em modo worktree novamente apenas quando outro worktree isolado for realmente necessário.

Alterações não confirmadas do checkout de origem não são copiadas para o worktree gerenciado.
O DevSpace relata quando o checkout de origem estava sujo para que o modelo decida como proceder com o usuário.

## Instruções do projeto

Quando um workspace é aberto, o DevSpace carrega arquivos de instrução no nível raiz:

- `AGENTS.md`
- `AGENTS.MD`
- `CLAUDE.md`
- `CLAUDE.MD`

Arquivos de instrução aninhados são retornados como `availableAgentsFiles`. O modelo deve ler o arquivo aninhado relevante antes de trabalhar naquele diretório.

Isso mantém as instruções explícitas e inspecionáveis em vez de injetar silenciosamente novo contexto em chamadas de ferramenta posteriores.

## Skills

As skills estão habilitadas por padrão para fluxos de trabalho de agente de codificação.

O DevSpace descobre Agent Skills padrão em:

- `~/.agents/skills`
- projeto `.agents/skills`
- `~/.devspace/skills`

Ele também mantém compatibilidade com:

- a skill embutida `subagent-delegation` quando `DEVSPACE_SUBAGENTS=1`, a menos que `~/.devspace/skills/subagent-delegation/SKILL.md` exista
- `DEVSPACE_AGENT_DIR/skills`, padrão `~/.codex/skills`
- caminhos adicionais de `DEVSPACE_SKILL_PATHS`

Quando os Subagents estão habilitados, o DevSpace descobre perfis de agente em `~/.devspace/agents/*.md` e projeto `.devspace/agents/*.md`.
`open_workspace` expõe um catálogo compacto com nomes de perfil, descrições, provedores e níveis opcionais de model/thinking para que o modelo possa escolher um agente configurado sem ver detalhes específicos de início do provedor.

Exemplos de perfis são empacotados em `examples/agents/` para usuários que querem modelos iniciais. Copie ou adapte-os para um dos diretórios ativos de perfis antes de usar.

Caminhos legados de projeto como `.pi/skills` podem ser adicionados por meio de `DEVSPACE_SKILL_PATHS` quando necessário.

Quando `open_workspace` retorna skills correspondentes, o modelo deve ler o `SKILL.md` anunciado antes de seguir essa skill.

Os caminhos de skills podem ficar fora do workspace. O DevSpace só permite leitura de:

- arquivos `SKILL.md` anunciados
- arquivos em um diretório de skill depois que a skill `SKILL.md` foi lida

Defina `DEVSPACE_SKILLS=0` para ocultar skills da saída do workspace. Defina `DEVSPACE_SUBAGENTS=1` para expor o catálogo experimental de subagentes e a skill `subagent-delegation`. Essa skill ensina o fluxo mínimo de `devspace agents ls`, `devspace agents run` e `devspace agents show`. O catálogo vem de `open_workspace`; `devspace agents ls` lista sessões existentes de subagente para esse workspace.

## Nomes das ferramentas

O DevSpace expõe estes nomes de ferramenta:

- `open_workspace`
- `read`
- `write`
- `edit`
- `bash`

Por padrão, o DevSpace também roda em `DEVSPACE_TOOL_MODE=minimal`, então as ferramentas dedicadas `grep`, `glob` e `ls` ficam ocultas. Use `bash` com ferramentas de linha de comando como `rg`, `find` e `ls` para busca e inspeção de diretórios.

Use `DEVSPACE_TOOL_MODE=full` para restaurar ferramentas dedicadas de busca e diretório.

A superfície experimental em estilo Codex é habilitada com `DEVSPACE_TOOL_MODE=codex`. Ela expõe:

- `open_workspace`
- `read`
- `apply_patch`
- `exec_command`
- `write_stdin`

Neste modo, `write`, `edit`, `bash`, `grep`, `glob` e `ls` não são registrados. `exec_command` retorna um ID de sessão de processo quando um comando ainda está em execução após sua janela de yield. Use `write_stdin` para consultar, enviar entrada, redimensionar um PTY ou enviar Ctrl-C. Defina `tty: true` apenas para comandos que precisam de terminal.

## Mostrar alterações

Por padrão, `DEVSPACE_WIDGETS=full`.

Nesse modo, o DevSpace anexa a UI do widget às ferramentas expostas de workspace, arquivo, edição e shell. A ferramenta agregada `show_changes` não é exposta por padrão.

Use `DEVSPACE_WIDGETS=off` para desativar a UI de widget, ou `DEVSPACE_WIDGETS=changes` para expor o fluxo agregado de show-changes.

Quando `show_changes` está exposto, chame-o exatamente uma vez após a modificação final do arquivo em qualquer turno que altere arquivos. Ele mostra as alterações combinadas para esse turno e avança automaticamente o ponto de revisão. Reutilizar um workspace não muda esse fluxo.

## Uso do shell

A ferramenta shell é para comandos que pertencem ao terminal:

- testes
- builds
- inspeção de git
- scripts de pacote
- verificações de ambiente

Escritas em arquivo devem passar pelas ferramentas de edição/escrita em vez de redirecionamento shell, heredocs, `tee`, `sed -i` ou scripts gerados.
