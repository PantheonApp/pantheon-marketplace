// What the job that signs checks before it signs, with git and node:crypto only: it does not trust the index the
// build job handed it, so each entry is checked against the checkout of the same commit.
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FOLDERS } from "./folders.mjs";
import { publishedErrors, retiredChangeErrors } from "./versions.mjs";

export const ENTRY_PATH = /^(connections|templates|packages)\/[a-z0-9-]+\.json$/;
/** Room for clocks that disagree, in seconds: a commit time further ahead than this is refused. */
const CLOCK_SKEW = 300;
const MAX_ENTRIES = 500;
const MAX_INDEX_BYTES = 2 * 1024 * 1024;

const sortedKeys = (o) => Object.fromEntries(Object.keys(o).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((k) => [k, o[k]]));

const parse = (bytes) => {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    return undefined;
  }
};

/**
 * Errors, as sentences, for `index` (the bytes of index.json) against the checkout at `root`, the commit and its time
 * from git, the clock (`now`, in seconds) and the index already on the index branch (`published`, bytes, optional).
 */
export function checkIndex({ root, index, commit, committedAt, now, published, retired }) {
  const errors = [];
  if (index.length > MAX_INDEX_BYTES) errors.push("the index is over the 2 MiB the hub reads");
  const value = parse(index);
  if (value === undefined || typeof value !== "object" || !Array.isArray(value.items)) return [...errors, "the index is not JSON with a list of items"];
  if (typeof value.format !== "string" || !value.format.endsWith("-marketplace-index")) errors.push("the format is not a marketplace index");
  if (value.version !== 1) errors.push("the index version is not 1");
  if (value.commit !== commit) errors.push(`the commit of the index is ${JSON.stringify(value.commit)}, not ${commit}`);
  if (value.committedAt !== committedAt) errors.push(`committedAt is ${JSON.stringify(value.committedAt)}, not ${committedAt}, the time of the commit`);
  if (committedAt > now + CLOCK_SKEW) errors.push(`committedAt ${committedAt} is in the future`);
  if (value.items.length > MAX_ENTRIES) errors.push(`${value.items.length} entries, over the ${MAX_ENTRIES} the hub reads`);
  for (const entry of value.items) {
    const path = entry?.path;
    if (typeof path !== "string" || !ENTRY_PATH.test(path)) {
      errors.push(`the path ${JSON.stringify(path)} is not a catalog item`);
      continue;
    }
    let stat;
    try {
      stat = lstatSync(join(root, path));
    } catch {
      stat = undefined;
    }
    if (stat === undefined || !stat.isFile()) {
      errors.push(`${path} is not a regular file in the checkout`);
      continue;
    }
    const bytes = readFileSync(join(root, path));
    if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256) {
      errors.push(`${path} does not match the sha256 of its entry`);
    }
    const item = parse(bytes);
    const folder = path.split("/")[0];
    if (entry.kind !== FOLDERS[folder] || item?.kind !== entry.kind) errors.push(`${path}: the kind of the entry is ${JSON.stringify(entry.kind)}, of the file ${JSON.stringify(item?.kind)}, of the folder "${FOLDERS[folder]}"`);
    if (item?.id !== entry.id || `${folder}/${entry.id}.json` !== path) errors.push(`${path}: the id of the entry is ${JSON.stringify(entry.id)}, of the file ${JSON.stringify(item?.id)}`);
    if (item?.version !== entry.version) errors.push(`${path}: the version of the entry is ${JSON.stringify(entry.version)}, of the file ${JSON.stringify(item?.version)}`);
  }
  // Nothing of the commit left out: every item file in the catalog folders has its entry.
  const listed = new Set(value.items.map((e) => e?.path));
  for (const folder of Object.keys(FOLDERS)) {
    let names = [];
    try {
      names = readdirSync(join(root, folder));
    } catch {
      names = [];
    }
    for (const name of names) {
      if (name !== ".gitkeep" && !listed.has(`${folder}/${name}`)) errors.push(`${folder}/${name} is not in the index`);
    }
  }
  if (JSON.stringify(value.retired) !== JSON.stringify(sortedKeys(retired))) errors.push("the retired list of the index is not the retired.json of the commit");
  if (published !== undefined) {
    const before = parse(published);
    if (before === undefined || !Number.isSafeInteger(before.committedAt) || !Array.isArray(before.items)) {
      errors.push("the published index cannot be read");
    } else {
      if (!(committedAt > before.committedAt)) errors.push(`committedAt ${committedAt} is not newer than the published index (${before.committedAt})`);
      errors.push(...publishedErrors(value.items, before.items, retired).map((e) => `${e.file}: ${e.message}`));
      errors.push(...retiredChangeErrors(before.retired ?? {}, retired, "the published index").map((e) => `${e.file}: ${e.message}`));
    }
  }
  return errors;
}
