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

- The file is `connections/<id>.json`, and the `id` equals the file name, in
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

## Templates and packages

Not accepted yet: the pipeline refuses a file in `templates/` and `packages/`.
Automation templates come with their own plan, in the `locum-pacote` format.
