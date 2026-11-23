import { execFileSync } from "node:child_process";
import { FOLDERS } from "./folders.mjs";

/** Errors for items whose version does not follow the change: new starts at 1, changed goes up. */
export function versionErrors(changes) {
  const errors = [];
  for (const { path, status, before, after } of changes) {
    if (status === "A" && after?.version !== 1) {
      errors.push({ file: path, field: "version", message: `a new item starts at version 1, found ${after?.version}` });
    }
    if (status === "M" && typeof before?.version === "number" && !(typeof after?.version === "number" && after.version > before.version)) {
      errors.push({ file: path, field: "version", message: `a changed item must go up from ${before.version}, found ${after?.version}` });
    }
  }
  return errors;
}

const pathOf = (e) => `${e.kind}s/${e.id}.json`;
const keyOf = (e) => `${e.kind}s/${e.id}`;

/**
 * Errors for the items against the index already published (each `{ kind, id, version, sha256 }`): a version only goes
 * up, the same version keeps the same bytes, and an item that leaves the index is listed in retired.json with its last
 * version, so it cannot come back at a version the hub already kept.
 */
export function publishedErrors(items, published, retired) {
  const errors = [];
  for (const p of published) {
    const now = items.find((i) => i.kind === p.kind && i.id === p.id);
    if (now === undefined) {
      if (!(retired[keyOf(p)] >= p.version)) {
        errors.push({ file: pathOf(p), field: "", message: `published at version ${p.version} and gone: list it in retired.json as "${keyOf(p)}": ${p.version}` });
      }
    } else if (now.version < p.version) {
      errors.push({ file: pathOf(p), field: "version", message: `published at version ${p.version}, found ${now.version}: a version only goes up` });
    } else if (now.version === p.version && now.sha256 !== p.sha256) {
      errors.push({ file: pathOf(p), field: "version", message: `the same version ${p.version} with other content than the published one: go up` });
    }
  }
  return errors;
}

/** Errors for items whose id was retired at a version they do not go above. */
export function retiredErrors(items, retired) {
  return items
    .filter((i) => retired[keyOf(i)] !== undefined && i.version <= retired[keyOf(i)])
    .map((i) => ({ file: pathOf(i), field: "version", message: `retired at version ${retired[keyOf(i)]}: it comes back above it` }));
}

const RETIRED_KEY = /^(connections|templates|packages)\/[a-z0-9-]+$/;

/** Errors for a retired.json that is not an object of catalog paths to whole versions. */
export function retiredShapeErrors(retired) {
  if (typeof retired !== "object" || retired === null || Array.isArray(retired)) return [{ file: "retired.json", field: "", message: "must be an object" }];
  return Object.entries(retired).flatMap(([key, version]) => [
    ...(RETIRED_KEY.test(key) ? [] : [{ file: "retired.json", field: key, message: "is not a catalog path like connections/<id>" }]),
    ...(Number.isSafeInteger(version) && version >= 1 ? [] : [{ file: "retired.json", field: key, message: `must be an integer version from 1, found ${JSON.stringify(version)}` }]),
  ]);
}

/** Errors when retired.json shrinks against an earlier one (`where` says which): no key leaves, no number goes down. */
export function retiredChangeErrors(before, after, where) {
  return Object.entries(before).flatMap(([key, version]) => {
    if (!Object.hasOwn(after, key)) return [{ file: "retired.json", field: key, message: `"${key}" left retired.json, which ${where} has: a retired id stays retired` }];
    if (after[key] < version) return [{ file: "retired.json", field: key, message: `"${key}" went down from ${version} to ${after[key]} against ${where}` }];
    return [];
  });
}

/** retired.json at a revision, or an empty one when the revision has no such file. A file that is there and cannot be read is an error. */
export function retiredAt(root, rev) {
  const quiet = { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] };
  // `ls-tree` prints nothing and exits 0 when the revision exists and the file does not; a bad revision throws
  if (execFileSync("git", ["ls-tree", "--name-only", rev, "--", "retired.json"], quiet).trim() === "") return {};
  return JSON.parse(execFileSync("git", ["show", `${rev}:retired.json`], quiet));
}

/** Catalog items added, changed or removed in HEAD against the merge base with `base`, with the item before and after. */
export function changedItems(root, base) {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  const mergeBase = git("merge-base", base, "HEAD").trim();
  const read = (rev, path) => {
    try {
      return JSON.parse(git("show", `${rev}:${path}`));
    } catch {
      return undefined;
    }
  };
  const fields = git("diff", "--name-status", "--no-renames", "-z", mergeBase, "HEAD", "--", ...Object.keys(FOLDERS)).split("\0").filter((f) => f !== "");
  const changes = [];
  for (let i = 0; i < fields.length; i += 2) {
    const [status, path] = [fields[i][0], fields[i + 1]];
    if (!path.endsWith(".json")) continue;
    changes.push({
      path,
      status,
      before: status === "A" ? undefined : read(mergeBase, path),
      after: status === "D" ? undefined : read("HEAD", path),
    });
  }
  return changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
