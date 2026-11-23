import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020Module from "ajv/dist/2020.js";
import { FOLDERS, OPEN_FOLDERS } from "./folders.mjs";
import { OFFICIAL_CONNECTIONS, RESERVED_CONNECTION_IDS, TRIGGER_ANNOTATIONS, connectionClaims, itemRules, officialClaims } from "./rules.mjs";

const Ajv2020 = Ajv2020Module.default ?? Ajv2020Module;
const schemasDir = fileURLToPath(new URL("../../schemas/", import.meta.url));

export { FOLDERS, OPEN_FOLDERS };

/** The most the hub reads of one item file (`MAX_ITEM_BYTES` in catalog.rs). */
export const MAX_ITEM_BYTES = 256 * 1024;
const SCHEMA_OF_KIND = { connection: "connection", template: "template", package: "package" };

let compiled;
async function schemas() {
  if (compiled !== undefined) return compiled;
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, strictRequired: false });
  ajv.addVocabulary(TRIGGER_ANNOTATIONS);
  const byName = {};
  for (const name of ["envelope", "connection", "template", "package"]) {
    const schema = JSON.parse(await readFile(join(schemasDir, `${name}.schema.json`), "utf8"));
    ajv.addSchema(schema);
    byName[name] = schema.$id;
  }
  compiled = Object.fromEntries(Object.entries(byName).map(([name, id]) => [name, ajv.getSchema(id)]));
  return compiled;
}

function pointerToField(pointer) {
  return pointer
    .split("/")
    .slice(1)
    .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"))
    .join(".");
}

function schemaErrors(validate) {
  return (validate.errors ?? [])
    // A branch of oneOf that did not match says little; the oneOf error itself stays.
    .filter((e) => e.keyword !== "if" && !e.schemaPath.includes("/oneOf/"))
    .map((e) => {
      const at = pointerToField(e.instancePath);
      const join = (child) => (at === "" ? child : `${at}.${child}`);
      if (e.keyword === "required") return { field: join(e.params.missingProperty), message: `"${e.params.missingProperty}" is required` };
      if (e.keyword === "additionalProperties") return { field: join(e.params.additionalProperty), message: "unknown field" };
      if (e.keyword === "const") return { field: at, message: `must be ${JSON.stringify(e.params.allowedValue)}` };
      if (e.keyword === "oneOf" && /^manifest\.tools\.\d+$/.test(at)) return { field: at, message: "a tool is a name, or an object with a name and, when present, read_only true or false" };
      if (e.keyword === "oneOf" && /^manifest\.scope_keys\.\d+$/.test(at)) return { field: at, message: "a scope key is a name, or an object with a description in pt-BR and en" };
      if (e.keyword === "oneOf" && /^manifest\.(triggers|actions)\.\d+$/.test(at)) return { field: at, message: "is a name, or an object whose label and description come in pt-BR and en" };
      if (at === "minAppVersion" && (e.keyword === "pattern" || e.keyword === "type")) return { field: at, message: "must be a version x.y.z, numbers only, like 0.2.0" };
      if (e.keyword === "enum") return { field: at, message: `must be one of ${e.params.allowedValues.map((v) => JSON.stringify(v)).join(", ")}` };
      return { field: at, message: e.message };
    });
}

/** What the path says the item is: the id from the file name and the kind from the folder, when it is a catalog folder. */
function expectedFromPath(file) {
  const folder = basename(dirname(file));
  return { id: basename(file).replace(/\.json$/, ""), folder, kind: FOLDERS[folder] };
}

/** Containers inside containers the catalog takes; serde_json in the hub stops at 128. */
const MAX_DEPTH = 100;

/**
 * Throws when `JSON.parse` gives the reviver no source text (Node before 22): without it every `version` would read as
 * not written as an integer, and the validator would refuse every item for a reason that is not theirs.
 */
export function assertSourceText(parse = JSON.parse) {
  let source;
  parse("1", (key, value, context) => {
    source = context?.source;
    return value;
  });
  if (source !== "1") throw new Error(`the validator needs Node 22 or newer: this Node (${process.version}) gives JSON.parse no source text`);
}

/** How deep containers go, without recursion. */
function depthOf(value) {
  let max = 0;
  const stack = [[value, 1]];
  while (stack.length > 0) {
    const [v, d] = stack.pop();
    if (typeof v !== "object" || v === null) continue;
    max = Math.max(max, d);
    for (const child of Object.values(v)) stack.push([child, d + 1]);
  }
  return max;
}

/**
 * The first key written twice in one object of a JSON text already known to be valid. Both readers keep the last one,
 * but whoever reviews the file reads the first.
 */
function duplicateKey(text) {
  const stack = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "{") stack.push({ keys: new Set(), expectKey: true });
    else if (c === "[") stack.push(undefined);
    else if (c === "}" || c === "]") stack.pop();
    else if (c === ",") {
      const top = stack.at(-1);
      if (top !== undefined) top.expectKey = true;
    } else if (c === "\"") {
      let j = i + 1;
      while (text[j] !== "\"") j += text[j] === "\\" ? 2 : 1;
      const top = stack.at(-1);
      if (top?.expectKey) {
        const key = JSON.parse(text.slice(i, j + 1));
        if (top.keys.has(key)) return key;
        top.keys.add(key);
        top.expectKey = false;
      }
      i = j;
    }
  }
  return undefined;
}

/**
 * The JSON as serde_json reads it in the hub, or why it would not: UTF-8 only, no byte order mark, no lone
 * surrogate, no number out of range, and a `version` written as an integer (1.0 and 1e0 are not one to the hub).
 */
