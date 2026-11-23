// The rules of a template that a JSON Schema cannot say. The package is the one the hub exports and brings in
// (`automation_package.rs` and `import_package`), and the definition follows the contract of app-core
// (`automation.rs` and `automation/actions.rs`). The hub decides in the end: this checks what it would also refuse or
// lower without a word, and what a public item never carries.
import { hostError, parseUrl } from "./connection-rules.mjs";
import { hiddenText } from "./hidden-text.mjs";

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const field = (...parts) => parts.filter((p) => p !== "").join(".");
const isMarker = (text) => text.includes("{{");

/** The definition versions the hub reads (`SCHEMA_VERSION`); the schema caps it. */
export const SCHEMA_VERSION = 20;
/** Most characters of a step key (`KEY_MAX`). */
const KEY_MAX = 40;
/** The ceilings of automation.rs, with the names it gives them. */
const DESCRIPTION_MAX_BYTES = 4 * 1024;
const PROMPT_MAX_BYTES = 64 * 1024;
const NEEDS_MAX = 32;
const MAX_TURNS_MAX = 200;
const TOOLS_MAX = 32;
const EVERY_MINUTES_MAX = 10080;
const TIMEOUT_MINUTES_MAX = 120;
const FOR_EACH_MAX = 100;
const TOOL_CLASSES = ["internal_write", "external_write"];
const bytes = (text) => Buffer.byteLength(text, "utf8");
const outside = (value, min, max) => value !== undefined && !(Number.isInteger(value) && value >= min && value <= max);

/**
 * The actions the contract knows (`ACTIONS` of actions.rs): what each does to the world, whether the engine runs it
 * (`runs_here`) and whether the contract keeps it behind an approval (`approve_only`).
 */
const ACTIONS = new Map(
  [
    ["pr_comment", "outside", true],
    ["digest.deliver", "local", true],
    ["github.review_comment", "outside", true],
    ["github.checks_wait", "reads", true],
    ["github.review_reply", "outside", true],
    ["github.resolve_thread", "outside", true],
    ["github.react", "outside", true],
    ["tracker.create_issue", "outside", true],
    ["slack.post", "outside", true],
    ["teams.post", "outside", true],
    ["slack.react", "outside", true],
    ["teams.react", "outside", true],
    ["slack.thread-summary", "outside", false],
    ["teams.thread-summary", "outside", true],
    ["http.request", "outside", true],
    ["mcp.call", "by_tool", true],
    ["context.update", "local", false, true],
    ["memory.propose", "local", true, true],
    ["desktop.notify", "local", true],
    ["run.continue", "local", true],
  ].map(([name, effect, runsHere, approveOnly = false]) => [name, { effect, runsHere, approveOnly }]),
);

/** Whether `auto` keeps the action as written (`ActionInfo::stays_inside`); otherwise the hub lowers it to approve. */
const staysInside = (info) => (info.effect === "reads" || info.effect === "local") && !info.approveOnly;

const MODES = ["draft", "approve", "auto", "never"];
const TRIGGER_COMMON = ["kind", "id", "filter", "working_hours", "batch", "ui"];
/** The fields of each trigger kind (`trigger_keys` of automation.rs). */
const TRIGGER_KEYS = {
  manual: [],
  webhook: [],
  schedule: ["every_minutes"],
  cron: ["expression"],
  github_poll: ["on", "repos", "include_drafts", "settle_minutes", "owner", "repo_match", "authorship", "my_review", "every_minutes", "checks_green", "on_labels"],
  github_thread_reply: ["repos", "owner", "repo_match", "include_resolved", "max_replies_per_thread", "max_replies_per_pr", "lookback_minutes", "excerpt_lines", "every_minutes"],
  slack_channel: ["channels", "my_user_id", "max_prs", "every_minutes", "thread_replies"],
  mcp_poll: ["connection", "tool", "args", "dedupe_key", "every_minutes"],
  teams_inbox: ["mentions", "dms", "pr_links", "server", "account", "teams_account", "chats", "channels", "max_prs", "group_prs", "ai_filter", "every_minutes", "channel_threads", "ignore_before", "repeat_window_hours", "discard_closed", "discard_drafts", "discard_own", "meeting_chats", "my_review_include"],
  slack_inbox: ["mentions", "dms", "pr_links", "my_user_id"],
};
const STEP_COMMON = ["kind", "key", "name", "needs", "when", "optional", "ui"];
/** The fields of each step kind (`step_keys` of automation.rs). */
const STEP_KEYS = {
  read: ["source", "params"],
  model: ["agent", "agent_source", "model", "prompt", "output_schema", "max_turns", "tools", "on_transient_failure", "memory", "provider", "timeout_minutes", "requires_servers", "write_tools", "switch_on_limit"],
  logic: ["op", "value", "compare", "against", "cases", "conflict_from", "title"],
  action: ["action", "mode", "target", "params", "pending_policy", "for_each", "notify_when_queued"],
};

