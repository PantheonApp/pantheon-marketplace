# Como contribuir

[English](CONTRIBUTING.md)

Um item novo ou uma mudança num item entra por PR. Antes de abrir:

```
npm ci --ignore-scripts
npm run validate
npm test
```

O `validate` diz o arquivo e o campo de cada erro. A lista de termos proibidos
só existe na máquina de quem mantém e a esteira a pula: quem revisa o PR é que
confere.

## Regras de todo item

- O arquivo fica em `connections/<id>.json`, e o `id` é igual ao nome do
  arquivo, em kebab-case (`a-z`, `0-9` e hífen).
- `version` é um inteiro a partir de 1, escrito sem ponto (`1`, não `1.0`), e
  sobe a cada mudança no item. Nunca desce abaixo da versão já publicada, e a
  mesma versão não muda de conteúdo. Item que sai do catálogo entra no
  `retired.json` com a última versão (`"connections/<id>": 3`), e só volta
  acima dela. Nenhuma linha sai do `retired.json` e nenhum número desce.
- Todo texto que a pessoa lê vem em `pt-BR` e em `en`, os dois preenchidos.
- Sem dado de empresa: nomes, hosts, canais e pessoas genéricos.
- Sem credencial. Campo com nome de segredo (`token`, `secret`, `password`,
  `api_key`...) ou valor que começa com `Bearer` ou `Basic` é recusado. O
  segredo vai para o cofre do hub, nunca para o manifesto.
- Um item não se declara oficial. Quem marca é o índice, pela lista de quem
  mantém.

## Tipo de conexão

```json
{
  "kind": "connection",
  "id": "exemplo",
  "version": 1,
  "name": { "en": "Example", "pt-BR": "Exemplo" },
  "description": { "en": "What it does.", "pt-BR": "O que faz." },
  "manifest": {
    "category": "dev",
    "logo": null,
    "color": "112233",
    "runs_on": ["hub"],
    "methods": [{ "type": "oauth" }],
    "servers": { "remote": { "url": "https://mcp.example.com/mcp" } },
    "oauth": {
      "authorization_url": "https://auth.example.com/authorize",
      "token_url": "https://auth.example.com/token",
      "use_pkce": true
    }
  }
}
```

Os campos do `manifest` são os que o hub conhece. Campo que ele não conhece é
recusado.

- `category`: `dev`, `communication`, `work`, `observability`, `data` ou
  `home`.
- `logo`: a chave de um logo que o app conhece, ou `null`.
- `color`: a cor da marca, seis dígitos hexadecimais sem `#`.
- `runs_on`: `["hub"]`, `["mac"]` ou os dois. O que roda no hub fica disponível
  para quem usa só a web.
- `methods`: como a pessoa entra.
  - `oauth`: só com `runs_on` `hub`, e pede o bloco `oauth`.
  - `token`: um token que a pessoa cola. `header` é opcional, o nome do
    cabeçalho.
  - `cli`: só com `runs_on` `mac`, e pede `reader`, o nome do comando (`gh`).
  - `none`: sem credencial.
  - `session` ainda não é aceito.
- `servers.remote.url`: o servidor MCP remoto. Servidor local não é aceito.
- `hosts`: outros hosts com que o tipo fala. Os hosts das URLs já entram
  sozinhos.
- `oauth`: `authorization_url` e `token_url` obrigatórios; `use_pkce` tem de
  ser `true`; `registration_url` e `dynamic_registration` para registro
  dinâmico do cliente (com `dynamic_registration` verdadeiro, a
  `registration_url` é obrigatória); `revoke_url`, `client_id`, `scope` e
  `auth_method` (`none`, `client_secret_basic` ou `client_secret_post`)
  opcionais. A `authorization_url` não traz `state`, `client_id`,
  `redirect_uri`, `scope` nem outro parâmetro que o hub preenche.
- `tools`: quando existe, é a lista das ferramentas do servidor que o hub pode
  guardar. Cada uma é um nome ou um objeto com `name` e `read_only`. Só leitura
  liga sozinha.
- `fields`: o que a pessoa preenche ao criar a conexão, nada secreto. Cada um
  tem `key` (minúsculas, números e sublinhado), `label` e `required`.
- `identity`: `person` (a conta é de uma pessoa) ou `service` (conta de
  serviço). Só tipo `service` pode ser conectado uma vez pela organização para
  todo mundo.
- `triggers`, `actions`, `scope_keys`, `memory_keys` e `trackers`: o hub
  guarda e lê nas próximas fases.

### Para onde o tipo fala

Todo endereço do item é `https`, na porta padrão (443), com nome público. São
recusados: endereço IP, `localhost`, nome sem domínio e nomes de rede interna
(`.local`, `.internal`, `.corp`, `.lan`, `.arpa` e parecidos). Por convenção
do catálogo, mais estrita que o hub, o nome do host é só ASCII e sem rótulo
`xn--` (punycode), para nenhuma letra parecida se passar por outra. Vale também para tipo que
roda só no Mac: rede interna é coisa da conexão que a organização cria no
próprio hub, não do catálogo.

## Templates e pacotes

Ainda não recebemos: hoje o catálogo recebe só tipos de conexão, e a esteira
recusa arquivo em `templates/` e `packages/`. Modelos de automação e pacotes
chegam depois, com plano próprio.
