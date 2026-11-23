// The rules a JSON Schema cannot say. A connection type follows the hub (connection-rules.mjs), a template too
// (template-rules.mjs), and nothing in an item is code that runs.
import { readFileSync } from "node:fs";
import { connectionRules } from "./connection-rules.mjs";
import { hiddenText } from "./hidden-text.mjs";
import { templateRules } from "./template-rules.mjs";

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const officialList = readJson("./official-connections.json");

/** Ids nobody publishes. */
export const RESERVED_CONNECTION_IDS = new Set(officialList.reserved);

/**
 * The official connection types, with the hosts and trackers that identify them. Only the maintainers publish them:
 * CODEOWNERS covers their files, and no other type may claim what identifies them.
 */
export const OFFICIAL_CONNECTIONS = new Map(Object.entries(officialList.official));

/** A display name as the app compares it with the official ones: without accents or format characters, in lowercase. */
const normalizedName = (name) => name.normalize("NFKC").normalize("NFD").replace(/[\p{M}\p{Cf}]/gu, "").toLowerCase().trim();

/** The display names of the official types, which no other type may take. */
const OFFICIAL_NAMES = new Map(
  Object.entries(officialList.official).flatMap(([id, o]) =>
    (o.names ?? []).map((name) => [normalizedName(name), id]),
  ),
);

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const field = (...parts) => parts.join(".");

/** The same, for each language of a `{ en, pt-BR }` text. */
function hiddenLocalized(value, at) {
  return isObject(value) ? Object.entries(value).flatMap(([language, text]) => hiddenText(text, field(at, language))) : [];
}

/** Errors as `{ field, message }`, for an item already parsed. `expected` holds what the file path says. */
export function itemRules(item, expected) {
  const errors = [];
  if (!isObject(item)) return errors;
  errors.push(...hiddenLocalized(item.name, "name"), ...hiddenLocalized(item.description, "description"));
  if (Object.hasOwn(item, "official")) {
    errors.push({ field: "official", message: "an item does not declare official: the index marks it from scripts/lib/official-connections.json, which only the maintainers change" });
  }
  if (typeof item.id === "string" && item.id !== expected.id) {
    errors.push({ field: "id", message: `id must match the file name: expected "${expected.id}", found "${item.id}"` });
  }
  if (expected.kind !== undefined && typeof item.kind === "string" && item.kind !== expected.kind) {
    errors.push({ field: "kind", message: `a "${item.kind}" item does not belong in ${expected.folder}/` });
  }
  if (item.kind === "connection") {
    if (RESERVED_CONNECTION_IDS.has(item.id)) {
      errors.push({ field: "id", message: `"${item.id}" is reserved and cannot be published` });
    }
    if (isObject(item.name)) {
      for (const [language, name] of Object.entries(item.name)) {
        const official = typeof name === "string" ? OFFICIAL_NAMES.get(normalizedName(name)) : undefined;
        if (official !== undefined && official !== item.id) {
          errors.push({ field: field("name", language), message: `"${name}" is the name of the official type "${official}"` });
        }
      }
    }
    errors.push(...hiddenInManifest(item.manifest, "manifest"), ...connectionRules(item));
  }
  if (item.kind === "template") errors.push(...templateRules(item));
  return errors;
}

/** Hidden text in every label and description the manifest shows. */
function hiddenInManifest(value, at) {
  if (Array.isArray(value)) return value.flatMap((v, i) => hiddenInManifest(v, field(at, i)));
  if (!isObject(value)) return [];
  return Object.entries(value).flatMap(([k, v]) => (k === "label" || k === "description" ? hiddenLocalized(v, field(at, k)) : hiddenInManifest(v, field(at, k))));
}

/** The host as the hub compares it: lowercase ASCII (punycode), without a trailing dot. */
export function canonicalHost(host) {
  return new URL(`https://${host}/`).hostname.replace(/\.$/, "");
}

/**
 * What identifies each connection type in the catalog: the host of its remote server, its hosts, trackers and
 * actions. Each one belongs to one type, so a server never matches two. The OAuth hosts are left out: two types of
 * the same provider may share them.
 */
export function connectionClaims(item) {
  const m = isObject(item.manifest) ? item.manifest : {};
  const list = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === "string") : []);
  const claims = [];
  const url = m.servers?.remote?.url;
  if (typeof url === "string" && URL.canParse(url)) claims.push({ space: "host", key: canonicalHost(new URL(url).hostname), field: "manifest.servers.remote.url" });
  for (const host of list(m.hosts)) if (URL.canParse(`https://${host}/`)) claims.push({ space: "host", key: canonicalHost(host), field: "manifest.hosts" });
  for (const tracker of list(m.trackers)) claims.push({ space: "tracker", key: tracker, field: "manifest.trackers" });
  for (const action of list(m.actions)) claims.push({ space: "action", key: action, field: "manifest.actions" });
  return claims;
}

/** The claims of the official types, from the list, for a catalog that has not published them yet. */
export function officialClaims() {
  return [...OFFICIAL_CONNECTIONS].flatMap(([id, o]) =>
    connectionClaims({ manifest: { hosts: o.hosts, trackers: o.trackers } }).map((c) => ({ ...c, owner: id })),
  );
}
