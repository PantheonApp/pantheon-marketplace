import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CODEOWNERS, checkCodeowners, ownersOf, parseCodeowners } from "../scripts/lib/codeowners.mjs";
import { OFFICIAL_CONNECTIONS } from "../scripts/lib/rules.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
// The file of an official id, the first on scripts/lib/official-connections.json.
const official = `connections/${[...OFFICIAL_CONNECTIONS.keys()][0]}.json`;

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
  const found = await messages(withCodeowners("/.github/CODEOWNERS @Maintainer-One @Maintainer-Two\n/scripts/lib/official-connections.json @Maintainer-One @Maintainer-Two\n"));
  assert.ok(found.some((m) => m.startsWith(`${official} has no owner`)), found.join("\n"));
});

test("an official id owned by someone else than the maintainers fails, the last matching line wins", async () => {
  const text = [
    "# maintainers",
    "/.github/CODEOWNERS @Maintainer-One @Maintainer-Two",
    "/scripts/lib/official-connections.json @Maintainer-One @Maintainer-Two",
    "/connections/ @Maintainer-One @Maintainer-Two",
    `/${official} @example-contributor`,
    "",
  ].join("\n");
  assert.deepEqual(await messages(withCodeowners(text)), [
    `${official} is owned by @example-contributor, not by the maintainers who own .github/CODEOWNERS (@maintainer-one @maintainer-two)`,
  ]);
});

test("a catch-all line covers every official id", async () => {
  assert.deepEqual(await messages(withCodeowners("* @Maintainer-One @Maintainer-Two\n")), []);
});

test("**/ at the start also matches at the root", () => {
  assert.deepEqual(ownersOf(parseCodeowners("**/item.json @Maintainer-One @Maintainer-Two\n"), "item.json"), ["@maintainer-one", "@maintainer-two"]);
  assert.deepEqual(ownersOf(parseCodeowners("**/item.json @Maintainer-One @Maintainer-Two\n"), "connections/item.json"), ["@maintainer-one", "@maintainer-two"]);
});

test("dir/* matches the files in the folder, not in its subfolders", () => {
  const rules = parseCodeowners("/connections/* @Maintainer-One @Maintainer-Two\n");
  assert.deepEqual(ownersOf(rules, "connections/item.json"), ["@maintainer-one", "@maintainer-two"]);
  assert.deepEqual(ownersOf(rules, "connections/sub/item.json"), []);
});

test("owners compare without regard to case, as GitHub does", async () => {
  const text = "/.github/CODEOWNERS @Maintainer-One @Maintainer-Two\n/scripts/ @maintainer-two @maintainer-one\n/connections/ @MAINTAINER-ONE @Maintainer-Two\n";
  assert.deepEqual(await messages(withCodeowners(text)), []);
});

test("**/ in the middle matches zero or more folders", () => {
  const rules = parseCodeowners("/connections/**/*.json @Maintainer-One @Maintainer-Two\n");
  assert.deepEqual(ownersOf(rules, "connections/item.json"), ["@maintainer-one", "@maintainer-two"]);
  assert.deepEqual(ownersOf(rules, "connections/sub/item.json"), ["@maintainer-one", "@maintainer-two"]);
});

test("the CODEOWNERS of the repository gives every file to the maintainers, the root and the lock included", async () => {
  const rules = parseCodeowners(readFileSync(join(root, CODEOWNERS), "utf8"));
  // The maintainers are the owners of CODEOWNERS itself, whoever they are in this repository.
  const maintainers = ownersOf(rules, CODEOWNERS);
  assert.notDeepEqual(maintainers, [], `${CODEOWNERS} has no owner for itself`);
  for (const path of ["package.json", "package-lock.json", "README.md", "templates/x.json", "packages/x.json", "connections/new-type.json", "retired.json"]) {
    assert.deepEqual(ownersOf(rules, path), maintainers, path);
  }
});
