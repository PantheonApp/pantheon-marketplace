import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { OFFICIAL_CONNECTIONS, canonicalHost } from "./rules.mjs";
import { validateCatalog } from "./validate.mjs";
import { endpointUrls, parseUrl, rustTrim } from "./connection-rules.mjs";

/** The hub checks only that the format ends in -marketplace-index (catalog.rs, `entries`). */
export const INDEX_FORMAT = "app-marketplace-index";
export const INDEX_VERSION = 1;
const FULL_SHA = /^[0-9a-f]{40}$/;
/** What the hub reads at most (`MAX_ITEMS` and `MAX_INDEX_BYTES` in catalog.rs). */
export const MAX_ENTRIES = 500;
export const MAX_INDEX_BYTES = 2 * 1024 * 1024;

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sorted = (values) => [...new Set(values)].sort(byCodeUnit);

/** Every host the type may talk to, as the hub counts them: the listed ones and the host of each URL, OAuth included. */
function effectiveHosts(manifest) {
  const urls = endpointUrls(manifest, "manifest").map(({ url }) => parseUrl(url).host);
  return sorted([...(manifest.hosts ?? []).map(rustTrim), ...urls].map(canonicalHost));
}

function connectionRequires(manifest) {
  const remote = manifest.servers?.remote;
  return {
    runsOn: [...manifest.runs_on],
    servers: remote?.url !== undefined ? { remote: { url: remote.url } } : {},
    hosts: effectiveHosts(manifest),
    methods: manifest.methods.map((m) => (m.reader === undefined ? { type: m.type } : { type: m.type, reader: m.reader })),
    fields: (manifest.fields ?? []).map((f) => f.key),
    triggers: sorted((manifest.triggers ?? []).filter((t) => typeof t === "string")),
    actions: sorted((manifest.actions ?? []).filter((t) => typeof t === "string")),
  };
}

/** retired.json of the catalog, keys sorted; an empty one when there is none. */
function readRetired(root) {
  let value;
  try {
    value = JSON.parse(readFileSync(join(root, "retired.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
  return Object.fromEntries(Object.keys(value).sort(byCodeUnit).map((k) => [k, value[k]]));
}

/**
 * The bytes of index.json for the catalog under root at the given commit. `committedAt` is the
 * commit time in seconds: it orders indexes without a date that changes on every build, so the
 * same catalog and commit give the same bytes.
 */
export async function buildIndex(root, { commit, committedAt }) {
  if (typeof commit !== "string" || !FULL_SHA.test(commit)) throw new Error(`commit must be a full 40-character sha, found "${commit}"`);
  if (!Number.isSafeInteger(committedAt) || committedAt < 0) throw new Error(`committedAt must be the commit time in seconds, found "${committedAt}"`);
  const { items, errors } = await validateCatalog(root);
  if (errors.length > 0) {
    throw new Error(`the catalog is invalid:\n${errors.map((e) => `${relative(root, e.file)}: ${e.field}: ${e.message}`).join("\n")}`);
  }
  const entries = items
    .sort((a, b) => byCodeUnit(a.id, b.id))
    .map(({ kind, id, path, bytes, item }) => ({
      kind,
      id,
      version: item.version,
      // Only when declared: an item without it keeps the bytes it had in the index.
      ...(item.minAppVersion !== undefined ? { minAppVersion: item.minAppVersion } : {}),
      path,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      name: item.name,
      description: item.description,
      tags: item.tags ?? [],
      // What a connection type needs; a template says it in its package, which the hub reads from the item file.
      ...(kind === "connection" ? { requires: connectionRequires(item.manifest) } : {}),
      // The mark comes from the maintainers' list, never from the item file; the hub trusts it because the index is signed.
      ...(OFFICIAL_CONNECTIONS.has(id) ? { official: true } : {}),
    }));
  // The ids that left the catalog, signed with the rest so the next index can be checked against them. The hub reads
  // only the keys it knows of the index, so this one does not change what it accepts.
  const retired = readRetired(root);
  const index = { format: INDEX_FORMAT, version: INDEX_VERSION, commit, committedAt, items: entries, retired };
  if (entries.length > MAX_ENTRIES) throw new Error(`${entries.length} entries, over the ${MAX_ENTRIES} the hub reads`);
  const bytes = `${JSON.stringify(index, null, 2)}\n`;
  if (Buffer.byteLength(bytes) > MAX_INDEX_BYTES) throw new Error("the index is over the 2 MiB the hub reads");
  return bytes;
}
