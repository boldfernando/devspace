# DevSpace

DevSpace é uma camada local de execução para hosts MCP, como ChatGPT e Claude. Ela fornece a um host remoto ferramentas com escopo de workspace para ler, editar, pesquisar, executar comandos, gerenciar Git worktrees, revisar alterações e coordenar subagentes limitados na máquina do usuário.

A SDK do Pi atualmente fornece primitivas maduras de codificação local. O DevSpace encapsula essas primitivas em um servidor MCP HTTP streamable e adiciona os limites específicos do produto: raízes aprovadas, estado do workspace, instruções, sessões de processo, worktrees, artefatos, checkpoints de revisão, widgets e execução de subagentes.

DevSpace possui a mecânica das ferramentas. O modelo recebe apenas escolhas significativas e acionáveis. O usuário vê os resultados. A definição de ferramentas não deve vazar a implementação interna nem expor opções indesejadas ao modelo quando a ferramenta pode lidar com isso.

## Modelo do produto

Estas ideias devem permanecer verdadeiras conforme o projeto evolui:

1. **O host é o orquestrador.** O DevSpace expõe capacidades e estado de execução claros. Ele não deve esconder o fluxo de trabalho em um loop opaco e não inspecionável.
2. **Tudo acontece em um workspace.** Um workspace representa um diretório de projeto ou worktree e o contexto de instruções acumulado ao operar nele.
3. **A autoridade local permanece explícita.** O DevSpace executa com acesso à máquina do usuário. Raízes, caminhos, comandos, processos, credenciais e operações destrutivas devem ser tratados como fronteiras do produto.
4. **Subagentes são trabalhadores limitados.** Um subagente deve ter uma tarefa explícita, perfil, contexto de trabalho, ciclo de vida e resultado que o host possa inspecionar e coordenar.
5. **Adaptadores ficam nas bordas.** Pi, hosts MCP e provedores de modelos têm cada um sua terminologia e capacidades próprias. O comportamento específico do provedor não deve se tornar o modelo central do domínio.
6. **Prefira primitivas compostáveis.** Construa um conjunto pequeno de operações confiáveis que possam ser combinadas em fluxos maiores em vez de incorporar todos os fluxos no servidor.

## Glossário

- **Host** — o cliente MCP que apresenta a experiência do agente e coordena o trabalho.
- **Servidor** — o servidor MCP local do DevSpace.
- **Workspace** — um diretório ou worktree aberto e seu contexto de instruções acumulado.
- **`workspaceId`** — o identificador opaco retornado por `open_workspace` e reutilizado em chamadas nesse workspace.
- **Allowed root** — uma fronteira de sistema de arquivos configurada dentro da qual um workspace pode ser aberto. Não é necessariamente um workspace.
- **Checkout mode** — operação em um checkout existente fornecido pelo usuário.
- **Worktree mode** — operação em um Git worktree isolado.
- **Tool surface** — a superfície de ferramentas exposta por um modo configurado, como minimal, full ou Codex-compatible.
- **Process session** — um comando de execução longa rastreado para entrada, saída ou encerramento posteriores.
- **Instruction file** — um `AGENTS.md` ou `CLAUDE.md` descoberto ao navegar em um workspace.
- **Subagent** — uma invocação de modelo limitada delegada e coordenada pelo host.
- **Agent profile** — o modelo, provedor, ferramentas e instruções usadas por um subagente.
- **Artifact** — uma saída exibida para o host ou usuário inspecionar.
- **Review checkpoint** — estado persistido representando um conjunto coerente de alterações.
- **Widget** — UI/Cards renderizadas pelo host anexadas a uma resposta MCP.

Use esses termos com precisão. Em especial, não use workspace, allowed root, checkout e worktree de forma intercambiável.

## Fronteiras de segurança

As ferramentas de sistema de arquivos aplicam contenção de raízes aprovadas. Os comandos de shell executam com a autoridade do usuário local e não são um sandbox geral. Nunca implique que a execução do shell está contida apenas porque as ferramentas de arquivo estão contidas.

Resolva e valide caminhos antes de ações destrutivas. Não amplie uma raiz permitida, não exclua estado de aplicação, não exponha credenciais nem substitua um processo existente como solução conveniente.

Mantenha a propriedade do túnel e as credenciais com o usuário. O DevSpace pode operar por meio de um túnel controlado pelo usuário, mas não possui o ciclo de vida nem a configuração do túnel.

## Diagnostique a camada correta

