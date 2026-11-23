// The rules a JSON Schema cannot say. A connection type follows the hub (connection-rules.mjs); a template or a
// package follows the locum-pacote format the hub converts, and nothing in an item is code that runs.
import { readFileSync } from "node:fs";
import { connectionRules } from "./connection-rules.mjs";

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

/** Annotations the schema keeps on each trigger kind and on the batch, read by the rules and the index. */
export const TRIGGER_ANNOTATIONS = ["x-reads-connection", "x-reads-server", "x-no-event", "x-person-chooses", "x-required-to-run", "x-pending-choice", "x-omitted-code", "x-held-by", "x-catch-all", "x-event-fields"];

const templateSchema = JSON.parse(readFileSync(new URL("../../schemas/template.schema.json", import.meta.url), "utf8"));

/** What the run of a batch reads in `{{event.*}}`, from `$defs.batch` in the template schema. */
const BATCH_EVENT_FIELDS = templateSchema.$defs.batch["x-event-fields"];

/** What each trigger kind reads and what the person picks on install, from `$defs.trigger` in the template schema. */
export const TRIGGER_KINDS = new Map(
  templateSchema.$defs.trigger.allOf.map((branch) => [
    branch.if.properties.kind.const,
    {
      connection: branch.then["x-reads-connection"],
      serverField: branch.then["x-reads-server"],
      noEvent: branch.then["x-no-event"] === true,
      takesBatch: branch.then.properties.batch !== undefined,
      chooses: branch.then["x-person-chooses"],
      requiredToRun: branch.then["x-required-to-run"] ?? [],
      pendingChoice: branch.then["x-pending-choice"] ?? [],
      catchAll: branch.then["x-catch-all"] ?? {},
      omittedCode: branch.then["x-omitted-code"] ?? {},
      heldBy: branch.then["x-held-by"] ?? {},
    },
  ]),
);

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const field = (...parts) => parts.join(".");

/**
 * What hides or reorders the text the person reads, the characters the app refuses in a connection type: bidi controls,
 * a zero width space or word joiner on its own, and control characters other than \n and \t. ZWJ, ZWNJ and the soft
 * hyphen compose emoji and words, and pass.
 */
const HIDES_TEXT = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069\u200B\u2060\uFEFF\u0000-\u0008\u000B-\u001F\u007F-\u009F]/u;

function hiddenText(value, at) {
  const found = typeof value === "string" ? HIDES_TEXT.exec(value) : null;
  if (found === null) return [];
  const code = found[0].codePointAt(0).toString(16).toUpperCase().padStart(4, "0");
  return [{ field: at, message: `has the invisible or control character U+${code}, which hides or reorders what the person reads` }];
}

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
  if ((item.kind === "template" || item.kind === "package") && isObject(item.package)) {
    errors.push(...packageRules(item.package, item.kind));
  }
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

/**
 * What the import checks beyond the schema: agent ids, the agent a step uses, step keys and needs, and version 4 features.
 * Also what the install needs: a template has a trigger, and what each trigger reads is in the requirements.
 */
function packageRules(pkg, kind) {
  const errors = [];
  const agents = Array.isArray(pkg.agents) ? pkg.agents : [];
  const agentIds = new Set();
  agents.forEach((agent, i) => {
    if (!isObject(agent)) return;
    if (agentIds.has(agent.id)) errors.push({ field: field("package.agents", i, "id"), message: `agent "${agent.id}" appears twice` });
    agentIds.add(agent.id);
  });
  const steps = Array.isArray(pkg.automacao?.spec?.steps) ? pkg.automacao.spec.steps : [];
  const keys = new Set();
  steps.forEach((step, i) => {
    if (!isObject(step)) return;
    if (keys.has(step.key)) errors.push({ field: field("package.automacao.spec.steps", i, "key"), message: `step key "${step.key}" appears twice` });
    keys.add(step.key);
  });
  steps.forEach((step, i) => {
    if (!isObject(step)) return;
    const at = field("package.automacao.spec.steps", i);
    if (step.type === "model" && step.profile !== undefined && !agentIds.has(step.profile)) {
      errors.push({ field: field(at, "profile"), message: `step "${step.key}" uses agent "${step.profile}", which is not in the package` });
    }
    (Array.isArray(step.needs) ? step.needs : []).forEach((need, j) => {
      if (!keys.has(need)) errors.push({ field: field(at, "needs", j), message: `step "${step.key}" needs "${need}", which is not a step` });
    });
    if (typeof pkg.versao === "number" && pkg.versao < 4 && step.type === "model" && step.memory !== undefined) {
      errors.push({ field: field(at, "memory"), message: "memory in a step needs version 4 of the package format" });
    }
  });
  const cycle = needsCycle(steps);
  if (cycle !== undefined) errors.push({ field: "package.automacao.spec.steps", message: `the steps needs form a cycle: ${cycle.join(" -> ")}` });
  if (typeof pkg.versao === "number" && pkg.versao < 4 && pkg.notas !== undefined) {
    errors.push({ field: "package.notas", message: "memory notes need version 4 of the package format" });
  }
  errors.push(...triggerRules(pkg, kind));
  return errors;
}

