// The connection rules of the catalog are the hub's (connection_types::validate, as a catalog source): what the hub
// leaves out of the index must not publish, and what it accepts must not be refused here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateFile } from "../scripts/lib/validate.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

/** A remote type the hub accepts: OAuth with PKCE, runs on the hub, public https hosts. */
function base() {
  return {
    kind: "connection",
    id: "example-remote",
    version: 1,
    name: { en: "Example", "pt-BR": "Exemplo" },
    description: { en: "An example remote type.", "pt-BR": "Um tipo remoto de exemplo." },
    manifest: {
      category: "dev",
      logo: null,
      color: "112233",
      runs_on: ["hub"],
      methods: [{ type: "oauth" }],
      servers: { remote: { url: "https://mcp.example.com/mcp" } },
      oauth: {
        authorization_url: "https://auth.example.com/oauth/authorize",
        token_url: "https://auth.example.com/oauth/token",
        use_pkce: true,
      },
    },
  };
}

function write(item) {
  const dir = mkdtempSync(join(tmpdir(), "catalog-"));
  mkdirSync(join(dir, "connections"));
  const file = join(dir, "connections", `${item.id}.json`);
  writeFileSync(file, JSON.stringify(item));
  return file;
}

async function errorsOf(change) {
  const item = base();
  change(item, item.manifest);
  return validateFile(write(item));
}

async function refusedAt(change, field, message) {
  const errors = await errorsOf(change);
  const hit = errors.find((e) => e.field === field && message.test(e.message));
  assert.ok(hit, `expected an error at ${field} matching ${message}, got ${JSON.stringify(errors.map((e) => [e.field, e.message]))}`);
}

test("a remote type with OAuth and PKCE that runs on the hub passes", async () => {
  assert.deepEqual(await errorsOf(() => {}), []);
});

test("what the hub accepts passes: token, none, cli on the Mac, fields, tools, scope keys, identity", async () => {
  const errors = await errorsOf((item, m) => {
    item.tags = ["dev"];
    m.runs_on = ["hub", "mac"];
    m.methods = [{ type: "oauth" }, { type: "token", header: "Authorization" }, { type: "cli", reader: "gh" }, { type: "none" }];
    m.oauth.dynamic_registration = true;
    m.oauth.registration_url = "https://auth.example.com/register";
    m.oauth.auth_method = "none";
    m.oauth.scope = "read offline_access";
    m.hosts = ["api.example.com"];
    m.fields = [{ key: "workspace", label: { en: "Workspace", "pt-BR": "Espaço" }, required: true }];
    m.tools = ["search", { name: "post", read_only: false, description: { en: "Posts.", "pt-BR": "Publica." } }];
    m.scope_keys = [{ key: "example.repo", description: { en: "Repository", "pt-BR": "Repositório" } }];
    m.triggers = ["example-event"];
    m.actions = ["example.post"];
    m.identity = "service";
    m.memory_keys = ["example.notes"];
  });
  assert.deepEqual(errors, []);
});