function parseLikeTheHub(bytes) {
  assertSourceText();
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return { error: "not valid UTF-8" };
  }
  const issues = [];
  const versions = new WeakMap();
  let item;
  try {
    item = JSON.parse(text, function (key, value, context) {
      if (!key.isWellFormed()) issues.push({ field: "", error: "a key has a lone surrogate, which the hub cannot read" });
      if (typeof value === "string" && !value.isWellFormed()) issues.push({ field: key, error: "a lone surrogate, which the hub cannot read" });
      if (typeof value === "number" && !Number.isFinite(value)) issues.push({ field: key, error: "a number out of range, which the hub cannot read" });
      if (key === "version" && typeof value === "number") versions.set(this, context.source);
      return value;
    });
  } catch (error) {
    return { error: `not valid JSON: ${error.message}` };
  }
  if (issues.length > 0) return issues[0];
  if (depthOf(item) > MAX_DEPTH) return { error: `nested deeper than ${MAX_DEPTH} levels` };
  const twice = duplicateKey(text);
  if (twice !== undefined) return { field: twice, error: "this key is written twice in the same object" };
  const source = typeof item === "object" && item !== null ? versions.get(item) : undefined;
  if (source !== undefined && !/^-?[0-9]+$/.test(source)) return { field: "version", error: `must be written as an integer, found ${source}` };
  return { item };
}

/** Parses and checks one file. Returns the item and its errors, each with file, field and message. */
export async function checkFile(file) {
  const fail = (field, message, bytes) => ({ bytes, item: undefined, errors: [{ file, field, message }] });
  if (!(await lstat(file)).isFile()) return fail("", "catalog items must be regular files: symlinks and folders are refused");
  const bytes = await readFile(file);
  if (!file.endsWith(".json")) return fail("", "catalog items are .json files", bytes);
  if (bytes.length > MAX_ITEM_BYTES) return fail("", `${bytes.length} bytes, over the 256 KiB the hub reads of an item`, bytes);
  const parsed = parseLikeTheHub(bytes);
  if (parsed.error !== undefined) return fail(parsed.field ?? "", parsed.error, bytes);
  const item = parsed.item;
  const expected = expectedFromPath(file);
  const all = await schemas();
  const kind = typeof item?.kind === "string" && SCHEMA_OF_KIND[item.kind] !== undefined ? item.kind : undefined;
  const validate = all[kind === undefined ? "envelope" : SCHEMA_OF_KIND[kind]];
  validate(item);
  const ruled = itemRules(item, expected);
  // A rule says more than the schema about the same field: keep the rule.
  const ruledFields = new Set(ruled.map((e) => e.field));
  const fromSchema = schemaErrors(validate).filter((e) => !ruledFields.has(e.field));
  const errors = [...ruled, ...fromSchema].map((e) => ({ file, ...e }));
  return { bytes, item, errors };
}

export async function validateFile(file, options) {
  return (await checkFile(file, options)).errors;
}

/**
 * Every item in the catalog folders under root, with its bytes, and every error, ids unique across kinds and
 * what identifies a connection type claimed by one type only. A file in a folder outside `folders` is an error.
 */
export async function validateCatalog(root, { folders = OPEN_FOLDERS } = {}) {
  const items = [];
  const errors = [];
  const owners = new Map();
  for (const folder of Object.keys(FOLDERS)) {
    let names = [];
    try {
      names = (await readdir(join(root, folder))).sort();
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    for (const name of names) {
      if (name === ".gitkeep") continue;
      const file = join(root, folder, name);
      if (!folders.includes(folder)) {
        errors.push({ file, field: "", message: `${folder}/ is not accepted yet: it opens with its own plan` });
        continue;
      }
      const checked = await checkFile(file);
      errors.push(...checked.errors);
      if (checked.errors.length > 0) continue;
      const path = `${folder}/${name}`;
      const owner = owners.get(checked.item.id);
      if (owner !== undefined) {
        errors.push({ file, field: "id", message: `id "${checked.item.id}" is already used by ${owner}` });
        continue;
      }
      owners.set(checked.item.id, path);
      items.push({ kind: checked.item.kind, id: checked.item.id, path, bytes: checked.bytes, item: checked.item });
    }
  }
  const refused = identityErrors(items.filter((i) => i.kind === "connection"));
  errors.push(...refused.map(({ item, ...e }) => ({ file: join(root, item.path), ...e })));
  const out = new Set(refused.map((e) => e.item));
  return { items: items.filter((i) => !out.has(i)), errors };
}

/**
 * Each host, alias, package, tracker and action belongs to one connection type, and an alias is never the id of
 * another. A conflict between two items points to both files.
 */
function identityErrors(connections) {
  const owners = new Map(officialClaims().map((c) => [`${c.space}:${c.key}`, { id: c.owner }]));
  const ids = new Set([...OFFICIAL_CONNECTIONS.keys(), ...RESERVED_CONNECTION_IDS, ...connections.map((c) => c.id)]);
  const errors = [];
  for (const item of connections) {
    for (const claim of connectionClaims(item.item)) {
      const key = `${claim.space}:${claim.key}`;
      const owner = owners.get(key);
      if (owner !== undefined && owner.id !== item.id) {
        const where = owner.item === undefined ? "" : ` (${owner.item.path})`;
        errors.push({ item, field: claim.field, message: `${claim.space} "${claim.key}" is already claimed by ${owner.id}${where}` });
        if (owner.item !== undefined) {
          errors.push({ item: owner.item, field: owner.field, message: `${claim.space} "${claim.key}" is also claimed by ${item.id} (${item.path})` });
        }
      } else if (claim.space === "alias" && claim.key !== item.id && ids.has(claim.key)) {
        errors.push({ item, field: claim.field, message: `alias "${claim.key}" is the id of another type` });
      } else if (owner === undefined) {
        owners.set(key, { id: item.id, item, field: claim.field });
      }
    }
  }
  return errors;
}