function triggerRules(pkg, kind) {
  const errors = [];
  const triggers = Array.isArray(pkg.automacao?.gatilhos) ? pkg.automacao.gatilhos : [];
  if (kind === "template" && triggers.length === 0) {
    errors.push({ field: "package.automacao.gatilhos", message: "a template needs at least one trigger, assembled and visible, for the install to fill in" });
  }
  const names = (list, key) => new Set((Array.isArray(list) ? list : []).filter(isObject).map((entry) => entry[key]));
  const connections = names(pkg.requisitos?.conexoes, "id");
  const servers = names(pkg.requisitos?.servidores, "nome");
  triggers.forEach((trigger, i) => {
    const reads = isObject(trigger) ? TRIGGER_KINDS.get(trigger.kind) : undefined;
    if (reads === undefined) return;
    const at = field("package.automacao.gatilhos", i);
    if (trigger.batch !== undefined && !reads.takesBatch) {
      errors.push({ field: field(at, "batch"), message: `a "${trigger.kind}" trigger has no filter, so it has no batch either: the app joins only the events that pass a trigger filter` });
    } else if (trigger.batch !== undefined) {
      // A template holds a trigger that waits for the person to choose; a package does not, so each field it needs counts.
      const held = kind === "template" ? reads.pendingChoice : [];
      const waiting = reads.requiredToRun.filter((f) => trigger[f] === undefined && !held.includes(f));
      if (waiting.length > 0) {
        errors.push({ field: field(at, "batch"), message: `a "${trigger.kind}" trigger without ${waiting.join(", ")} is not created on install: the app drops the whole trigger, batch included, until the person chooses, and the one they make by hand has no batch` });
      }
    }
    if (reads.takesBatch && Array.isArray(trigger.filter)) errors.push(...filterRules(trigger.filter, field(at, "filter")));
    if (reads.connection !== undefined && !connections.has(reads.connection)) {
      errors.push({ field: field(at, "kind"), message: `a "${trigger.kind}" trigger reads the "${reads.connection}" connection, which is not in package.requisitos.conexoes` });
    }
    const server = reads.serverField === undefined ? undefined : trigger[reads.serverField];
    if (typeof server === "string" && !servers.has(server)) {
      errors.push({ field: field(at, reads.serverField), message: `a "${trigger.kind}" trigger reads the server "${server}", which is not in package.requisitos.servidores` });
    }
    if (kind === "template") errors.push(...leftOutRules(pkg, trigger, i, reads));
  });
  const silent = [...new Set(triggers.filter((t) => isObject(t) && TRIGGER_KINDS.get(t.kind)?.noEvent).map((t) => `"${t.kind}"`))];
  if (kind === "template" && silent.length > 0) {
    // A run from any of these has no event, and the app renders the marker as nothing.
    const steps = Array.isArray(pkg.automacao?.spec?.steps) ? pkg.automacao.spec.steps : [];
    steps.forEach((step, i) => {
      for (const { path, marker } of eventReads(step, field("package.automacao.spec.steps", i))) {
        errors.push({ field: path, message: `reads ${marker}, but ${silent.join(", ")} ${silent.length === 1 ? "brings" : "bring"} no event: fetch with the step tools instead` });
      }
    });
  }
  const batched = [...new Set(triggers.filter((t) => isObject(t) && t.batch !== undefined && TRIGGER_KINDS.get(t.kind)?.takesBatch).map((t) => `"${t.kind}"`))];
  if (kind === "template" && batched.length > 0) {
    // A run of each reads a different event: the list of the batch or a single one.
    triggers.forEach((t, i) => {
      const reads = isObject(t) ? TRIGGER_KINDS.get(t.kind) : undefined;
      if (reads === undefined || reads.noEvent || t.batch !== undefined) return;
      const fix = reads.takesBatch ? "Batch all the triggers that bring an event, or none" : `A "${t.kind}" trigger takes no batch: remove it, or batch none`;
      errors.push({ field: field("package.automacao.gatilhos", i, "batch"), message: `a "${t.kind}" trigger brings a single event, and ${batched.join(", ")} ${batched.length === 1 ? "has" : "have"} batch: a run of each reads a different event, and no prompt serves both. ${fix}` });
    });
  }
  if (kind === "template" && batched.length > 0) {
    // The run of a batch gets the batch event, and a field of a single event renders as nothing.
    const single = (marker) => marker.split(".").length > 1 && !BATCH_EVENT_FIELDS.includes(marker.split(".")[1]);
    const steps = Array.isArray(pkg.automacao?.spec?.steps) ? pkg.automacao.spec.steps : [];
    steps.forEach((step, i) => {
      for (const { path, marker } of eventReads(step, field("package.automacao.spec.steps", i), single)) {
        errors.push({ field: path, message: `reads ${marker}, but ${batched.join(", ")} ${batched.length === 1 ? "has" : "have"} batch, and the batch event brings only ${BATCH_EVENT_FIELDS.join(", ")}: read each event inside {{event.items}}` });
      }
    });
  }
  return errors;
}

