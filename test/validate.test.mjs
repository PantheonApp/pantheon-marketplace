import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertSourceText, validateCatalog, validateFile } from "../scripts/lib/validate.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const github = () => JSON.parse(readFileSync(join(root, "connections/github.json"), "utf8"));

test("the catalog in the repository is valid: the connection types and the templates, and no package yet", async () => {
  const { items, errors } = await validateCatalog(root);
  assert.deepEqual(errors, []);
  assert.deepEqual(items.map((i) => `${i.kind}:${i.id}`), ["connection:github", "template:alertas-do-canal", "template:responder-thread-de-review", "template:revisar-prs-slack", "template:revisar-prs-teams"]);
});

test("the CLI with no arguments validates the whole catalog and exits zero", () => {
  const env = { ...process.env, MARKETPLACE_FORBIDDEN_TERMS: join(tmpdir(), "no-such-terms-file") };
  const run = spawnSync(process.execPath, ["scripts/validate.mjs"], { cwd: root, encoding: "utf8", env });
  assert.equal(run.status, 0, run.stderr);
});

function tempCatalog(folder) {
  const catalog = mkdtempSync(join(tmpdir(), "catalog-"));
  mkdirSync(join(catalog, folder));
  return catalog;
}

test("a file in packages/ is refused until it has its plan, whatever it holds", async () => {
  for (const folder of ["packages"]) {
    const catalog = tempCatalog(folder);
    writeFileSync(join(catalog, folder, "github.json"), JSON.stringify(github()));
    writeFileSync(join(catalog, folder, ".gitkeep"), "");
    const { items, errors } = await validateCatalog(catalog);
    assert.deepEqual(items, [], folder);
    assert.equal(errors.length, 1, JSON.stringify(errors));
    assert.ok(errors[0].file.endsWith(`${folder}/github.json`), errors[0].file);
    assert.match(errors[0].message, new RegExp(`${folder}/ is not accepted yet`));
  }
});

test("a symlink in the catalog is refused, even when it points to a valid item", async () => {
  const catalog = tempCatalog("connections");
  symlinkSync(join(root, "connections/github.json"), join(catalog, "connections/github.json"));
  const { items, errors } = await validateCatalog(catalog);
  assert.deepEqual(items, []);
  assert.match(errors[0].message, /regular file/);
});

/** A copy of the GitHub type with a change, written to a temporary catalog folder. */
function variant(change) {
  const item = github();
  change(item);
  const file = join(tempCatalog("connections"), "connections", `${item.id}.json`);
  writeFileSync(file, JSON.stringify(item));
  return file;
}

test("a connection type with hidden text in the name or description is refused", async () => {
  const name = await validateFile(variant((item) => (item.name.en = "Git\u202EbuH")));
  assert.match(name.find((e) => e.field === "name.en")?.message ?? "", /U\+202E/);
  const description = await validateFile(variant((item) => (item.description["pt-BR"] = "Repositórios\u200B e PRs.")));
  assert.match(description.find((e) => e.field === "description.pt-BR")?.message ?? "", /U\+200B/);
  assert.deepEqual(await validateFile(variant((item) => (item.name.en = "GitHub \u{1F469}\u200D\u{1F4BB}"))), []);
});

test("an item that is not a connection type is refused in connections/, and so is a package body", async () => {
  const kind = await validateFile(variant((item) => (item.kind = "template")));
  assert.match(kind.find((e) => e.field === "kind")?.message ?? "", /"template" item does not belong in connections\//);
  const body = await validateFile(variant((item) => (item.package = {})));
  assert.match(body.find((e) => e.field === "package")?.message ?? "", /body of a template/);
});

test("on a Node whose JSON.parse gives no source text, the validator stops with a clear error instead of refusing every item", () => {
  const oldParse = (text, reviver) => reviver.call({ "": JSON.parse(text) }, "", JSON.parse(text));
  assert.throws(() => assertSourceText(oldParse), /needs Node 22 or newer/);
  assert.doesNotThrow(() => assertSourceText());
});
