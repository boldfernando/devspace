# Download de arquivo nativo

O DevSpace pode salvar um arquivo anexado ou gerado por um host MCP, como o ChatGPT,
diretamente em um workspace aberto. Habilite a ferramenta com `DEVSPACE_ARTIFACTS=1`.

## Fluxo de trabalho

```text
open_workspace
  -> download_artifact({ file, workspaceId, path })
  -> { path }
```

1. Abra o projeto com `open_workspace`.
2. Passe o `file` nativo fornecido pelo host, o `workspaceId` retornado e um
   `path` relativo ao workspace, ainda não usado, para `download_artifact`.
3. Use o caminho retornado com as ferramentas normais de sistema de arquivos do DevSpace.

```text
download_artifact({
  file: <valor nativo do arquivo fornecido pelo host MCP>,
  workspaceId: "ws_123",
  path: "public/images/generated-image.png"
})
```

O DevSpace cria diretórios pais ausentes e recusa sobrescrever um arquivo existente. Depois do download, as ferramentas normais podem inspecionar, mover, renomear, substituir ou excluir o arquivo.

## Segurança e limites

O campo `file` deve ser o valor nativo fornecido pelo host MCP. O DevSpace não aceita URLs de download coladas nem caminhos locais de origem. Ele valida a forma completa do objeto do arquivo, hosts confiáveis de download da OpenAI e redirecionamentos antes de transmitir. Referências malformadas, campos desconhecidos, caminhos absolutos, traversal, e pais com symlink são rejeitados.

Os downloads são transmitidos sob `DEVSPACE_ARTIFACT_MAX_FILE_BYTES` e publicados como arquivos visíveis apenas ao owner sem sobrescrever um destino existente. A ferramenta está disponível atualmente no Linux. Ela não está registrada no macOS, Windows ou BSD porque o Node.js não expõe as operações de sistema de arquivos necessárias relativas a descritores ali.