/** What the schema cannot say about a filter condition. */
function filterRules(filter, at) {
  const errors = [];
  filter.forEach((condition, j) => {
    const against = isObject(condition) ? condition.against : undefined;
    if (typeof against !== "string") return;
    const where = field(at, j, "against");
    // The limit is in UTF-16 units; the schema counts code points (ajv).
    if (against.length > 500) errors.push({ field: where, message: `${against.length} UTF-16 units, over the 500 the app takes` });
    const foreign = [...against.matchAll(/\{\{[^}]*\}\}/g)].map((m) => m[0]).find((m) => !/^\{\{\s*event\.[\w-]+(?:\.[\w-]+)*\s*\}\}$/.test(m));
    if (foreign !== undefined) {
      errors.push({ field: where, message: `${foreign}: against takes only event markers, like {{event.author.login}}; steps, memory and the others do not exist yet when the filter runs` });
    } else if (condition.compare === "matches" && !against.includes("{{") && !validRegex(against)) {
      errors.push({ field: where, message: "not a valid regular expression" });
    }
  });
  return errors;
}

function validRegex(value) {
  try {
    new RegExp(value, "i");
    return true;
  } catch {
    return false;
  }
}

/** A template leaves what the person chooses out in the way its kind says, so the install asks for it. */
function leftOutRules(pkg, trigger, i, reads) {
  const errors = [];
  const at = field("package.automacao.gatilhos", i);
  const omitted = (Array.isArray(pkg.omitidos) ? pkg.omitidos : []).filter((o) => isObject(o) && (o.onde === `gatilho:${i}` || o.onde === trigger.kind));
  for (const f of reads.chooses) {
    const value = trigger[f];
    const catchAll = value !== undefined && (reads.catchAll[f] ?? []).includes(value);
    if (value !== undefined && !catchAll) continue;
    if (catchAll && reads.requiredToRun.includes(f)) {
      errors.push({ field: field(at, f), message: `${f} "${value}" matches everything: leave it out so the person chooses on install` });
    }
    const code = reads.omittedCode[f];
    // A code that names its fields (argumentos) needs the field in params; the others reach the field through the app marking.
    if (code !== undefined && !omitted.some((o) => o.codigo === code && (Array.isArray(o.params) ? o.params.includes(f) : code !== "argumentos"))) {
      const params = code === "argumentos" ? `, "params": ["${f}"]` : "";
      errors.push({ field: field(at, f), message: `the person chooses ${f} on install: add { "codigo": "${code}", "onde": "gatilho:${i}"${params} } to package.omitidos` });
    }
    const holder = reads.heldBy[f];
    if (holder !== undefined && trigger[holder] === undefined) {
      errors.push({ field: field(at, holder), message: `the person chooses the ${f} on install: set ${holder} so the app holds the trigger until they do` });
    }
  }
  return errors;
}

/** What a run renders with the event, by step type; name, key and the rest are not. */
const RENDERED = { model: ["prompt"], action: ["params"], logic: ["value", "against", "title"] };
const EVENT_MARKER = /\{\{\s*(event(?:\.[\w.]+)?)\s*\}\}/g;

/** Where a step reads the event, with the first marker of each field that `counts`, as the app names it. */
function eventReads(step, at, counts = () => true) {
  if (!isObject(step)) return [];
  return (RENDERED[step.type] ?? []).flatMap((key) => markers(step[key], field(at, key), counts));
}

function markers(value, path, counts) {
  if (typeof value === "string") {
    const found = [...value.matchAll(EVENT_MARKER)].map((m) => m[1]).find(counts);
    return found === undefined ? [] : [{ path, marker: `{{${found}}}` }];
  }
  if (!isObject(value) && !Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([key, child]) => markers(child, field(path, key), counts));
}

/** The first cycle in the needs between steps, as a list of keys that starts and ends on the same step. */
function needsCycle(steps) {
  const needs = new Map();
  for (const step of steps) {
    if (isObject(step) && typeof step.key === "string") needs.set(step.key, Array.isArray(step.needs) ? step.needs : []);
  }
  const state = new Map();
  const path = [];
  const visit = (key) => {
    if (state.get(key) === "done" || !needs.has(key)) return undefined;
    if (state.get(key) === "open") return [...path.slice(path.indexOf(key)), key];
    state.set(key, "open");
    path.push(key);
    for (const need of needs.get(key)) {
      const found = visit(need);
      if (found !== undefined) return found;
    }
    path.pop();
    state.set(key, "done");
    return undefined;
  };
  for (const key of needs.keys()) {
    const found = visit(key);
    if (found !== undefined) return found;
  }
  return undefined;
}