const refused = [
  ["session, which the hub does not accept yet", (_, m) => (m.methods = [{ type: "session" }]), "manifest.methods.0.type", /session.*not accepted/],
  ["an unknown method", (_, m) => (m.methods = [{ type: "magic" }]), "manifest.methods.0.type", /must be one of/],
  ["the same method twice", (_, m) => (m.methods = [{ type: "oauth" }, { type: "oauth" }]), "manifest.methods.1.type", /twice/],
  ["oauth on a type that runs only on the Mac", (_, m) => (m.runs_on = ["mac"]), "manifest.methods.0.type", /oauth.*hub/],
  ["cli on a type that does not run on the Mac", (_, m) => m.methods.push({ type: "cli", reader: "gh" }), "manifest.methods.1.type", /cli.*mac/],
  ["cli without the reader", (_, m) => { m.runs_on = ["hub", "mac"]; m.methods.push({ type: "cli", reader: " " }); }, "manifest.methods.1.reader", /reader/],
  ["a token header that is not a header name", (_, m) => m.methods.push({ type: "token", header: "X-Key: 1" }), "manifest.methods.1.header", /./],
  ["oauth without the oauth block", (_, m) => delete m.oauth, "manifest.oauth", /oauth block/],
  ["the oauth block without the oauth method", (_, m) => (m.methods = [{ type: "token" }]), "manifest.oauth", /only with the oauth method/],
  ["OAuth without PKCE", (_, m) => (m.oauth.use_pkce = false), "manifest.oauth.use_pkce", /true/],
  ["an authorization URL that carries a parameter the hub writes", (_, m) => (m.oauth.authorization_url += "?State=x"), "manifest.oauth.authorization_url", /"State".*hub fills/],
  ["dynamic registration without the registration URL", (_, m) => (m.oauth.dynamic_registration = true), "manifest.oauth.registration_url", /registration_url/],
  ["an unknown key in the oauth block", (_, m) => (m.oauth.client_secret_hint = "x"), "manifest.oauth.client_secret_hint", /./],
  ["no runs_on", (_, m) => delete m.runs_on, "manifest.runs_on", /required/],
  ["a place the hub does not know in runs_on", (_, m) => (m.runs_on = ["cloud"]), "manifest.runs_on.0", /must be one of/],
  ["a local server", (_, m) => (m.servers.local = { image: "example/mcp" }), "manifest.servers.local", /unknown field/],
  ["a key the hub does not know in the manifest", (_, m) => (m.optionalServer = { url: "https://mcp.example.com/" }), "manifest.optionalServer", /unknown field/],
  ["camelCase scope keys, which the hub calls scope_keys", (_, m) => (m.scopeKeys = []), "manifest.scopeKeys", /unknown field/],
  ["a server over http", (_, m) => (m.servers.remote.url = "http://mcp.example.com/mcp"), "manifest.servers.remote.url", /https/],
  ["a server on a port other than 443", (_, m) => (m.servers.remote.url = "https://mcp.example.com:8443/mcp"), "manifest.servers.remote.url", /443/],
  ["credentials in an address", (_, m) => (m.oauth.token_url = "https://user:pw@auth.example.com/token"), "manifest.oauth.token_url", /user and password/],
  ["a backslash in an address", (_, m) => (m.servers.remote.url = "https://example.com\\@10.0.0.1/"), "manifest.servers.remote.url", /invalid character/],
  ["a private address", (_, m) => (m.hosts = ["10.1.2.3"]), "manifest.hosts.0", /private range/],
  ["a public IP address", (_, m) => (m.servers.remote.url = "https://8.8.8.8/mcp"), "manifest.servers.remote.url", /IP address/],
  ["a number that a resolver takes for an address", (_, m) => (m.hosts = ["2130706433"]), "manifest.hosts.0", /IP address/],
  ["localhost", (_, m) => (m.hosts = ["app.localhost"]), "manifest.hosts.0", /this machine/],
  ["a name without a domain", (_, m) => (m.hosts = ["intranet"]), "manifest.hosts.0", /no domain/],
  ["an internal name", (_, m) => (m.oauth.token_url = "https://sso.corp/token"), "manifest.oauth.token_url", /internal network/],
  ["an internal name even when the type runs only on the Mac", (_, m) => { m.runs_on = ["mac"]; m.methods = [{ type: "none" }]; delete m.oauth; m.hosts = ["wiki.internal"]; }, "manifest.hosts.0", /internal network/],
  ["an address under a key nobody reads", (_, m) => (m.tools = [{ name: "x", endpoint: "http://10.0.0.1/" }]), "manifest.tools.0.endpoint", /https/],
  ["a key named like a credential", (_, m) => (m.oauth.client_secret = "x"), "manifest.oauth.client_secret", /looks like a credential/],
  ["a value that is a bearer header", (_, m) => (m.methods[0].hint = "Bearer abc"), "manifest.methods.0.hint", /looks like a credential/],
  ["a field named like a credential", (_, m) => (m.fields = [{ key: "api_token", label: { en: "Token", "pt-BR": "Token" } }]), "manifest.fields.0.key", /looks like a credential/],
  ["the same field twice", (_, m) => (m.fields = [{ key: "site", label: { en: "Site", "pt-BR": "Site" } }, { key: "site", label: { en: "Site", "pt-BR": "Site" } }]), "manifest.fields.1.key", /twice/],
  ["a tool without a name", (_, m) => (m.tools = [{ read_only: true }]), "manifest.tools.0", /./],
  ["a tool whose read_only is not a boolean", (_, m) => (m.tools = [{ name: "x", read_only: "yes" }]), "manifest.tools.0", /./],
  ["a scope key without its description", (_, m) => (m.scope_keys = [{ key: "x" }]), "manifest.scope_keys.0", /./],
  ["a label in one language only", (_, m) => (m.triggers = [{ label: { en: "New" } }]), "manifest.triggers.0", /./],
  ["a name of blanks", (item) => (item.name.en = "   "), "name.en", /blank/],
  ["an identity the hub does not know", (_, m) => (m.identity = "team"), "manifest.identity", /must be one of/],
  ["a NUL in a text", (_, m) => (m.methods[0].note = "a\u0000b"), "manifest.methods.0.note", /character/],
  ["a manifest over 64 KiB", (_, m) => (m.memory_keys = ["x".repeat(70 * 1024)]), "manifest", /64 KiB/],
];

for (const [name, change, field, message] of refused) {
  test(`refuses ${name}`, async () => {
    await refusedAt(change, field, message);
  });
}

test("the CLI exits non-zero and prints file and field of each error", () => {
  const item = base();
  item.manifest.methods = [{ type: "session" }];
  const run = spawnSync(process.execPath, ["scripts/validate.mjs", write(item)], { cwd: root, encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /connections\/example-remote\.json: manifest\.methods\.0\.type: /);
});

test("refuses an item file over 256 KiB, the most the hub reads of one", async () => {
  const item = base();
  const file = write(item);
  writeFileSync(file, JSON.stringify(item) + " ".repeat(256 * 1024));
  const errors = await validateFile(file);
  assert.ok(errors.some((e) => /256 KiB/.test(e.message)), JSON.stringify(errors));
});
