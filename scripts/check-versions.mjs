// Checks that each catalog item changed against --base went up in version, that new ones start at 1, that a retired
// id comes back only above its last version, that retired.json only grows, and, with --published, that nothing goes
// below the published index.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { validateCatalog } from "./lib/validate.mjs";
import { execFileSync } from "node:child_process";
import { changedItems, publishedErrors, retiredAt, retiredChangeErrors, retiredErrors, retiredShapeErrors, versionErrors } from "./lib/versions.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const { values } = parseArgs({ options: { base: { type: "string" }, published: { type: "string" } } });
if (values.base === undefined) {
  process.stderr.write("usage: check-versions --base <ref> [--published <index.json>]\n");
  process.exit(2);
}

const changes = changedItems(root, values.base);
const { items } = await validateCatalog(root);
const current = items.map((i) => ({ kind: i.kind, id: i.id, version: i.item.version, sha256: createHash("sha256").update(i.bytes).digest("hex") }));
const retired = JSON.parse(await readFile(join(root, "retired.json"), "utf8"));
const mergeBase = execFileSync("git", ["merge-base", values.base, "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const errors = [...retiredShapeErrors(retired), ...versionErrors(changes), ...retiredErrors(current, retired), ...retiredChangeErrors(retiredAt(root, mergeBase), retired, "the base")];
if (values.published !== undefined) {
  const published = JSON.parse(await readFile(values.published, "utf8"));
  errors.push(...publishedErrors(current, published.items, retired), ...retiredChangeErrors(published.retired ?? {}, retired, "the published index"));
}
for (const e of errors) process.stderr.write(`${e.file}: ${e.field === "" ? "(file)" : e.field}: ${e.message}\n`);
if (errors.length > 0) process.exit(1);
process.stdout.write(`${changes.length} changed item(s), versions ok\n`);
