import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { changedItems, publishedErrors, retiredAt, retiredChangeErrors, retiredErrors, retiredShapeErrors, versionErrors } from "../scripts/lib/versions.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const item = (version, text = "x") => ({ kind: "template", id: "a", version, text });

test("a new item starts at version 1", () => {
  assert.deepEqual(versionErrors([{ path: "templates/a.json", status: "A", after: item(1) }]), []);
  const [error] = versionErrors([{ path: "templates/a.json", status: "A", after: item(2) }]);
  assert.equal(error.field, "version");
  assert.match(error.message, /new item starts at version 1/);
});

test("a changed item goes up in version", () => {
  assert.deepEqual(versionErrors([{ path: "templates/a.json", status: "M", before: item(1), after: item(2, "y") }]), []);
  const [same] = versionErrors([{ path: "templates/a.json", status: "M", before: item(3), after: item(3, "y") }]);
  assert.match(same.message, /must go up from 3/);
  const [down] = versionErrors([{ path: "templates/a.json", status: "M", before: item(3), after: item(2, "y") }]);
  assert.match(down.message, /must go up from 3/);
});

test("a removed item needs nothing", () => {
  assert.deepEqual(versionErrors([{ path: "templates/a.json", status: "D", before: item(4) }]), []);
});

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "versions-"));
  const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: dir, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  mkdirSync(join(dir, "templates"));
  return { dir, git };
}

test("the changes come from git against the merge base, catalog folders only", () => {
  const { dir, git } = repo();
  writeFileSync(join(dir, "templates/a.json"), JSON.stringify(item(1)));
  writeFileSync(join(dir, "templates/gone.json"), JSON.stringify(item(1)));
  git("add", ".");
  git("commit", "-q", "-m", "base");
  git("switch", "-q", "-c", "topic");
  writeFileSync(join(dir, "templates/a.json"), JSON.stringify(item(1, "changed")));
  writeFileSync(join(dir, "templates/b.json"), JSON.stringify(item(1)));
  writeFileSync(join(dir, "README.md"), "docs\n");
  rmSync(join(dir, "templates/gone.json"));
  git("add", "-A");
  git("commit", "-q", "-m", "topic");
  const changes = changedItems(dir, "main");
  assert.deepEqual(
    changes.map((c) => [c.path, c.status, c.before?.version, c.after?.version]),
    [
      ["templates/a.json", "M", 1, 1],
      ["templates/b.json", "A", undefined, 1],
      ["templates/gone.json", "D", 1, undefined],
    ],
  );
  assert.equal(versionErrors(changes).length, 1);
});

