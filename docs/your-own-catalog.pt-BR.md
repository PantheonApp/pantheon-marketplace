# Crie o seu catálogo

[English](your-own-catalog.md)

Numa próxima versão, todo hub vai vir com o catálogo oficial, que é este
repositório, e o app vai aceitar outros catálogos. Para acrescentar um, quem
administra uma Organização informa três coisas: um nome, o endereço do índice e a
chave pública de quem publica. Esta página ensina a criar um.

Um catálogo seu serve para uma empresa publicar as conexões e os modelos internos
dela, ou para uma comunidade compartilhar o que criou. Ele é uma cópia deste
repositório com outra chave: o mesmo formato de índice, a mesma assinatura e o
mesmo validador.

O que o app faz com os itens de outro catálogo:

- Nenhum modelo de outro catálogo roda sem aprovação.
- Atualizar uma conexão que muda de endereço pede uma confirmação, e cada pessoa
  conecta de novo.
- Só a mesma chave atualiza o que já está instalado.
- Num modelo de outro catálogo, as ferramentas de leitura dos passos chegam
  vazias, e a pessoa liga as que quiser. O agente de um passo é sempre o da
  Organização.
- O id de um tipo de conexão que o catálogo oficial publica é dele: o app não
  instala esse id de outro catálogo. Escolha ids seus.
- Um id de tipo de conexão que outro catálogo da Organização já instalou também é
  recusado: fica quem chegou primeiro.

## 1. Copie o repositório

O repositório do seu catálogo tem de ser público, porque o app baixa o índice sem
login. Copie só a `main` e aponte para um repositório vazio seu:

```
git clone --single-branch --branch main https://github.com/PantheonApp/pantheon-marketplace.git meu-catalogo
cd meu-catalogo
git remote set-url origin https://github.com/<dono>/<repo>.git
npm ci --ignore-scripts
git push -u origin main
```

Esse primeiro push da `main` vem antes de proteger a branch (passo 5): depois
disso, toda mudança entra por PR. Ele também dispara a esteira, e a primeira
publicação falha até o segredo do passo 4 existir. Essa falha é esperada.

Um fork também serve, com dois cuidados. Ligue o GitHub Actions na aba Actions,
porque num fork ele começa desligado. E não traga a branch `index` do oficial: se
ela veio junto, apague-a antes de publicar, porque a esteira compara as versões com o
índice que já está na `index` do seu repositório.

## 2. Gere o par de chaves

Numa pasta fora do repositório, para a chave privada nunca entrar num commit. O
`.gitignore` do repositório também ignora `*.key`, para o caso de a chave ir parar
na pasta do repositório por engano.

```sh
node -e '
const { generateKeyPairSync } = require("node:crypto");
const { existsSync, writeFileSync } = require("node:fs");
const found = ["index-signing.key", "index-signing.pub"].filter((file) => existsSync(file));
if (found.length > 0) {
  console.error(`${found.join(" and ")} already ${found.length > 1 ? "exist" : "exists"}: nothing was written`);
  process.exit(1);
}
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
writeFileSync("index-signing.key", privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600, flag: "wx" });
writeFileSync("index-signing.pub", publicKey.export({ type: "spki", format: "der" }).toString("base64") + "\n", { flag: "wx" });
'
```

Ficam dois arquivos. `index-signing.key` é a chave privada (Ed25519, PKCS8 PEM),
que só você lê. `index-signing.pub` é a chave pública (SPKI DER em base64, uma
linha), a que você entrega a quem vai usar o catálogo.

O comando se recusa a sobrescrever: ele confere os dois arquivos antes de gravar
qualquer um. Se um deles já está na pasta, ele diz qual é e para sem gravar nada.
Para gerar um par novo, use outra pasta.

Antes de seguir, guarde uma cópia da chave privada num cofre de senhas. Quem perde
a chave privada não publica mais atualizações que os apps aceitem. E trocar de
chave depois faz os itens já instalados pararem de atualizar.

## 3. Troque o que é do oficial

1. A chave pública. Ela está escrita em `keys/index-signing.pub`, em `PUBLIC_KEY`
   de `scripts/lib/signature.mjs`, no `test/signature.test.mjs` (que confere as
   duas) e nos dois README. Da pasta do repositório, troque todas de uma vez:

   ```
   velha="$(cat keys/index-signing.pub)"
   nova="$(cat <pasta das chaves>/index-signing.pub)"
   git grep -lF "$velha" | xargs perl -pi -e "s|\Q$velha\E|$nova|g"
   git grep -F "$velha"
   ```

   O último comando não pode mostrar nada. A chave velha que ficar em
   `scripts/lib/signature.mjs`, em `keys/index-signing.pub` ou no
   `test/signature.test.mjs` para a esteira antes de publicar: o `npm test` falha,
   porque o `test/signature.test.mjs` confere que os três têm a mesma chave. Uma
   `PUBLIC_KEY` velha também derruba a conferência da assinatura que vem logo
   depois de assinar. A chave velha que ficar nos README não para nada: a
   publicação sai normal, e o README só mostra a chave errada para quem lê.
