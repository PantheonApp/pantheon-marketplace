// The job that signs trusts nothing the build job handed it: the index is checked against the checkout and git.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkIndex } from "../scripts/lib/check-index.mjs";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const AT = 1792000000;
const NOW = AT + 60;
const sha = (text) => createHash("sha256").update(text).digest("hex");

/** A checkout with one item, and the index the build would make of it. */
function setup(change = () => {}) {
  const root = mkdtempSync(join(tmpdir(), "check-"));
  mkdirSync(join(root, "connections"));
  const text = '{"kind":"connection","id":"x","version":2}\n';
  writeFileSync(join(root, "connections/x.json"), text);
  writeFileSync(join(root, "connections/.gitkeep"), "");
  const index = { format: "app-marketplace-index", version: 1, commit: COMMIT, committedAt: AT, items: [{ kind: "connection", id: "x", version: 2, path: "connections/x.json", sha256: sha(text) }], retired: {} };
  change(index, root);
  return { root, bytes: Buffer.from(JSON.stringify(index)) };
}

const run = ({ root, bytes }, extra = {}) => checkIndex({ root, index: bytes, commit: COMMIT, committedAt: AT, now: NOW, retired: {}, ...extra });

test("an index that matches the checkout, the commit and its time passes", () => {
  assert.deepEqual(run(setup()), []);
});

const refused = [
  ["a path with ../", (i) => (i.items[0].path = "connections/../x.json"), /path/],
  ["a path into .git", (i) => (i.items[0].path = ".git/config"), /path/],
  ["a path outside the catalog folders", (i) => (i.items[0].path = "scripts/x.json"), /path/],
  ["a symbolic link", (i, root) => {
    symlinkSync(join(root, "connections/x.json"), join(root, "connections/y.json"));
    i.items.push({ ...i.items[0], id: "y", path: "connections/y.json" });
  }, /regular file/],
  ["a file the checkout does not have", (i) => (i.items[0].path = "connections/z.json"), /regular file/],
  ["a sha256 that is not the one of the file", (i) => (i.items[0].sha256 = "0".repeat(64)), /sha256/],
  ["another commit", (i) => (i.commit = "f".repeat(40)), /commit/],
  ["another commit time", (i) => (i.committedAt = AT - 1), /committedAt/],
  ["a format the hub does not read", (i) => (i.format = "index"), /format/],
  ["an entry whose version is not the one of the file", (i) => (i.items[0].version = 3), /version/],
  ["an entry whose id is not the one of the file", (i) => (i.items[0].id = "w"), /id/],
  ["an entry whose kind is not the one of its folder", (i) => (i.items[0].kind = "template"), /kind/],
  ["a connection file of the commit that the index leaves out", (_, root) => writeFileSync(join(root, "connections/hidden.json"), "{}"), /hidden\.json is not in the index/],
  ["a retired list other than the one of the commit", (i) => (i.retired = { "connections/x": 1 }), /retired/],
];

for (const [name, change, message] of refused) {
  test(`refuses ${name}`, () => {
    const errors = run(setup(change));
    assert.ok(errors.some((e) => message.test(e)), JSON.stringify(errors));
  });
}

test("refuses a commit time in the future", () => {
  const errors = run(setup(), { now: AT - 3600 });
  assert.ok(errors.some((e) => /future/.test(e)), JSON.stringify(errors));
});

test("refuses an index that is not newer than the published one, as an old re-run would be", () => {
  const published = (committedAt) => Buffer.from(JSON.stringify({ format: "app-marketplace-index", version: 1, commit: "e".repeat(40), committedAt, items: [] }));
  for (const at of [AT, AT + 10]) {
    const errors = run(setup(), { published: published(at) });
    assert.ok(errors.some((e) => /not newer than the published/.test(e)), JSON.stringify(errors));
  }
  assert.deepEqual(run(setup(), { published: published(AT - 10) }), []);
});

test("refuses a published retired entry that left the index", () => {
  const published = Buffer.from(JSON.stringify({ format: "app-marketplace-index", version: 1, commit: "e".repeat(40), committedAt: AT - 10, items: [], retired: { "connections/old": 2 } }));
  const errors = run(setup(), { published });
  assert.ok(errors.some((e) => /"connections\/old" left retired\.json/.test(e)), JSON.stringify(errors));
});

test("refuses an item that goes down from the published index", () => {
  const published = Buffer.from(JSON.stringify({ format: "app-marketplace-index", version: 1, commit: "e".repeat(40), committedAt: AT - 10, items: [{ kind: "connection", id: "x", version: 5, sha256: "a".repeat(64) }] }));
  const errors = run(setup(), { published });
  assert.ok(errors.some((e) => /published at version 5/.test(e)), JSON.stringify(errors));
});