Uma falha pode pertencer ao host, ao transporte MCP, ao DevSpace, a um adaptador Pi, a um provedor, a um modelo, a uma implementação de ferramenta ou ao projeto alvo. Preserve o erro original e identifique a fronteira que falhou antes de alterar o código.

Uma exceção de adaptador não é evidência de que um modelo falhou. Um comando bem-sucedido não é evidência de que uma GUI foi aberta, um host atualizou ou um fluxo visível ao usuário teve sucesso.

Não amplie a responsabilidade do DevSpace ao corrigir um sintoma local. UI do host, nomeação de modelos do provedor, gerenciamento de túnel e experiências duplicadas de revisão exigem uma decisão explícita do produto.

## Verifique o caminho real

Determine como o usuário consumirá a alteração e verifique esse caminho. O comportamento pode diferir entre:

- o checkout de origem e a instalação empacotada via `npm`/`npx`;
- um cliente terminal direto e um host MCP real;
- um processo novo e um servidor ou host que precisa reiniciar;
- checkout mode e worktree mode;
- ambientes Linux, macOS e Bash do Windows;
- superfícies de ferramentas minimal, full e Codex-compatible;
- widgets habilitados, desabilitados ou limitados a revisão de alterações.

Declare claramente quando somente um proxy mais estreito foi verificado. Para esquemas orientados ao modelo, inspecione o que o host recebe. Para UI e artefatos, inspecione o resultado renderizado em vez de inferir sucesso a partir do comando que produziu.

## Traceie os contratos afetados

Ao alterar um conceito transversal, verifique toda a superfície que ele alcança de fato:

- esquema MCP, handler, descrição e resposta;
- ciclo de vida do workspace e carregamento de instruções;
- comportamento de root permitida e contenção de caminho;
- modos checkout e worktree;
- ciclo de vida do processo e subagente;
- filtragem de superfície de ferramenta;
- widgets, artefatos e checkpoints de revisão;
- persistência e migrações;
- pontos de entrada empacotados, documentação e exemplos.

Este é um mapa, não um requisito para tocar toda a superfície em toda mudança. Evite tanto contratos incompletos quanto edições especulativas.

## Pull requests

Crie ou atualize um PR apenas quando solicitado explicitamente e leia primeiro `CONTRIBUTING.md`. Mantenha um PR focado em uma preocupação coerente e use um título convencional como `fix:`, `feat:`, `docs:`, `refactor:` ou `chore:`.

Escreva o corpo em algumas frases naturais explicando o problema e a solução. Inclua verificação, risco ou contexto de migração apenas quando isso ajudar o revisor. Evite boilerplate gerado, inventário de commits, narração file-by-file, listas genéricas e seções obrigatórias de `Testing`.

Para alterações de UI, inclua imagens antes/depois e um vídeo curto quando o comportamento mudar. Inspecione o diff final antes de enviar. Quando disponível, use o fluxo `file-pr` para registrar o PR e `babysit-pr` para acompanhar CI e revisões.

## Onde o código vive

- `src/server.ts` — configuração do servidor MCP, registro de ferramentas e conexão de respostas.
- `src/workspaces.ts` — ciclo de vida do workspace, instruções, skills e perfis.
- `src/roots.ts` — raízes permitidas e contenção de caminho.
- `src/process-sessions.ts` — ciclo de vida de sessões de processo.
- `src/git.ts` e `src/git-worktrees.ts` — operações de Git e worktree.
- `src/local-agent-*.ts` — configuração, provedores e execução de subagentes.
- `src/artifact-*.ts` e `src/incoming-artifacts.ts` — manipulação de artefatos.
- `src/review-checkpoints.ts` — checkpoints persistidos de revisão de alterações.
- `src/ui/` — widgets MCP.
- `src/db/` — estado local persistido e migrações.
- `test/` — testes de comportamento e regressão.

Comece na fronteira nomeada pelo problema e siga os dados. Mantenha a política no DevSpace, a tradução do provedor nos adaptadores e o comportamento importante em esquemas, tipos, verificações ou resultados explícitos em vez de convenções ocultas de prompt.

## Gosto do projeto

- Prefira ciclo de vida e estado explícitos em vez de autonomia oculta.
- Mantenha tarefas, entradas, saídas, falhas e propriedade inspecionáveis.
- Mantenha a execução de subagentes composável e testável independentemente.
- Preserve os dados do host e do provedor, a menos que o DevSpace tenha uma razão concreta para normalizar.
- Adicione comportamento de compatibilidade apenas para um consumidor identificado com uma rota de atualização real.
- Reutilize termos do glossário em esquemas, tipos, documentação e erros.
- Mantenha a camada de execução pequena, confiável e previsível.
