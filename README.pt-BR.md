# pantheon-marketplace

[English](README.md)

Catálogo do Pantheon: os tipos de conexão que a organização instala com um
clique no hub. Qualquer pessoa pode propor um item por PR.

## O que mora aqui

- `connections/`: tipos de conexão. Cada um diz onde roda, como a pessoa entra
  (OAuth, token, CLI ou nenhum), com qual servidor MCP remoto ele fala e o que
  libera. Hoje: GitHub.
- `templates/` e `packages/`: ainda não recebem item, e a esteira recusa
  arquivo nelas. Os modelos de automação têm plano próprio e chegam depois, no
  formato `locum-pacote`, que é o que o hub converte.

Cada item é um arquivo JSON em `<pasta>/<id>.json`. Os esquemas estão em
[`schemas/`](schemas/), e o [CONTRIBUTING.pt-BR.md](CONTRIBUTING.pt-BR.md)
explica cada campo.

Nada aqui é código executado. Um item é dado: o hub lê o manifesto e só fala
com servidores remotos de nome público, por https. Item com comando para rodar,
servidor local ou endereço de rede interna é recusado. O método `cli` não traz
comando: ele só diz, em `reader`, o nome do comando que já está no Mac da
pessoa (como o `gh`).

## Como propor um item

Abra um PR com o arquivo na pasta certa. A esteira confere o item e quem mantém
revisa. Os tipos oficiais (os que estão em
[`scripts/lib/official-connections.json`](scripts/lib/official-connections.json))
só mudam com a revisão de quem mantém, como diz o
[CODEOWNERS](.github/CODEOWNERS).

## O que a esteira confere

Em todo PR, a esteira roda:

- `npm run validate`: o esquema e as regras de cada item. As regras acompanham
  as que o hub aplica quando lê o catálogo, com algumas a mais (nome de host só
  em ASCII, sem punycode). Quem decide no fim é o hub: ele confere tudo de novo
  e deixa de fora o item que recusar.
- `npm test`: os testes do validador, do índice, da assinatura e da conferência
  do índice.
- `npm run check-versions`: item que mudou sobe a `version`, contra a base do PR
  e contra o índice já publicado.
- `npm run build-index`: o índice sai sem erro e dentro dos limites do hub.

No push da `main`, a mesma conferência de versão roda contra o commit anterior
e o índice publicado. Antes de assinar, o job que tem a chave confere o índice
contra o próprio checkout (`scripts/check-index.mjs`): caminhos, sha256 de cada
arquivo, commit, hora do commit e que o índice é mais novo que o publicado.

## Como o hub lê

A cada push na `main`, a esteira gera o `index.json`, assina com Ed25519 e
publica no branch `index`, junto com a assinatura (`index.json.sig`) e os
arquivos dos itens. O hub lê desse endereço (`APP_CATALOG_URL`):

```
https://raw.githubusercontent.com/PantheonApp/pantheon-marketplace/index
```

O índice lista cada item com o commit de onde saiu, a hora do commit
(`committedAt`, em segundos) e o sha256 do arquivo. O hub confere a assinatura
com a chave pública que vem no código dele, recusa índice mais velho que o que
já aceitou e confere o sha256 de cada item antes de mostrar ou instalar.

A chave pública do índice (SPKI DER em base64, também em
[`keys/index-signing.pub`](keys/index-signing.pub)):

```
MCowBQYDK2VwAyEAVDPQ3V7UnUkEVn+wer6sHmDEldnGR3FTbSbzXI8Q7pc=
```

A chave privada fica no segredo `INDEX_SIGNING_KEY` do environment
`assinatura`, e só o job que assina a lê.

## Rodar local

Precisa do Node 22 ou mais novo.

```
npm ci --ignore-scripts
npm run validate
npm test
npm run build-index -- --commit "$(git rev-parse HEAD)"
```
