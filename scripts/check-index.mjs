// Checks index.json against this checkout before it is signed. The commit comes from --commit, its time from git,
// and --published names the index.json already on the index branch, when there is one.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { checkIndex } from "./lib/check-index.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const { values } = parseArgs({ options: { commit: { type: "string" }, published: { type: "string" }, index: { type: "string" } } });
if (values.commit === undefined) {
  process.stderr.write("usage: check-index --commit <sha> [--published <index.json>] [--index <index.json>]\n");
  process.exit(2);
}
const committedAt = Number(execFileSync("git", ["show", "-s", "--format=%ct", `${values.commit}^{commit}`], { cwd: root, encoding: "utf8" }).trim());
const errors = checkIndex({
  root,
  index: readFileSync(values.index ?? join(root, "index.json")),
  commit: values.commit,
  committedAt,
  now: Math.floor(Date.now() / 1000),
  published: values.published === undefined ? undefined : readFileSync(values.published),
  retired: JSON.parse(readFileSync(join(root, "retired.json"), "utf8")),
});
for (const e of errors) process.stderr.write(`${e}\n`);
if (errors.length > 0) process.exit(1);
process.stdout.write(`index.json matches ${values.commit}\n`);
