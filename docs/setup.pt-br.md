# Guia de configuração

Este guia é para usuários que querem que o ChatGPT ou outro host MCP trabalhe em projetos locais por meio do DevSpace.

## Requisitos

- Node `>=22.19 <27`
- npm
- Git
- Bash, incluindo Git Bash ou WSL no Windows
- uma URL pública HTTPS que encaminhe para o servidor local do DevSpace

O DevSpace não cria o túnel público para você. Use Cloudflare Tunnel,
ngrok, Pinggy, Tailscale Funnel ou seu próprio reverse proxy HTTPS.

## Instalar e configurar

Execute:

```bash
npx @waishnav/devspace init
```

O fluxo de configuração pergunta uma coisa por vez.

### Raízes do projeto

Escolha as pastas que o ChatGPT tem permissão para abrir por meio do DevSpace. Mantenha isso estreito.

Exemplos:

```text
~/personal,~/work
```

```text
/Users/alice/dev,/Users/alice/work
```

```text
C:\Users\alice\dev,C:\Users\alice\work
```

### Porta local

O padrão é `7676`.

A URL local do MCP é:

```text
http://127.0.0.1:7676/mcp
```

### URL base pública

Inicie seu túnel ou reverse proxy antes de inserir esse valor. Aponte o túnel para:

```text
http://127.0.0.1:7676
```

Digite a origem pública sem `/mcp`:

```text
https://your-tunnel-host.example.com
```

Configure o cliente MCP com o endpoint completo do MCP:

```text
https://your-tunnel-host.example.com/mcp
```

## Iniciar o servidor

Execute:

```bash
npx @waishnav/devspace serve
```

Se a URL do seu túnel mudar em uma execução, sobrescreva sem reescrever a configuração:

```bash
DEVSPACE_PUBLIC_BASE_URL="https://new-tunnel.example.com" npx @waishnav/devspace serve
```

Para uma URL pública estável, persista-a:

```bash
npx @waishnav/devspace config set publicBaseUrl https://devspace.example.com
npx @waishnav/devspace serve
```

## Aprovar o cliente

Quando o ChatGPT, Claude ou outro cliente MCP se conecta, o DevSpace mostra uma página de aprovação da senha do proprietário. Digite a senha do proprietário impressa durante a configuração.

Os arquivos de configuração padrão são:

```text
~/.devspace/config.json
~/.devspace/auth.json
```

Mantenha `auth.json` privado.

## Verifique sua configuração

Execute:

```bash
npx @waishnav/devspace doctor
```

O comando `doctor` informa a configuração resolvida, a versão do Node, a ABI do Node, a plataforma, Git, Bash, URL pública, hosts permitidos e o status da dependência nativa do SQLite.

## Executando a partir de um checkout local

Se você estiver desenvolvendo o próprio DevSpace em vez de usar o pacote publicado:

```bash
npm install --include=dev
npm run dev
```

As mesmas regras de configuração se aplicam.
