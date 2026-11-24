# Contributing

[Português](CONTRIBUTING.pt-BR.md)

A new item or a change to an item comes in by pull request. Before you open it:

```
npm ci --ignore-scripts
npm run validate
npm test
```

`validate` names the file and the field of each error. The list of forbidden
terms lives only on the maintainers' machines and the pipeline skips it: the
reviewer of the pull request checks it.

## Rules for every item

- The file is `connections/<id>.json` or `templates/<id>.json`, and the `id` equals the file name, in
  kebab-case (`a-z`, `0-9` and hyphen).
- `version` is an integer from 1, written without a point (`1`, not `1.0`),
  and goes up on every change to the item. It never goes below the published
  version, and the same version never changes content. An item that leaves the
  catalog goes into `retired.json` with its last version
  (`"connections/<id>": 3`), and comes back only above it. No line ever
  leaves `retired.json`, and no number goes down.
- Every text a person reads comes in `pt-BR` and `en`, both filled.
- No company data: names, hosts, channels and people are generic.
- No credentials. A key named like a secret (`token`, `secret`, `password`,
  `api_key`...) or a value that starts with `Bearer` or `Basic` is refused. The
  secret goes to the hub's vault, never into the manifest.
- An item does not declare itself official. The index marks it, from the
  maintainers' list.

## Connection type

```json
{
  "kind": "connection",
  "id": "example",
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

The keys of `manifest` are the ones the hub knows. A key it does not know is
refused.

- `category`: `dev`, `communication`, `work`, `observability`, `data` or
  `home`.
- `logo`: the key of a logo the app knows, or `null`.
- `color`: the brand color, six hex digits without `#`.
- `runs_on`: `["hub"]`, `["mac"]` or both. What runs on the hub is there for
  people who only use the web.
- `methods`: how a person signs in.
  - `oauth`: only with `runs_on` `hub`, and it needs the `oauth` block.
  - `token`: a token the person pastes. `header` is optional, the header name.
  - `cli`: only with `runs_on` `mac`, and it needs `reader`, the command name
    (`gh`).
  - `none`: no credential.
  - `session` is not accepted yet.
- `servers.remote.url`: the remote MCP server. Local servers are not accepted.
- `hosts`: other hosts the type talks to. The hosts of its URLs join on their
  own.
- `oauth`: `authorization_url` and `token_url` are required; `use_pkce` must be
  `true`; `registration_url` and `dynamic_registration` for dynamic client
  registration (with `dynamic_registration` true, `registration_url` is
  required); `revoke_url`, `client_id`, `scope` and `auth_method` (`none`,
  `client_secret_basic` or `client_secret_post`) are optional. The
  `authorization_url` carries no `state`, `client_id`, `redirect_uri`, `scope`
  or other parameter the hub fills in.
- `tools`: when present, the list of the server's tools the hub may keep. Each
  one is a name or an object with `name` and `read_only`. Only read tools turn
  on by themselves.
- `fields`: what the person fills in when making the connection, nothing
  secret. Each has `key` (lowercase, digits and underscore), `label` and
  `required`.
- `identity`: `person` (the account is a person's) or `service` (a service
  account). Only a `service` type may be connected once by the organization for
  everyone.
- `triggers`, `actions`, `scope_keys`, `memory_keys` and `trackers`: the hub
  keeps them and reads them in later phases.

### Where the type talks to

Every address in the item is `https`, on the default port (443), with a public
name. Refused: IP addresses, `localhost`, names without a domain and names of
internal networks (`.local`, `.internal`, `.corp`, `.lan`, `.arpa` and the like). By a catalog
convention, stricter than the hub, a host name is ASCII only and has no `xn--`
(punycode) label, so no look-alike letter passes for another. This
holds for a type that runs only on the Mac too: an internal network belongs to
a connection the organization creates on its own hub, not to the catalog.

## Automation template

A template is an automation someone else can install. The file is
`templates/<id>.json`, with the envelope of every item (`kind: "template"`,
`id`, `version`, `name` and `description` in `en` and `pt-BR`, `tags`) and the
body in `package`: the automation package the hub exports with
`GET /api/automations/{id}/package`, format `automation-package`, version 1.
Once the hub's install from the catalog lands, installing it will go through
the same import, so it will become a proposal the person reviews, never an
automation that turns on by itself. The schema is
[`schemas/template.schema.json`](schemas/template.schema.json) and the rules are
in [`scripts/lib/template-rules.mjs`](scripts/lib/template-rules.mjs).

- `package.automation.definition`: the definition as the hub saves it
  (`schema_version` up to 20, `name`, `description`, `triggers`, `steps`,
  `limits`). Trigger and step kinds, their fields and the action names are the
  ones the hub knows; an action the engine does not run is refused, because the
  hub would refuse the whole run.
- `voice_agent` stays blank on purpose. The hub refuses a blank voice when it
  checks a definition, so it fills in the voice of whoever installs before it
  checks.
- `package.agents`: a copy of each agent a model step names (`slug`, `name`,
  `when_to_use`, `instructions`, `model`). The import offers the ones the
  Organization lacks as drafts.
- `package.requirements`: what the destination needs (apps, servers,
  connections) and `to_fill`, the fields left for whoever installs. The import
  does not read it; it tells the reader.
- `package.automation.id` is the `id` of the item, or left out.

The `mode` of an action step is `draft`, `approve`, `auto` or `never`, and
`draft`, `approve` and `never` are accepted on any action. `auto` is accepted
only on actions that read or stay in the app (`github.checks_wait`,
`digest.deliver`, `desktop.notify`, `run.continue`). It is refused:

- on every action that writes outside the app (GitHub, Teams, Slack, an http
  call) and on `mcp.call`, which counts as writing: the hub lowers `auto` to
  `approve` on those, so a template that says `auto` would promise what it does
  not do;
- on `memory.propose` and `context.update`, which the contract keeps behind an
  approval.

The same goes for `write_tools` of a model step: a tool that writes comes in
`approve`. `context.update` is refused in any mode, because the engine does not
run it.

What a template never carries, and the pipeline refuses with the field:

- what belongs to whoever exported: the GitHub `owner`, `repo_match` and a list
  of `repos`; the `chats`, `channels` and `account` of a Teams inbox; the
  channels and the user of a Slack trigger; the `account` and the fixed
  conversation of a Teams, Slack or MCP action;
- a credential: a key in a header, in the login or the query of an address, in
  a param named like one, or a token in any text. A marker (`{{...}}`) is filled
  when it runs, so it passes;
- a webhook address, which is a credential by itself;
- an internal address: IP addresses, `localhost` and names of internal networks;
- ids of people, Organizations, chats and channels: UUIDs, Teams chat ids, Slack
  ids and e-mail addresses.

The export of the hub already leaves the personal fields out; clean the rest
before you open the pull request. The texts are generic: no name of a company,
a person or another product. The cases the hub runs too are in
`test/fixtures/hub-parity-templates/`.

## Packages

Not accepted yet: the pipeline refuses a file in `packages/`. Packages come
later, with their own plan.
