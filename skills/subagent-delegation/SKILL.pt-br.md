---
name: subagent-delegation
description: Delegue tarefas de codificação para subagentes DevSpace configurados pelo usuário.
---

# Delegação de subagente

Use esta skill quando o usuário pedir explicitamente para delegar trabalho a outro agente de codificação,
usar um subagente nomeado, obter uma segunda opinião, comparar abordagens ou executar um fluxo semelhante a subagente.

Não use subagentes silenciosamente. Informe o usuário quando outro subagente estiver sendo usado.

## Comandos principais

Use apenas estes comandos para delegação normal:

```bash
devspace agents ls
devspace agents run <profile-or-provider-or-id> "<prompt>"
devspace agents show <id>
```

`ls` mostra sessões existentes de subagente para o workspace atual. O DevSpace o limita automaticamente a partir do ambiente de shell injetado pela ferramenta do workspace.

`run <profile> "<prompt>"` inicia um perfil configurado novo e imprime um ID do agente DevSpace.

`run <provider> "<prompt>"` inicia um provedor built-in bruto quando nenhum perfil configurado é necessário. Provedores built-in são listados por `open_workspace`.

`run <id> "<prompt>"` envia uma continuação para um agente existente.

`show <id>` imprime o status e a última resposta. Se o agente ainda estiver em execução, `show` espera brevemente. Se ainda não houver resposta final, chame `show` novamente mais tarde.

Não execute CLIs do provedor como `codex`, `claude`, `opencode`, `pi`,
`cursor-agent` ou `copilot` diretamente, a menos que você esteja explicitamente depurando a integração do agente DevSpace.

## Escolhendo um perfil

Escolha perfis a partir do catálogo compacto de perfis de subagente retornado por `open_workspace`. Use o nome do perfil com `devspace agents run`. Se nenhum perfil se encaixar e a delegação ainda for apropriada, use um nome de provedor built-in vindo de `open_workspace`.

Perfis podem declarar um modelo e um nível opcional de thinking. Para substituir o modelo ou nível de thinking do provedor configurado/padrão para uma execução, passe `--model` ou `--thinking`:

```bash
devspace agents run <profile-or-provider> --model <model> "<prompt>"
devspace agents run <profile-or-provider> --thinking <level> "<prompt>"
```

Use `--thinking` apenas quando o usuário pedir uma profundidade específica de raciocínio ou quando a tarefa claramente exigir um esforço diferente do padrão do perfil configurado. Os valores de thinking são valores pass-through específicos do provedor. Use nomes suportados pelo harness local do agente selecionado; o DevSpace não traduz valores entre provedores.

Alvos de delegação bons:

- `reviewer`: segunda opinião, risco de bug, risco de segurança, lacunas de teste.
- `explorer`: investigação de código em modo somente leitura.
- `implementer`: implementação focada quando o usuário pediu delegação.

Não delegue trabalho ordinário de codificação apenas porque existe um perfil. Use as ferramentas normais do DevSpace, a menos que o usuário tenha pedido delegação, a opinião de outro agente, trabalho paralelo ou um subagente nomeado.

## Prompts do worker

Os agentes começam apenas com o prompt que você envia mais as instruções do perfil configurado. Torne os prompts autocontidos.

Formato de prompt de implementação:

```text
Goal:
<objetivo claro>

Context:
<restrições do repositório/módulo/usuário>

Relevant files:
<caminhos e por que importam>

Acceptance criteria:
- <critério>

Rules:
- Keep changes focused.
- Do not perform unrelated refactors.
- Report blockers clearly.
```

Formato de prompt de investigação somente leitura:

```text
Question:
<pergunta específica>

Scope:
<arquivos/diretórios/módulos para inspecionar>

Rules:
- Do not modify files.
- Cite relevant file paths and symbols.
- Separate facts from guesses.
```

## Depois que o worker responde

Revise sempre o resultado antes de apresentá-lo como verificado.

Para tarefas com capacidade de escrita, inspecione os arquivos alterados e execute ou explique testes relevantes. Para tarefas somente leitura, verifique se as afirmações importantes são apoiadas por evidências do repositório.

Seja transparente na resposta final:

```text
I used <profile>. It reported <summary>. I verified <checks>. Remaining risk:
<risk or none>.
```

Nunca esconda que um subagente foi usado.
