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

- O arquivo fica em `connections/<id>.json` ou `templates/<id>.json`, e o `id` é igual ao nome do
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

## Modelo de automação

Um modelo é uma automação que outra pessoa pode instalar. O arquivo é
`templates/<id>.json`, com o envelope de todo item (`kind: "template"`, `id`,
`version`, `name` e `description` em `en` e `pt-BR`, `tags`) e o corpo em
`package`: o pacote de automação que o hub exporta com
`GET /api/automations/{id}/package`, formato `automation-package`, versão 1.
Instalar passa pela mesma importação, então vira uma proposta que a pessoa
revisa, nunca uma automação que liga sozinha. O esquema é
[`schemas/template.schema.json`](schemas/template.schema.json) e as regras estão
em [`scripts/lib/template-rules.mjs`](scripts/lib/template-rules.mjs).

- `package.automation.definition`: a definição como o hub guarda
  (`schema_version` até 20, `name`, `description`, `triggers`, `steps`,
  `limits`). Os tipos de gatilho e de passo, os campos de cada um e os nomes de
  ação são os que o hub conhece; ação que o motor não executa é recusada, porque
  o hub recusaria a execução inteira.
- `voice_agent` fica em branco: quem instala escolhe a voz.
- `package.agents`: cópia de cada agente que um passo de modelo cita (`slug`,
  `name`, `when_to_use`, `instructions`, `model`). A importação oferece como
  rascunho os que a Organização não tem.
- `package.requirements`: o que o destino precisa (apps, servidores, conexões) e
  `to_fill`, os campos que ficam para quem instala. A importação não lê; serve
  para quem lê o modelo.
- `package.automation.id` é o `id` do item, ou fica de fora.

Toda ação que escreve fora do app (GitHub, Teams, Slack, chamada http) vem em
`mode: "approve"`: o hub rebaixa `auto` para `approve` nessas, então um modelo
que diz `auto` prometeria o que não faz. Só ação que lê ou fica no app
(`github.checks_wait`, `desktop.notify`) roda em `auto`.

O que um modelo nunca leva, e a esteira recusa apontando o campo:

- o que é de quem exportou: `owner`, `repo_match` e lista de `repos` do GitHub;
  `chats`, `channels` e `account` da caixa do Teams; os canais e o usuário de um
  gatilho do Slack; o `account` e a conversa fixa de uma ação do Teams, do Slack
  ou de MCP;
- credencial: chave em cabeçalho, no login ou na query de um endereço, em
  parâmetro com nome de chave, ou token em qualquer texto. Marcador (`{{...}}`)
  é preenchido na execução, então passa;
- endereço de webhook, que já é uma credencial;
- endereço interno: IP, `localhost` e nomes de rede interna;
- id de pessoa, de Organização, de chat e de canal: UUID, id de chat do Teams,
  id do Slack e e-mail.

O export do hub já tira os campos pessoais; limpe o resto antes de abrir o pull
request. Os textos são genéricos: sem nome de empresa, de pessoa ou de outro
produto. Os casos que o hub também roda estão em
`test/fixtures/hub-parity-templates/`.

## Pacotes

Ainda não recebe: a esteira recusa arquivo em `packages/`. Pacotes vêm depois,
com plano próprio.
