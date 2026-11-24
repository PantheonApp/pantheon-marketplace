import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex } from "../scripts/lib/build-index.mjs";
import { OFFICIAL_CONNECTIONS } from "../scripts/lib/rules.mjs";
import { validateCatalog } from "../scripts/lib/validate.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
// A small catalog of its own, so that the tests do not depend on the items of this repository and a copy with other
// items passes them as they are.
const fixture = fileURLToPath(new URL("fixtures/catalog/", import.meta.url));
const example = () => JSON.parse(readFileSync(join(fixture, "connections/example-tickets.json"), "utf8"));
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const AT = { commit: COMMIT, committedAt: 1792000000 };

test("the index is the same, byte for byte, when built twice for the same commit", async () => {
  assert.equal(await buildIndex(root, AT), await buildIndex(root, AT));
});

const git = (...args) => spawnSync("git", args, { cwd: root, encoding: "utf8" }).stdout.trim();

test("the CLI writes the same index.json twice in a row, dated by the commit time", () => {
  const out = mkdtempSync(join(tmpdir(), "index-"));
  const head = git("rev-parse", "HEAD");
  const run = () => {
    const r = spawnSync(process.execPath, ["scripts/build-index.mjs", "--commit", head, "--out", join(out, "index.json")], { cwd: root, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return readFileSync(join(out, "index.json"));
  };
  const first = run();
  assert.deepEqual(first, run());
  assert.equal(JSON.parse(first).committedAt, Number(git("show", "-s", "--format=%ct", head)));
});

test("the CLI refuses a commit this repository does not have", () => {
  const r = spawnSync(process.execPath, ["scripts/build-index.mjs", "--commit", COMMIT, "--out", join(tmpdir(), "never.json")], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 1);
});

/** Each entry names its file, with the sha256 of its bytes and the id and version the file says. */
function assertEntriesMatchFiles(catalog, index) {
  for (const entry of index.items) {
    const bytes = readFileSync(join(catalog, entry.path));
    assert.equal(entry.path, `${entry.kind}s/${entry.id}.json`);
    assert.equal(entry.sha256, createHash("sha256").update(bytes).digest("hex"));
    // The hub leaves out an item whose file says another id or version than its entry.
    const item = JSON.parse(bytes.toString("utf8"));
    assert.equal(item.id, entry.id);
    assert.equal(item.version, entry.version);
  }
}

test("the index has what the hub reads: format, version 1, commit, committedAt, and per item kind, id, version, path and sha256", async () => {
  const index = JSON.parse(await buildIndex(fixture, AT));
  // catalog.rs (`entries` and `accept`) wants a format ending in -marketplace-index and version 1.
  assert.match(index.format, /-marketplace-index$/);
  assert.equal(index.format, "app-marketplace-index");
  assert.equal(index.version, 1);
  assert.equal(index.commit, COMMIT);
  assert.equal(index.committedAt, 1792000000);
  assert.deepEqual(Object.keys(index), ["format", "version", "commit", "committedAt", "items", "retired"]);
  assert.deepEqual(index.retired, {});
  // Sorted by id, whatever the kind.
  assert.deepEqual(index.items.map((i) => `${i.kind}:${i.id}`), ["template:example-alerts", "connection:example-tickets"]);
  assertEntriesMatchFiles(fixture, index);
});

test("the index of the repository has one entry per item, each pointing to its file", async () => {
  const index = JSON.parse(await buildIndex(root, AT));
  const { items } = await validateCatalog(root);
  assert.deepEqual(index.items.map((i) => `${i.kind}:${i.id}`).sort(), items.map((i) => `${i.kind}:${i.id}`).sort());
  assertEntriesMatchFiles(root, index);
});

test("a connection requires what the install screen shows, with every host the hub counts", async () => {
  const requires = Object.fromEntries(JSON.parse(await buildIndex(fixture, AT)).items.map((i) => [i.id, i.requires]));
  assert.deepEqual(requires["example-tickets"].methods, [{ type: "token" }]);
  assert.deepEqual(requires["example-tickets"].hosts, ["mcp.tickets.example.com"]);
});

test("an invalid catalog does not become an index", async () => {
  const catalog = mkdtempSync(join(tmpdir(), "catalog-"));
  mkdirSync(join(catalog, "connections"));
  const item = example();
  item.manifest.methods = [{ type: "session" }];
  writeFileSync(join(catalog, "connections/example-tickets.json"), JSON.stringify(item));
  await assert.rejects(buildIndex(catalog, AT), /example-tickets\.json: manifest\.methods\.0\.type: the session method/);
});

test("an OAuth scope with a colon does not break the build: only the keys that are addresses count as hosts", async () => {
  const catalog = mkdtempSync(join(tmpdir(), "catalog-"));
  mkdirSync(join(catalog, "connections"));
  const item = example();
  item.manifest.methods = [{ type: "oauth" }];
  item.manifest.oauth = { authorization_url: "https://auth.example.com/authorize", token_url: "https://auth.example.com/token", use_pkce: true, scope: "read:jira-work offline_access" };
  writeFileSync(join(catalog, "connections/example-tickets.json"), JSON.stringify(item));
  const [entry] = JSON.parse(await buildIndex(catalog, AT)).items;
  assert.deepEqual(entry.requires.hosts, ["auth.example.com", "mcp.tickets.example.com"]);
});

test("an index over the hub limits is not built: 500 entries at most", async () => {
  const catalog = mkdtempSync(join(tmpdir(), "catalog-"));
  mkdirSync(join(catalog, "connections"));
  const item = example();
  for (let i = 0; i < 501; i++) {
    const id = `t${String(i).padStart(3, "0")}`;
    writeFileSync(join(catalog, `connections/${id}.json`), JSON.stringify({ ...item, id, name: { en: id, "pt-BR": id }, manifest: { ...item.manifest, hosts: [`${id}.example.com`], servers: { remote: { url: `https://${id}.example.com/mcp` } } } }));
  }
  await assert.rejects(buildIndex(catalog, AT), /501 entries, over the 500/);
});

test("the commit must be a full sha", async () => {
  await assert.rejects(buildIndex(root, { commit: "main", committedAt: 1 }), /commit/);
  await assert.rejects(buildIndex(root, { commit: COMMIT, committedAt: "yesterday" }), /committedAt/);
});

test("the index carries minAppVersion when the item declares it, right after version, and leaves it out otherwise", async () => {
  const catalog = mkdtempSync(join(tmpdir(), "catalog-"));
  mkdirSync(join(catalog, "connections"));
  const item = example();
  item.minAppVersion = "0.1.10";
  writeFileSync(join(catalog, "connections/example-tickets.json"), JSON.stringify(item));
  const [declared] = JSON.parse(await buildIndex(catalog, AT)).items;
  assert.equal(declared.minAppVersion, "0.1.10");
  assert.deepEqual(Object.keys(declared).slice(0, 4), ["kind", "id", "version", "minAppVersion"]);
  const left = JSON.parse(await buildIndex(fixture, AT)).items.find((i) => i.id === "example-tickets");
  assert.equal("minAppVersion" in left, false);
});

test("the index marks as official the connections on the maintainers' list, and no other item", async () => {
  // The fixture plus a connection with the first id of the list, made from what the list says of it.
  assert.ok(OFFICIAL_CONNECTIONS.size > 0, "scripts/lib/official-connections.json lists no official type");
  const [id, official] = [...OFFICIAL_CONNECTIONS][0];
  const catalog = mkdtempSync(join(tmpdir(), "catalog-"));
  cpSync(fixture, catalog, { recursive: true });
  const item = { ...example(), id, name: { en: official.names[0], "pt-BR": official.names[0] } };
  item.manifest = { ...item.manifest, hosts: official.hosts, servers: { remote: { url: `https://${official.hosts[0]}/mcp/` } } };
  writeFileSync(join(catalog, `connections/${id}.json`), JSON.stringify(item));
  const marked = JSON.parse(await buildIndex(catalog, AT)).items.filter((i) => "official" in i);
  assert.deepEqual(marked.map((i) => [i.kind, i.id, i.official]), [["connection", id, true]]);
});

test("the index of the repository marks as official exactly its connections on the maintainers' list", async () => {
  const items = JSON.parse(await buildIndex(root, AT)).items;
  const marked = items.filter((i) => "official" in i);
  assert.ok(marked.every((i) => i.official === true));
  assert.deepEqual(marked.map((i) => i.id), items.filter((i) => i.kind === "connection" && OFFICIAL_CONNECTIONS.has(i.id)).map((i) => i.id));
});
