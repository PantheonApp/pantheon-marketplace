# pantheon-marketplace

[Português](README.pt-BR.md)

The Pantheon catalog: the connection types and the automation templates an
organization installs on its hub with one click. Anyone can propose an item with a pull request.

## What lives here

- `connections/`: connection types. Each one says where it runs, how a person
  signs in (OAuth, token, CLI or none), which remote MCP server it talks to and
  what it unlocks. Today: GitHub, New Relic.
- `templates/`: automation templates. Each one wraps the automation package the
  hub exports (`automation-package`, version 1): the definition of the
  automation and the agents its steps name. Once the hub's install from the
  catalog lands, installing one will make a proposal on the hub, which the
  person reviews before saving. The voice of a template is blank on purpose:
  the hub fills in the voice of whoever installs before it checks. Today: review PRs from Teams,
  reply in review threads, channel alerts, investigate an alert, weekly review prep.
- `packages/`: takes no item yet, and the pipeline refuses a file in it.

Each item is a JSON file at `<folder>/<id>.json`. The schemas are in
[`schemas/`](schemas/), and [CONTRIBUTING.md](CONTRIBUTING.md) explains every
field.

Nothing here is code that runs. An item is data: the hub reads the manifest and
talks only to remote servers with a public name, over https. An item with a
command to run, a local server or an address on an internal network is
refused. The `cli` method carries no command: it only names, in `reader`, the
command already on the person's Mac (like `gh`).

## How to propose an item

Open a pull request with the file in the right folder. The pipeline checks the
item and a maintainer reviews it. The official types (the ones in
[`scripts/lib/official-connections.json`](scripts/lib/official-connections.json))
change only with a maintainer's review, as [CODEOWNERS](.github/CODEOWNERS)
says.

## What the pipeline checks

On every pull request the pipeline runs:

- `npm run validate`: the schema and the rules of each item. The rules follow
  the ones the hub applies when it reads the catalog, with a few more (host
  names in ASCII only, no punycode). The hub decides in the end: it checks
  everything again and leaves out an item it refuses.
- `npm test`: the tests of the validator, the index, the signature and the
  index check.
- `npm run check-versions`: a changed item goes up in `version`, against the
  base of the pull request and against the published index.
- `npm run build-index`: the index builds without errors and within the hub's
  limits.

On a push to `main`, the same version check runs against the commit before and
the published index. Before it signs, the job that holds the key checks the
index against its own checkout (`scripts/check-index.mjs`): paths, the sha256 of
each file, the commit, the commit time, and that the index is newer than the
published one.

## How the hub reads it

On every push to `main`, the pipeline builds `index.json`, signs it with
Ed25519 and publishes it to the `index` branch, with the signature
(`index.json.sig`) and the item files. The hub reads from this address
(`APP_CATALOG_URL`):

```
https://raw.githubusercontent.com/PantheonApp/pantheon-marketplace/index
```

The index lists each item with the commit it came from, the commit time
(`committedAt`, in seconds) and the sha256 of the file. The hub checks the
signature with the public key built into its code, refuses an index older than
the one it already accepted, and checks the sha256 of each item before it shows
or installs anything.

The public key of the index (SPKI DER in base64, also in
[`keys/index-signing.pub`](keys/index-signing.pub)):

```
MCowBQYDK2VwAyEAVDPQ3V7UnUkEVn+wer6sHmDEldnGR3FTbSbzXI8Q7pc=
```

The private key lives in the `INDEX_SIGNING_KEY` secret of the `assinatura`
environment, and only the job that signs reads it.

To publish a catalog of your own, signed with your own key, see
[docs/your-own-catalog.md](docs/your-own-catalog.md).

## Run it locally

It needs Node 22 or newer.

```
npm ci --ignore-scripts
npm run validate
npm test
npm run build-index -- --commit "$(git rev-parse HEAD)"
```