/** What belongs to whoever exported, by trigger kind (`PERSONAL_FIELDS` of automation_package.rs): the export strips it. */
const PERSONAL_FIELDS = {
  slack_inbox: ["my_user_id"],
  slack_channel: ["my_user_id", "channels"],
  teams_inbox: ["teams_account", "account", "chats", "channels"],
  github_poll: ["owner", "repo_match"],
  github_thread_reply: ["owner", "repo_match"],
};

/** A query parameter or a param named like a key, a token or a signature (`is_credential_param`). */
function isCredentialName(name) {
  const flat = name.replace(/[_-]/g, "").toLowerCase();
  return ["key", "sig", "auth", "code", "pwd", "sas"].includes(flat) || ["token", "secret", "password", "passwd", "apikey", "signature", "credential", "authorization"].some((w) => flat.includes(w));
}

/** Addresses that are a secret by themselves (`url_is_secret_webhook`): whoever holds one posts to that chat. */
const isSecretWebhook = (text) => ["hooks.slack.com/services/", ".webhook.office.com/", "discord.com/api/webhooks/", "discordapp.com/api/webhooks/"].some((k) => text.toLowerCase().includes(k));

/** Why an `http.request` step carries a credential (`steps_with_credential`), or undefined. */
function httpCredential(params) {
  const url = typeof params.url === "string" ? params.url : "";
  const headers = isObject(params.headers) ? Object.entries(params.headers) : [];
  const header = headers.find(([name, value]) => typeof value === "string" && !isMarker(value) && value !== "" && (isCredentialName(name) || /^(bearer|basic|token) \S/i.test(value)));
  if (header !== undefined) return `the header "${header[0]}" carries a credential: the person who installs puts it in a connection`;
  const authority = (url.split("://")[1] ?? "").split(/[/?#]/)[0];
  if (authority.includes("@")) return "the address carries a login, which is a credential";
  const query = (url.split("?")[1] ?? "").split("#")[0];
  const named = query.split("&").map((pair) => pair.split("=")).find(([name, value = ""]) => isCredentialName(name) && value !== "" && !isMarker(value));
  if (named !== undefined) return `the address carries a credential in "${named[0]}"`;
  if (isSecretWebhook(url)) return "the address is a webhook, which is a credential by itself";
  return undefined;
}

const TOKEN = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16})|-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const URLS = /\bhttps?:\/\/[^\s"'<>()`]+/gi;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const TEAMS_ID = /\b19:[^\s"]+@(?:thread\.[a-z0-9]+|unq\.gbl\.spaces)\b/i;
const SLACK_ID = /^[UWCGDB][A-Z0-9]{8,11}$/;
const SLACK_MENTION = /<[@#!][UWCGDBS][A-Z0-9]{8,11}[|>]/;
/** An address with no scheme: a private IPv4 with or without a port, `localhost`, or a name under an internal suffix. */
const BARE_IP = /(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?![\w.])/g;
const BARE_INTERNAL = /(?<![\w.@-])(?:[a-z0-9-]+\.)+(?:local|internal|localdomain|lan|intranet|corp|home|private)(?::\d+)?(?![\w.-])|\blocalhost(?::\d+)?\b/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/;

/** Why a text identifies a person, an Organization, a conversation or a network, or carries a credential; undefined when it does not. */
function privateText(text) {
  if (TOKEN.test(text)) return "looks like a credential: a credential never goes in a public item";
  if (isSecretWebhook(text)) return "has a webhook address, which is a credential by itself";
  for (const [url] of text.matchAll(URLS)) {
    if (isMarker(url)) continue;
    const parsed = parseUrl(url);
    if (parsed.error === "must not carry a user and password") return "has an address with a login, which is a credential";
    const why = parsed.error === undefined ? hostError(parsed.host) : undefined;
    if (why !== undefined) return `has an internal address (${why}): a public item takes public names only`;
  }
  for (const [bare] of [...text.matchAll(BARE_IP), ...text.matchAll(BARE_INTERNAL)]) {
    const why = hostError(bare.replace(/:\d+$/, ""));
    if (why !== undefined) return `has an internal address (${why}): a public item takes public names only`;
  }
  if (TEAMS_ID.test(text)) return "has the id of a Teams chat or channel, which belongs to whoever exported";
  if ((SLACK_ID.test(text) && /[0-9]/.test(text)) || SLACK_MENTION.test(text)) return "has a Slack id of a person, channel or team, which belongs to whoever exported";
  if (UUID.test(text)) return "has an id in UUID form, the shape of the ids of people, Organizations and records of a hub";
  if (EMAIL.test(text)) return "has an e-mail address, which identifies a person";
  return undefined;
}

/** Every string of the package, at any depth, with its field. */
function strings(value, at) {
  if (typeof value === "string") return [{ at, text: value }];
  if (Array.isArray(value)) return value.flatMap((v, i) => strings(v, field(at, i)));
  if (isObject(value)) return Object.entries(value).flatMap(([k, v]) => strings(v, field(at, k)));
  return [];
}

/** Every param named like a credential with a value written down, at any depth. */
function namedCredentials(value, at) {
  if (Array.isArray(value)) return value.flatMap((v, i) => namedCredentials(v, field(at, i)));
  if (!isObject(value)) return [];
  return Object.entries(value).flatMap(([k, v]) =>
    typeof v === "string" && v !== "" && !isMarker(v) && isCredentialName(k)
      ? [{ field: field(at, k), message: `"${k}" looks like a credential: the person who installs puts it in a connection` }]
      : namedCredentials(v, field(at, k)),
  );
}

/** Every string that a marker turns into an address, at any depth: only http.request checks where it goes when it runs. */
function markerAddresses(value, at, key = "") {
  if (Array.isArray(value)) return value.flatMap((v, i) => markerAddresses(v, field(at, i), key));
  if (isObject(value)) return Object.entries(value).flatMap(([k, v]) => markerAddresses(v, field(at, k), k));
  if (typeof value !== "string" || !isMarker(value)) return [];
  const addressKey = ["url", "uri", "endpoint", "host"].some((s) => key.replace(/[_-]/g, "").toLowerCase().endsWith(s));
  if (!/https?:\/\/\S*\{\{/i.test(value) && !addressKey) return [];
  return [{ field: at, message: "an address filled by a marker could point anywhere when it runs, and only http.request checks where it goes: write the address" }];
}

const unknownFields = (object, allowed, at) => Object.keys(object).filter((k) => !allowed.includes(k)).map((k) => ({ field: field(at, k), message: "unknown field" }));

function triggerErrors(trigger, at) {
  if (!isObject(trigger)) return [];
  const keys = TRIGGER_KEYS[trigger.kind];
  if (keys === undefined) return [{ field: field(at, "kind"), message: `the hub does not know the trigger kind ${JSON.stringify(trigger.kind)}` }];
  const errors = unknownFields(trigger, [...TRIGGER_COMMON, ...keys], at);
  for (const name of PERSONAL_FIELDS[trigger.kind] ?? []) {
    if (Object.hasOwn(trigger, name)) errors.push({ field: field(at, name), message: `belongs to whoever exported: leave it out, for whoever installs to fill` });
  }
  if (Array.isArray(trigger.repos) && trigger.repos.length > 0) {
    errors.push({ field: field(at, "repos"), message: "names repositories of a fixed GitHub owner: leave it out, for whoever installs to pick" });
  }
  errors.push(...namedCredentials(trigger.args, field(at, "args")));
  if (trigger.kind === "mcp_poll") errors.push(...markerAddresses(trigger.args, field(at, "args")));
  if (outside(trigger.every_minutes, 1, EVERY_MINUTES_MAX)) errors.push({ field: field(at, "every_minutes"), message: `use 1 to ${EVERY_MINUTES_MAX} minutes` });
  return errors;
}

function stepErrors(step, at, keys) {
  if (!isObject(step)) return [];
  const allowed = STEP_KEYS[step.kind];
  if (allowed === undefined) return [{ field: field(at, "kind"), message: `the hub does not know the step kind ${JSON.stringify(step.kind)}` }];
  const errors = unknownFields(step, [...STEP_COMMON, ...allowed], at);
  if (typeof step.key !== "string" || step.key.trim() === "" || step.key.length > KEY_MAX) {
    errors.push({ field: field(at, "key"), message: `every step has a key of 1 to ${KEY_MAX} characters` });
  }
  for (const need of Array.isArray(step.needs) ? step.needs : []) {
    if (!keys.has(need) || need === step.key) errors.push({ field: field(at, "needs"), message: `needs "${need}", which is not another step of the definition` });
  }
  if (Array.isArray(step.needs) && step.needs.length > NEEDS_MAX) errors.push({ field: field(at, "needs"), message: `${step.needs.length} needs, over the ${NEEDS_MAX} the hub takes` });
  if (isObject(step.when) && !keys.has(step.when.step)) errors.push({ field: field(at, "when", "step"), message: `"${step.when.step}" is not a step of the definition` });
  if (step.kind === "read" && step.source === "tool") errors.push(...markerAddresses(step.params, field(at, "params")));
  if (step.kind === "model") {
    if (typeof step.prompt === "string" && bytes(step.prompt) > PROMPT_MAX_BYTES) errors.push({ field: field(at, "prompt"), message: `${bytes(step.prompt)} bytes, over the ${PROMPT_MAX_BYTES} bytes the hub takes` });
    if (outside(step.max_turns, 0, MAX_TURNS_MAX)) errors.push({ field: field(at, "max_turns"), message: `use up to ${MAX_TURNS_MAX} turns` });
    if (outside(step.timeout_minutes, 1, TIMEOUT_MINUTES_MAX)) errors.push({ field: field(at, "timeout_minutes"), message: `use 1 to ${TIMEOUT_MINUTES_MAX} minutes` });
    for (const name of ["tools", "write_tools"]) {
      if (Array.isArray(step[name]) && step[name].length > TOOLS_MAX) errors.push({ field: field(at, name), message: `${step[name].length} tools, over the ${TOOLS_MAX} the hub takes` });
    }
    (Array.isArray(step.write_tools) ? step.write_tools : []).forEach((tool, i) => {
      if (!isObject(tool)) return;
      errors.push(...unknownFields(tool, ["name", "class", "mode"], field(at, "write_tools", i)));
      if (!TOOL_CLASSES.includes(tool.class)) errors.push({ field: field(at, "write_tools", i, "class"), message: `must be one of ${TOOL_CLASSES.map((c) => JSON.stringify(c)).join(", ")}` });
    });
    (Array.isArray(step.write_tools) ? step.write_tools : []).forEach((tool, i) => {
      if (tool?.mode === "auto") errors.push({ field: field(at, "write_tools", i, "mode"), message: "a tool that writes comes in mode approve: the hub lowers auto to approve" });
    });
  }
  if (step.kind === "action") {
    const info = ACTIONS.get(step.action);
    const mode = step.mode ?? "approve";
    if (info === undefined) errors.push({ field: field(at, "action"), message: `the hub does not know the action ${JSON.stringify(step.action)}` });
    else if (!info.runsHere) errors.push({ field: field(at, "action"), message: `the engine does not run "${step.action}": the run would be refused before its first step` });
    if (!MODES.includes(mode)) errors.push({ field: field(at, "mode"), message: `must be one of ${MODES.map((m) => JSON.stringify(m)).join(", ")}` });
    else if (mode === "auto" && info !== undefined && !staysInside(info)) {
      errors.push({ field: field(at, "mode"), message: `"${step.action}" writes outside the app: it comes in mode approve, as the hub would lower auto to approve` });
    }
    const params = isObject(step.params) ? step.params : {};
    const http = step.action === "http.request" ? httpCredential(params) : undefined;
    if (http !== undefined) errors.push({ field: field(at, "params"), message: http });
    if ((step.action?.startsWith("teams.") || step.action?.startsWith("slack.") || step.action === "mcp.call") && Object.hasOwn(params, "account")) {
      errors.push({ field: field(at, "params", "account"), message: "the account belongs to whoever exported: leave it out, for whoever installs to fill" });
    }
    if ((step.action?.startsWith("teams.") || step.action?.startsWith("slack.")) && isObject(params.destino) && Object.hasOwn(params.destino, "conversa")) {
      errors.push({ field: field(at, "params", "destino", "conversa"), message: "a fixed conversation belongs to whoever exported: leave it out, for whoever installs to fill" });
    }
    errors.push(...namedCredentials(params, field(at, "params")));
    if (isObject(step.for_each) && outside(step.for_each.max, 1, FOR_EACH_MAX)) errors.push({ field: field(at, "for_each", "max"), message: `use 1 to ${FOR_EACH_MAX} items` });
  }
  return errors;
}

/** Errors as `{ field, message }` for a template already parsed and shaped by its schema. */
export function templateRules(item) {
  const pkg = isObject(item.package) ? item.package : {};
  const automation = isObject(pkg.automation) ? pkg.automation : {};
  const definition = isObject(automation.definition) ? automation.definition : undefined;
  const errors = [];
  if (typeof automation.id === "string" && automation.id !== item.id) {
    errors.push({ field: "package.automation.id", message: `is the id of the item, "${item.id}", or left out: the export writes the id of the automation in the hub that made it` });
  }
  if (definition !== undefined) {
    const at = "package.automation.definition";
    if (typeof definition.description === "string" && bytes(definition.description) > DESCRIPTION_MAX_BYTES) {
      errors.push({ field: field(at, "description"), message: `${bytes(definition.description)} bytes, over the ${DESCRIPTION_MAX_BYTES} bytes the hub takes` });
    }
    if (typeof definition.voice_agent === "string" && definition.voice_agent.trim() !== "") {
      errors.push({ field: field(at, "voice_agent"), message: "the voice is an agent of whoever exported: leave it blank, for whoever installs to choose" });
    }
    (Array.isArray(definition.triggers) ? definition.triggers : []).forEach((t, i) => errors.push(...triggerErrors(t, field(at, "triggers", i))));
    const steps = Array.isArray(definition.steps) ? definition.steps : [];
    const keys = new Set();
    steps.forEach((s, i) => {
      if (isObject(s) && typeof s.key === "string" && keys.has(s.key)) errors.push({ field: field(at, "steps", i, "key"), message: `"${s.key}" is already the key of another step` });
      if (isObject(s) && typeof s.key === "string") keys.add(s.key);
    });
    steps.forEach((s, i) => errors.push(...stepErrors(s, field(at, "steps", i), keys)));
  }
  for (const { at, text } of strings(pkg, "package")) errors.push(...hiddenText(text, at));
  const texts = [...strings(item.name, "name"), ...strings(item.description, "description"), ...strings(item.tags, "tags"), ...strings(pkg, "package")];
  for (const { at, text } of texts) {
    const why = privateText(text);
    if (why !== undefined) errors.push({ field: at, message: why });
  }
  return errors;
}
