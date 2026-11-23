import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkCodeowners, ownersOf, parseCodeowners } from "../scripts/lib/codeowners.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

function withCodeowners(text) {
  const dir = mkdtempSync(join(tmpdir(), "codeowners-"));
  if (text !== undefined) {
    mkdirSync(join(dir, ".github"));
    writeFileSync(join(dir, ".github/CODEOWNERS"), text);
  }
  return dir;
}

const messages = async (dir) => (await checkCodeowners(dir)).map((e) => e.message);

test("the repository CODEOWNERS gives every official connection id to the maintainers", async () => {
  assert.deepEqual(await checkCodeowners(root), []);
});

test("a catalog without CODEOWNERS fails", async () => {
  assert.match((await messages(withCodeowners())).join("\n"), /\.github\/CODEOWNERS is missing/);
});

test("an official id with no owner fails, naming the file", async () => {
  const found = await messages(withCodeowners("/.github/CODEOWNERS @BrunoTCouto @RabahZeineddine\n/scripts/lib/official-connections.json @BrunoTCouto @RabahZeineddine\n"));
  assert.ok(found.some((m) => /^connections\/github\.json has no owner/.test(m)), found.join("\n"));
});

test("an official id owned by someone else than the maintainers fails, the last matching line wins", async () => {
  const text = [
    "# maintainers",
    "/.github/CODEOWNERS @BrunoTCouto @RabahZeineddine",
    "/scripts/lib/official-connections.json @BrunoTCouto @RabahZeineddine",
    "/connections/ @BrunoTCouto @RabahZeineddine",
    "/connections/github.json @example-contributor",
    "",
  ].join("\n");
  assert.deepEqual(await messages(withCodeowners(text)), [
    "connections/github.json is owned by @example-contributor, not by the maintainers who own .github/CODEOWNERS (@brunotcouto @rabahzeineddine)",
  ]);
});

test("a catch-all line covers every official id", async () => {
  assert.deepEqual(await messages(withCodeowners("* @BrunoTCouto @RabahZeineddine\n")), []);
});

test("**/ at the start also matches at the root", () => {
  assert.deepEqual(ownersOf(parseCodeowners("**/item.json @BrunoTCouto @RabahZeineddine\n"), "item.json"), ["@brunotcouto", "@rabahzeineddine"]);
  assert.deepEqual(ownersOf(parseCodeowners("**/item.json @BrunoTCouto @RabahZeineddine\n"), "connections/item.json"), ["@brunotcouto", "@rabahzeineddine"]);
});

test("dir/* matches the files in the folder, not in its subfolders", () => {
  const rules = parseCodeowners("/connections/* @BrunoTCouto @RabahZeineddine\n");
  assert.deepEqual(ownersOf(rules, "connections/github.json"), ["@brunotcouto", "@rabahzeineddine"]);
  assert.deepEqual(ownersOf(rules, "connections/sub/github.json"), []);
});

test("owners compare without regard to case, as GitHub does", async () => {
  const text = "/.github/CODEOWNERS @BrunoTCouto @RabahZeineddine\n/scripts/ @rabahzeineddine @brunotcouto\n/connections/ @BRUNOTCOUTO @RabahZeineddine\n";
  assert.deepEqual(await messages(withCodeowners(text)), []);
});

test("**/ in the middle matches zero or more folders", () => {
  const rules = parseCodeowners("/connections/**/*.json @BrunoTCouto @RabahZeineddine\n");
  assert.deepEqual(ownersOf(rules, "connections/github.json"), ["@brunotcouto", "@rabahzeineddine"]);
  assert.deepEqual(ownersOf(rules, "connections/sub/github.json"), ["@brunotcouto", "@rabahzeineddine"]);
});

test("the CODEOWNERS of the repository gives every file to the maintainers, the root and the lock included", async () => {
  const rules = parseCodeowners(readFileSync(join(root, ".github/CODEOWNERS"), "utf8"));
  for (const path of ["package.json", "package-lock.json", "README.md", "templates/x.json", "packages/x.json", "connections/new-type.json", "retired.json"]) {
    assert.deepEqual(ownersOf(rules, path), ["@brunotcouto", "@rabahzeineddine"], path);
  }
});