test("the CLI passes when nothing changed against the base", () => {
  const run = spawnSync(process.execPath, ["scripts/check-versions.mjs", "--base", "HEAD"], { cwd: root, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
});

const entry = (id, version, sha256 = "a".repeat(64), kind = "connection") => ({ kind, id, version, sha256 });

test("against the published index, a version only goes up", () => {
  const published = [entry("x", 3)];
  assert.deepEqual(publishedErrors([entry("x", 4, "b".repeat(64))], published, {}), []);
  assert.deepEqual(publishedErrors([entry("x", 3)], published, {}), []);
  const [down] = publishedErrors([entry("x", 1, "b".repeat(64))], published, {});
  assert.match(down.message, /published at version 3/);
});

test("deleted and made again at version 1 is refused against the published index", () => {
  const [error] = publishedErrors([entry("x", 1, "c".repeat(64))], [entry("x", 2)], {});
  assert.equal(error.file, "connections/x.json");
  assert.match(error.message, /published at version 2/);
});

test("the same version with other content is refused against the published index", () => {
  const [error] = publishedErrors([entry("x", 2, "b".repeat(64))], [entry("x", 2)], {});
  assert.match(error.message, /same version 2 with other content/);
});

test("an item that leaves the index goes into retired.json with its last version, and comes back only above it", () => {
  const [missing] = publishedErrors([], [entry("x", 2)], {});
  assert.match(missing.message, /retired\.json/);
  assert.deepEqual(publishedErrors([], [entry("x", 2)], { "connections/x": 2 }), []);
  assert.match(retiredErrors([entry("x", 2)], { "connections/x": 2 })[0].message, /retired at version 2/);
  assert.deepEqual(retiredErrors([entry("x", 3)], { "connections/x": 2 }), []);
});

test("a direct push is checked against the commit before it", () => {
  const { dir, git } = repo();
  writeFileSync(join(dir, "templates/a.json"), JSON.stringify(item(1)));
  git("add", ".");
  git("commit", "-q", "-m", "one");
  writeFileSync(join(dir, "templates/a.json"), JSON.stringify(item(1, "changed")));
  git("commit", "-q", "-am", "two");
  const errors = versionErrors(changedItems(dir, "HEAD~1"));
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /must go up from 1/);
});

test("the CLI compares with the published index it is given", () => {
  const dir = mkdtempSync(join(tmpdir(), "published-"));
  const file = join(dir, "index.json");
  writeFileSync(file, JSON.stringify({ format: "app-marketplace-index", version: 1, items: [entry("github", 9)] }));
  const run = spawnSync(process.execPath, ["scripts/check-versions.mjs", "--base", "HEAD", "--published", file], { cwd: root, encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /connections\/github\.json: version: published at version 9/);
});

test("retired.json only grows: no key leaves and no number goes down", () => {
  assert.deepEqual(retiredChangeErrors({ "connections/x": 2 }, { "connections/x": 3, "connections/y": 1 }, "the base"), []);
  const [gone] = retiredChangeErrors({ "connections/x": 2 }, {}, "the base");
  assert.match(gone.message, /"connections\/x" left retired\.json.*the base/);
  const [down] = retiredChangeErrors({ "connections/x": 2 }, { "connections/x": 1 }, "the published index");
  assert.match(down.message, /went down from 2 to 1/);
});

test("retired.json takes integer versions under catalog paths only", () => {
  assert.deepEqual(retiredShapeErrors({ "connections/x": 3 }), []);
  assert.match(retiredShapeErrors({ "connections/x": "3" })[0].message, /integer/);
  assert.match(retiredShapeErrors({ "connections/x": 0 })[0].message, /integer/);
  assert.match(retiredShapeErrors({ "../x": 1 })[0].message, /catalog path/);
  assert.match(retiredShapeErrors([])[0].message, /object/);
});

test("emptying retired.json in a commit is caught against the base", () => {
  const { dir, git } = repo();
  writeFileSync(join(dir, "retired.json"), JSON.stringify({ "templates/x": 2 }));
  git("add", ".");
  git("commit", "-q", "-m", "one");
  writeFileSync(join(dir, "retired.json"), "{}\n");
  writeFileSync(join(dir, "templates/x.json"), JSON.stringify(item(1)));
  git("add", ".");
  git("commit", "-q", "-m", "two");
  const errors = retiredChangeErrors(retiredAt(dir, "HEAD~1"), retiredAt(dir, "HEAD"), "the base");
  assert.match(errors[0].message, /"templates\/x" left retired\.json/);
});

test("retired.json at a revision: empty when the file is not there, an error when it cannot be read", () => {
  const { dir, git } = repo();
  writeFileSync(join(dir, "note.txt"), "x");
  git("add", ".");
  git("commit", "-q", "-m", "no retired file");
  assert.deepEqual(retiredAt(dir, "HEAD"), {});
  writeFileSync(join(dir, "retired.json"), "{ not json");
  git("add", ".");
  git("commit", "-q", "-m", "a broken one");
  assert.throws(() => retiredAt(dir, "HEAD"));
  assert.throws(() => retiredAt(dir, "no-such-revision"));
});

test("the CLI compares retired.json with the one the published index carries", () => {
  const dir = mkdtempSync(join(tmpdir(), "published-"));
  const file = join(dir, "index.json");
  writeFileSync(file, JSON.stringify({ format: "app-marketplace-index", version: 1, items: [], retired: { "connections/gone": 4 } }));
  const run = spawnSync(process.execPath, ["scripts/check-versions.mjs", "--base", "HEAD", "--published", file], { cwd: root, encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /"connections\/gone" left retired\.json.*published index/);
});