2. Os itens. Apague os arquivos de `connections/` e `templates/` e ponha os seus,
   com ids seus. O [CONTRIBUTING.pt-BR.md](../CONTRIBUTING.pt-BR.md) explica cada
   campo. O `retired.json` começa vazio (`{}`).
3. `scripts/lib/official-connections.json` fica como está. Ele lista os tipos do
   oficial, e o validador recusa um tipo seu com o nome ou o servidor de um deles.
   Não publique um id dessa lista: o seu índice o marcaria como oficial. A lista
   para no dia da cópia, mas o app reserva todo id de conexão que o oficial
   publica. Antes de escolher um id, confira os itens com `kind: "connection"` no
   índice que o oficial publica:
   `https://raw.githubusercontent.com/PantheonApp/pantheon-marketplace/index/index.json`.
4. `.github/CODEOWNERS`: troque quem é dono pelas suas contas do GitHub. O
   `validate` confere que a lista de tipos oficiais tem as mesmas contas que o
   próprio CODEOWNERS.
5. Os dois README: o nome do catálogo e o endereço do índice.
6. Os testes. Os de `test/` usam os itens e as contas do oficial como exemplo, e a
   esteira roda `npm test` antes de publicar. Depois de trocar os itens, o
   `npm test` aponta os que dependem deles (hoje em `test/index.test.mjs`,
   `test/validate.test.mjs`, `test/versions.test.mjs` e
   `test/codeowners.test.mjs`): ajuste cada um para os seus itens e as suas contas.
7. Se quiser uma lista de termos que não podem entrar no repositório (nome de
   cliente, de pessoa), ponha um por linha em
   `~/.config/app-marketplace/forbidden-terms`, ou no caminho de
   `MARKETPLACE_FORBIDDEN_TERMS`, fora do repositório. Sem a lista, o `validate`
   avisa e pula essa conferência.

Confira:

```
npm run validate
npm test
```

## 4. Guarde a chave privada na esteira

1. No GitHub, em Settings, Environments, crie ou abra o environment
   `assinatura`, que é o nome usado em `.github/workflows/publish.yml`. O push do
   passo 1 já rodou a esteira, e o GitHub cria o environment nessa primeira
   execução.
2. Em Deployment branches and tags, escolha Selected branches and tags e deixe só
   a `main`. Assim, só a publicação da `main` lê a chave.
3. Ponha a chave privada como o segredo `INDEX_SIGNING_KEY` desse environment, com
   o arquivo PEM inteiro:

   ```
   gh secret set INDEX_SIGNING_KEY --env assinatura --repo <dono>/<repo> < <pasta das chaves>/index-signing.key
   ```

4. Com a cópia no cofre de senhas, apague o `index-signing.key` do disco. A chave
   privada nunca vai para o repositório.

## 5. Proteja as branches

O oficial usa duas regras (Settings, Rules, Rulesets):

- `main`: não pode ser apagada nem receber push forçado, toda mudança entra por PR
  e o check `validate` tem de passar.
- `index`: não pode ser apagada nem receber push forçado. Só a esteira escreve
  nela, sempre um commit novo por cima do anterior. Não peça PR na `index`, ou a
  esteira não consegue publicar.

## 6. Publique

Cada push na `main` (o merge de um PR, com a `main` protegida) publica. A esteira
valida os itens, roda os testes, confere que cada item alterado subiu de `version`
e gera o `index.json`. Depois, o job que lê a chave confere o índice com o próprio
checkout, assina, confere a assinatura com a `PUBLIC_KEY` e grava na branch
`index` o `index.json`, o `index.json.sig` e os arquivos dos itens.

Para conferir de fora, numa pasta vazia:

```
curl -fsSO https://raw.githubusercontent.com/<dono>/<repo>/index/index.json
curl -fsSO https://raw.githubusercontent.com/<dono>/<repo>/index/index.json.sig
node <pasta do repositório>/scripts/verify-index.mjs index.json --public-key "$(cat <pasta do repositório>/keys/index-signing.pub)"
```

A resposta certa termina em `is valid`.

## 7. Entregue as três coisas

Quem vai usar o catálogo digita no app:

- o nome do catálogo;
- o endereço do índice, o endereço cru da branch `index`:
  `https://raw.githubusercontent.com/<dono>/<repo>/index`;
- a chave pública, a linha de `keys/index-signing.pub`.

Mande a chave por um canal em que a pessoa confie. O app nunca baixa a chave do
endereço: é a chave que prova que o índice veio de você.

O app limita um catálogo de outra pessoa a: `https`, porta 443, sem
redirecionamento, até 200 itens e até 2 MiB, somando o índice e os itens. O
`build-index` deste repositório confere os 2 MiB só no índice e aceita até 500
itens, o teto do oficial, então conte os seus.

O app só troca o índice que já tem por um de `committedAt` mais novo (a hora do
commit da `main` de onde o índice saiu). E o nome que a pessoa digita no app não
pode ser o do catálogo oficial.
