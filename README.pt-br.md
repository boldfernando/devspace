<p align="center">
  <picture>
    <img src="https://raw.githubusercontent.com/Waishnav/devspace/main/docs/assets/devspace-logo-light.png" alt="DevSpace logo" width="140">
  </picture>
</p>

<h1 align="center">DevSpace</h1>

<p align="center">Traga um fluxo de trabalho de codificação em estilo Codex para o ChatGPT.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@waishnav/devspace"><img alt="npm" src="https://img.shields.io/npm/v/%40waishnav%2Fdevspace?style=flat-square" /></a>
  <a href="https://github.com/Waishnav/devspace/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/Waishnav/devspace/ci.yml?style=flat-square&branch=main" /></a>
  <a href="https://github.com/Waishnav/devspace/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/npm/l/%40waishnav%2Fdevspace?style=flat-square" /></a>
</p>

[![DevSpace conectado ao ChatGPT](https://raw.githubusercontent.com/Waishnav/devspace/main/docs/assets/devspace-screenshot.png)](https://raw.githubusercontent.com/Waishnav/devspace/main/docs/assets/devspace-screenshot.png)

**Dê ao ChatGPT uma conexão segura com sua própria máquina e transforme o ChatGPT em Codex**

DevSpace é um servidor MCP auto-hospedado que permite que o ChatGPT leia, edite, pesquise e execute código em seus projetos locais reais — seus arquivos, suas ferramentas, seu terminal — sem enviar nada para terceiros. Você o executa em sua máquina, expõe por meio de um túnel que você controla e aprova a conexão com uma senha apenas você possui.

## Patrocinadores e agradecimentos especiais

<table>
  <thead>
    <tr>
      <th>Patrocinador</th>
      <th>Sobre</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center" width="220">
        <a href="https://rebates.ai/">
          <img
            src="https://app.rebates.ai/brand/rebates-lockup.svg"
            alt="Rebates"
            width="170"
          >
        </a>
      </td>
      <td>
        <strong>Os anúncios no seu terminal pagam por você.</strong><br><br>
        <a href="https://rebates.ai/">Rebates</a> adiciona um rodapé patrocinado opcional
        ao seu agente de codificação e paga um cashback para cada sessão em que ele é exibido. Desative a qualquer momento.
      </td>
    </tr>
  </tbody>
</table>

<p>
  DevSpace está aberto a novos patrocinadores.
  <a href="https://x.com/wshxnv">Entre em contato para se tornar um.</a>
</p>

## Instalação

DevSpace requer Node `>=22.19 <27`.

Instale a CLI do DevSpace:

```bash
npm install -g @waishnav/devspace
```

Em seguida, inicialize e inicie o servidor:

```bash
devspace init
devspace serve
```

Ou execute sem instalação global:

```bash
npx @waishnav/devspace init
npx @waishnav/devspace serve
```

Durante a configuração, o DevSpace pergunta:

- as pastas locais dos projetos que o ChatGPT pode abrir pelo DevSpace
- a porta local, normalmente `7676`
- sua URL pública HTTPS a partir do Cloudflare Tunnel, ngrok, Pinggy, Tailscale Funnel ou outro reverse proxy

Use a origem pública sem `/mcp` durante a configuração:

```text
https://your-tunnel-host.example.com
```

Você configurará seu cliente MCP com a URL pública `/mcp` após a instalação.

Quando o cliente se conecta, o DevSpace abre uma página de aprovação da senha do proprietário. Digite a senha do proprietário impressa por `devspace init`. Ela também é armazenada em:

```text
~/.devspace/auth.json
```

Mantenha essa senha privada.

## Conecte seu cliente MCP

O endpoint local padrão é:

```text
http://127.0.0.1:7676/mcp
```

A maioria dos usuários deve se conectar por meio de um túnel HTTPS público:

```text
https://your-tunnel-host.example.com/mcp
```

> [!NOTE]
> Usar o DevSpace como um conector MCP não vai contra as Políticas de Uso da OpenAI — é uma configuração padrão de App/connector personalizado, e escrever ou executar código não é um caso restrito. Mas sua conta é regida pelo seu uso, não pelo DevSpace. Não aponte para nada que viole os termos do seu provedor.
> Usado normalmente, você está bem. (Com base nas Políticas de Uso e Termos de Serviço da OpenAI, em junho de 2026.)

## O que o ChatGPT pode fazer

Quando conectado, o ChatGPT pode abrir uma de suas pastas de projeto aprovadas como um workspace. A partir daí, ele pode inspecionar o repositório, fazer edições pontuais, executar comandos e mostrar o que mudou.

DevSpace dá ao ChatGPT ferramentas para:

- ler, escrever e editar arquivos dentro do workspace aberto
- pesquisar código e inspecionar diretórios
- executar comandos de shell para testes, builds, git e scripts do pacote
- usar Git worktrees isolados para sessões paralelas de codificação
- seguir instruções do projeto a partir de `AGENTS.md` e `CLAUDE.md`
- descobrir skills locais em suas pastas de habilidades
- mostrar cards de ferramentas e resumos opcionais de alterações em hosts compatíveis com ChatGPT Apps

## Modelo mental

DevSpace é acesso remoto a pastas locais selecionadas.

Você decide quais raízes são permitidas. O cliente MCP ainda possui capacidades locais poderosas dentro de um workspace aberto, incluindo execução de shell. Trate um cliente conectado como um parceiro de codificação confiável com acesso à sua máquina.

Para uma sessão normal de codificação no ChatGPT:

1. Inicie seu túnel.
2. Execute `devspace serve`.
3. Conecte o cliente MCP à sua URL pública `/mcp`.
4. Aprove a conexão com a senha do proprietário.
5. Peça ao ChatGPT para abrir um projeto dentro de uma de suas raízes permitidas.

## Suporte de plataforma

DevSpace oferece suporte a ambientes Linux, macOS e Windows com shell compatível com Bash.

| Plataforma | Status | Observações |
| --- | --- | --- |
| Linux | Suportado | Requer Node, npm, Git e Bash. |
| macOS | Suportado | Requer Node, npm, Git e Bash. |
| Windows com Git Bash, WSL, MSYS2 ou Cygwin Bash | Suportado | Git Bash é a maneira mais simples em Windows nativo. |
| PowerShell do Windows ou `cmd.exe` apenas | Não suportado ainda | Instale o Git Bash ou use WSL. |

Execute isto para inspecionar sua configuração local:

```bash
devspace doctor
```

## Documentação

- [Guia de configuração](https://github.com/Waishnav/devspace/blob/main/docs/setup.md)
- [Fluxo de trabalho de codificação do ChatGPT](https://github.com/Waishnav/devspace/blob/main/docs/chatgpt-coding-workflow.md)
- [Referência de configuração](https://github.com/Waishnav/devspace/blob/main/docs/configuration.md)
- [Download nativo de arquivos](https://github.com/Waishnav/devspace/blob/main/docs/artifact-exchange.md)
- [Modelo de segurança](https://github.com/Waishnav/devspace/blob/main/docs/security.md)
- [Problemas e armadilhas](https://github.com/Waishnav/devspace/blob/main/docs/gotchas.md)

## Filosofia

Cada peça de software está se tornando conversacional. A linguagem natural está redefinindo como interagimos com ferramentas, fluxos de trabalho e sistemas.

Minha aposta é que o ChatGPT se torne o sistema operacional de tudo. Quando alcançarmos AGI, simplesmente falaremos com o ChatGPT, e ele solicitará, coordenará e orquestrará subagentes que montam os loops certos para nós.

Ainda não chegamos lá.

DevSpace é uma tentativa de adiantar esse futuro: uma forma de hosts compatíveis com MCP, como ChatGPT e Claude, trabalharem diretamente com arquivos de projetos locais por meio de ferramentas explícitas e inspecionáveis.

## Desenvolvido por Waishnav

Sou Waishnav. Gosto de construir produtos e ferramentas opinativos, e Artifacts é um exemplo.

Este ano, comecei minha jornada para construir uma empresa de um único indivíduo e múltiplos agentes capaz de gerar milhões de receita. Se você quiser acompanhar os fracassos, vitórias, lições e tudo mais, venha conversar comigo no [X](https://x.com/wshxnv).

## Mais sobre mim

<table>
  <thead>
    <tr>
      <th>Projeto</th>
      <th>Sobre</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center" width="220">
        <a href="https://gitcms.dev/">
          <img
            src="https://gitcms.dev/brand/gitcms-logo.svg"
            alt="GitCMS"
            width="48"
          /><br />
          <strong>GitCMS</strong>
        </a>
      </td>
      <td>
        <strong>CMS moderno e ferramentas para sites de conteúdo baseados em markdown — construído para agentes e humanos.</strong><br><br>
        Edição visual, fluxo editorial e agentes de conteúdo ChatGPT/Claude, com
        cada postagem e página armazenados como arquivos no seu repositório.
        <a href="https://gitcms.dev/">Saiba mais</a>.
      </td>
    </tr>
  </tbody>
</table>

## Desenvolvimento local

Para trabalhar no próprio DevSpace:

```bash
npm install --include=dev
npm run dev
npm run typecheck
npm test
npm run build
npm run start
```
