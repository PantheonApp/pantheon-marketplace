import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex } from "../scripts/lib/build-index.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
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

test("the index has what the hub reads: format, version 1, commit, committedAt, and per item kind, id, version, path and sha256", async () => {
  const index = JSON.parse(await buildIndex(root, AT));
  // catalog.rs (`entries` and `accept`) wants a format ending in -marketplace-index and version 1.
  assert.match(index.format, /-marketplace-index$/);
  assert.equal(index.format, "app-marketplace-index");
  assert.equal(index.version, 1);
  assert.equal(index.commit, COMMIT);
  assert.equal(index.committedAt, 1792000000);
  assert.deepEqual(Object.keys(index), ["format", "version", "commit", "committedAt", "items", "retired"]);
  assert.deepEqual(index.retired, {});
  assert.deepEqual(index.items.map((i) => `${i.kind}:${i.id}`), ["connection:github"]);
  for (const entry of index.items) {
    const bytes = readFileSync(join(root, entry.path));
    assert.equal(entry.path, `connections/${entry.id}.json`);
    assert.equal(entry.sha256, createHash("sha256").update(bytes).digest("hex"));
    // The hub leaves out an item whose file says another id or version than its entry.
    const item = JSON.parse(bytes.toString("utf8"));
    assert.equal(item.id, entry.id);
    assert.equal(item.version, entry.version);
  }
});

test("a connection requires what the install screen shows, with every host the hub counts", async () => {
  const requires = Object.fromEntries(JSON.parse(await buildIndex(root, AT)).items.map((i) => [i.id, i.requires]));
  assert.deepEqual(requires.github.methods, [{ type: "token" }]);
  assert.deepEqual(requires.github.hosts, ["api.githubcopilot.com"]);
});

test("an invalid catalog does not become an index", async () => {
  const catalog = mkdtempSync(join(tmpdir(), "catalog-"));
  mkdirSync(join(catalog, "connections"));
  const item = JSON.parse(readFileSync(join(root, "connections/github.json"), "utf8"));
  item.manifest.methods = [{ type: "session" }];
  writeFileSync(join(catalog, "connections/github.json"), JSON.stringify(item));
  await assert.rejects(buildIndex(catalog, AT), /github\.json: manifest\.methods\.0\.type: the session method/);
});

test("an OAuth scope with a colon does not break the build: only the keys that are addresses count as hosts", async () => {
  const catalog = mkdtempSync(join(tmpdir(), "catalog-"));
  mkdirSync(join(catalog, "connections"));
  const item = JSON.parse(readFileSync(join(root, "connections/github.json"), "utf8"));
  item.manifest.methods = [{ type: "oauth" }];
  item.manifest.oauth = { authorization_url: "https://auth.example.com/authorize", token_url: "https://auth.example.com/token", use_pkce: true, scope: "read:jira-work offline_access" };
  writeFileSync(join(catalog, "connections/github.json"), JSON.stringify(item));
  const [entry] = JSON.parse(await buildIndex(catalog, AT)).items;
  assert.deepEqual(entry.requires.hosts, ["api.githubcopilot.com", "auth.example.com"]);
});

test("an index over the hub limits is not built: 500 entries at most", async () => {
  const catalog = mkdtempSync(join(tmpdir(), "catalog-"));
  mkdirSync(join(catalog, "connections"));
  const item = JSON.parse(readFileSync(join(root, "connections/github.json"), "utf8"));
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

test("providers sort by code unit, not by locale", async () => {
  const catalog = mkdtempSync(join(tmpdir(), "catalog-"));
  mkdirSync(join(catalog, "templates"));
  const item = JSON.parse(readFileSync(join(root, "test/fixtures/templates/slack-reply.json"), "utf8"));
  item.package.requisitos.provedores = [
    { provedor: "anthropic", modelos: ["b", "B"] },
    { provedor: "Zeta", modelos: ["z"] },
  ];
  writeFileSync(join(catalog, "templates/slack-reply.json"), JSON.stringify(item));
  const index = JSON.parse(await buildIndex(catalog, { ...AT, folders: ["templates"] }));
  assert.deepEqual(index.items[0].requires.providers, [
    { provider: "Zeta", models: ["z"] },
    { provider: "anthropic", models: ["B", "b"] },
  ]);
});

test("the index carries minAppVersion when the item declares it, right after version, and leaves it out otherwise", async () => {
  const catalog = mkdtempSync(join(tmpdir(), "catalog-"));
  mkdirSync(join(catalog, "templates"));
  for (const [id, minAppVersion] of [["slack-reply", "0.1.10"], ["teams-reply", undefined]]) {
    const item = JSON.parse(readFileSync(join(root, `test/fixtures/templates/${id}.json`), "utf8"));
    if (minAppVersion !== undefined) item.minAppVersion = minAppVersion;
    writeFileSync(join(catalog, `templates/${id}.json`), JSON.stringify(item));
  }
  const byId = Object.fromEntries(JSON.parse(await buildIndex(catalog, { ...AT, folders: ["templates"] })).items.map((i) => [i.id, i]));
  assert.equal(byId["slack-reply"].minAppVersion, "0.1.10");
  assert.deepEqual(Object.keys(byId["slack-reply"]).slice(0, 4), ["kind", "id", "version", "minAppVersion"]);
  assert.equal("minAppVersion" in byId["teams-reply"], false);
});

test("the index marks as official the connections on the maintainers' list, and no other item", async () => {
  const items = JSON.parse(await buildIndex(root, AT)).items;
  const marked = items.filter((i) => "official" in i);
  assert.ok(marked.every((i) => i.kind === "connection" && i.official === true));
  assert.deepEqual(marked.map((i) => i.id), ["github"]);
});
