# Modelo de segurança

O DevSpace expõe capacidades locais de codificação via MCP. Trate-o como acesso remoto à sua máquina de desenvolvimento.

O modelo de segurança é simples:

- você escolhe uma allowlist de sistema de arquivos estreita
- o endpoint MCP exige aprovação OAuth com sua senha do proprietário
- headers Host são permitidos a partir da URL pública configurada
- toda ação de codificação acontece por meio de chamadas explícitas de ferramenta MCP

## Allowlist de sistema de arquivos

O DevSpace só abre workspaces em raízes configuradas.

Boas exemplos:

```text
~/work
~/personal/open-source
```

Evite raízes amplas:

```text
~
/
C:\
```

Quanto mais estreita a raiz, mais fácil é raciocinar sobre o que o cliente MCP pode alcançar.

## Senha do proprietário

`devspace init` gera uma senha do proprietário e a armazena em:

```text
~/.devspace/auth.json
```

Quando um cliente MCP se conecta, o DevSpace mostra uma página de aprovação. Digite a senha do proprietário apenas quando quiser intencionalmente que esse cliente acesse este servidor.

Para implantações por ambiente, defina um valor longo e aleatório:

```bash
DEVSPACE_OAUTH_OWNER_TOKEN="$(openssl rand -base64 32)"
```

## URL pública e allowlist de Host

O DevSpace precisa de `DEVSPACE_PUBLIC_BASE_URL` para que os clientes MCP descubram metadados OAuth e se conectem ao recurso correto.

O valor deve ser apenas a origem:

```text
https://your-tunnel-host.example.com
```

Não inclua `/mcp` em `DEVSPACE_PUBLIC_BASE_URL`.

Por padrão, o DevSpace deriva hosts permitidos a partir do host local e da URL pública. Use `DEVSPACE_ALLOWED_HOSTS=*` apenas para depuração local intencional.

## Túneis

O DevSpace não gerencia túneis. Seu túnel ou reverse proxy deve apontar para:

```text
http://127.0.0.1:7676
```

Prefira adicionar Cloudflare Access, controles de identidade do Tailscale ou proteção equivalente em frente a túneis públicos. O OAuth do DevSpace ainda protege o endpoint MCP, mas a URL do túnel não deve ser tratada como segredo.

## Acesso ao shell

A ferramenta shell é poderosa por design. Ela foi pensada para testes, builds, git e scripts de pacote.

As ferramentas de sistema de arquivos têm contenção de caminho. Os comandos de shell executam como comandos locais e podem fazer o que sua conta de usuário pode fazer. É por isso que o cliente MCP deve ser confiável e a senha do proprietário deve permanecer privada.

## Worktrees

Worktrees gerenciados reduzem edições acidentais no seu checkout ativo, mas não são uma fronteira de segurança. São uma fronteira de fluxo de trabalho para sessões de codificação isoladas.

## Download de arquivo nativo

O download de arquivo nativo é uma transferência opt-in, de uma vez só, para um workspace já aberto. `download_artifact` aceita o valor nativo do arquivo do host MCP, o `workspaceId` retornado por `open_workspace` e um caminho de destino relativo e não usado. Ele retorna apenas o caminho relativo ao workspace e não cria um serviço persistente de artefatos nem um ID reutilizável.

O DevSpace aceita apenas o objeto documento do arquivo nativo e hosts e redirecionamentos confiáveis da OpenAI. URLs arbitrárias, caminhos locais de origem, credenciais, referências malformadas e campos extras do objeto são rejeitados.

Caminhos absolutos, traversal, pais com symlink e destinos existentes também falham em modo fechado. Os downloads são transmitidos sob o limite configurado por arquivo e são publicados sem sobrescrita como arquivos visíveis apenas ao owner. O DevSpace não extrai nem executa o conteúdo transferido.

## Logs

Por padrão, o DevSpace registra requests e chamadas de ferramenta. Pré-visualizações de comandos de shell ficam desabilitadas, a menos que `DEVSPACE_LOG_SHELL_COMMANDS=1`.

Não habilite o log de shell quando os comandos puderem conter segredos.

Os logs de artefatos contêm um workspace ID limitado, hostname validado, caminho de saída relativo ao workspace, contagem de bytes, hash, duração e metadados de status. `download_artifact` não registra o valor opaco do arquivo. Conteúdo bruto, referências de conector, IDs de arquivo nativo, credenciais bearer, URLs presignadas, caminhos de host, caminhos temporários e chunks em base64 nunca são incluídos em logs nem resultados de ferramenta.
