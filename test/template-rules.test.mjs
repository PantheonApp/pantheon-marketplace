import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateCatalog, validateFile } from "../scripts/lib/validate.mjs";
import { buildIndex } from "../scripts/lib/build-index.mjs";
import { checkIndex } from "../scripts/lib/check-index.mjs";

/** A small template that the hub takes: a manual trigger, a model step and a local notification. */
export function template() {
  return {
    kind: "template",
    id: "example",
    version: 1,
    name: { en: "Example", "pt-BR": "Exemplo" },
    description: { en: "An example template.", "pt-BR": "Um modelo de exemplo." },
    tags: ["example"],
    package: {
      format: "automation-package",
      version: 1,
      automation: {
        id: "example",
        name: "Example",
        definition: {
          schema_version: 18,
          name: "Example",
          voice_agent: "",
          triggers: [{ kind: "manual" }],
          steps: [
            { key: "summary", name: "Summarize", kind: "model", agent: "writer", prompt: "Summarize the day.", output_schema: { type: "object", required: ["text"], properties: { text: { type: "string" } } } },
            { key: "notify", name: "Notify", kind: "action", action: "desktop.notify", mode: "auto", needs: ["summary"], params: { title: "Example", body: "{{steps.summary.text}}" } },
          ],
        },
      },
      agents: [{ slug: "writer", name: "Writer", when_to_use: "To write summaries.", instructions: "Write short summaries.", model: "haiku", tools: [], kind: "specialist", specialists: [] }],
      requirements: { connections: [], apps: [], servers: [], agents: [], to_fill: [] },
    },
  };
}

async function check(item, name = "example") {
  const catalog = mkdtempSync(join(tmpdir(), "template-"));
  mkdirSync(join(catalog, "templates"));
  const file = join(catalog, "templates", `${name}.json`);
  writeFileSync(file, typeof item === "string" ? item : JSON.stringify(item));
  return validateFile(file);
}

function variant(change) {
  const item = template();
  change(item, item.package.automation.definition);
  return item;
}

const messages = (errors) => errors.map((e) => `${e.field}: ${e.message}`).join("\n");

test("a template with an automation package is accepted in templates/", async () => {
  assert.deepEqual(await check(template()), []);
});

test("templates/ takes items in the catalog, next to the connection types", async () => {
  const catalog = mkdtempSync(join(tmpdir(), "template-"));
  mkdirSync(join(catalog, "templates"));
  writeFileSync(join(catalog, "templates", "example.json"), JSON.stringify(template()));
  const { items, errors } = await validateCatalog(catalog);
  assert.deepEqual(errors, []);
  assert.deepEqual(items.map((i) => `${i.kind}:${i.id}`), ["template:example"]);
});

for (const [what, change, field, pattern] of [
  ["an id other than the file name", (i) => (i.id = "other"), "id", /file name/],
  ["a name without pt-BR", (i) => delete i.name["pt-BR"], "name.pt-BR", /required/],
  ["a description without en", (i) => delete i.description.en, "description.en", /required/],
  ["no package", (i) => delete i.package, "package", /required/],
  ["a manifest, which is the body of a connection type", (i) => (i.manifest = {}), "manifest", /body of a connection type/],
  ["another package format", (i) => (i.package.format = "other-package"), "package.format", /automation-package/],
  ["another package version", (i) => (i.package.version = 2), "package.version", /1/],
  ["a package without a definition", (i) => delete i.package.automation.definition, "package.automation.definition", /required/],
]) {
  test(`a template with ${what} is refused`, async () => {
    const errors = await check(variant(change));
    assert.ok(errors.some((e) => e.field === field && pattern.test(e.message)), messages(errors));
  });
}

const D = "package.automation.definition";
const poll = (extra) => ({ kind: "github_poll", on: "new_head", ...extra });
const post = (params, extra = {}) => ({ key: "post", kind: "action", action: "teams.post", mode: "approve", needs: ["summary"], params: { text: "{{steps.summary.text}}", ...params }, ...extra });
const http = (params) => ({ key: "call", kind: "action", action: "http.request", mode: "approve", needs: ["summary"], params: { method: "POST", url: "https://api.example.com/v1/items", ...params } });

// What a public item never carries: the fields the export of the hub strips (`strip_personal` and `steps_with_credential`
// of automation_package.rs) and what identifies a person, an Organization or a network.
for (const [what, change, field, pattern] of [
  ["a GitHub owner on a poll", (i, d) => d.triggers.push(poll({ owner: "some-org" })), `${D}.triggers.1.owner`, /whoever installs/],
  ["a pattern of repositories on a poll", (i, d) => d.triggers.push(poll({ repo_match: ".*" })), `${D}.triggers.1.repo_match`, /whoever installs/],
  ["a fixed list of repositories", (i, d) => d.triggers.push(poll({ repos: ["some-org/api"] })), `${D}.triggers.1.repos`, /GitHub owner/],
  ["an owner on a thread reply", (i, d) => d.triggers.push({ kind: "github_thread_reply", owner: "some-org" }), `${D}.triggers.1.owner`, /whoever installs/],
  ["the chats of a Teams inbox", (i, d) => d.triggers.push({ kind: "teams_inbox", chats: ["x"] }), `${D}.triggers.1.chats`, /whoever installs/],
  ["the channels of a Teams inbox", (i, d) => d.triggers.push({ kind: "teams_inbox", channels: [{ team_id: "t", channel_id: "c" }] }), `${D}.triggers.1.channels`, /whoever installs/],
  ["the account of a Teams inbox", (i, d) => d.triggers.push({ kind: "teams_inbox", account: "work" }), `${D}.triggers.1.account`, /whoever installs/],
  ["the channels of a Slack channel trigger", (i, d) => d.triggers.push({ kind: "slack_channel", channels: ["C0123ABCD"] }), `${D}.triggers.1.channels`, /whoever installs/],
  ["the Slack user of a Slack inbox", (i, d) => d.triggers.push({ kind: "slack_inbox", my_user_id: "U0123ABCD" }), `${D}.triggers.1.my_user_id`, /whoever installs/],
  ["the account of a Teams action", (i, d) => d.steps.push(post({ account: "work" })), `${D}.steps.2.params.account`, /whoever installs/],
  ["a fixed conversation of a Teams action", (i, d) => d.steps.push(post({ destino: { conversa: "x" } })), `${D}.steps.2.params.destino.conversa`, /whoever installs/],
  ["a credential in a header", (i, d) => d.steps.push(http({ headers: { Authorization: "Bearer abc" } })), `${D}.steps.2.params`, /credential/],
  ["a login in a URL", (i, d) => d.steps.push(http({ url: "https://user:pass@api.example.com/x" })), `${D}.steps.2.params`, /credential/],
  ["a key in a query string", (i, d) => d.steps.push(http({ url: "https://api.example.com/x?api_key=abc" })), `${D}.steps.2.params`, /credential/],
  ["a credential named in the params of a call", (i, d) => d.steps.push({ ...post({}), action: "mcp.call", params: { tool: "x", api_key: "abc" } }), `${D}.steps.2.params.api_key`, /credential/],
  ["a token in a prompt", (i, d) => (d.steps[0].prompt = "Use ghp_abcdefghijklmnopqrstuvwxyz0123456789 to read."), `${D}.steps.0.prompt`, /credential/],
  ["a webhook address in a step", (i, d) => d.steps.push(http({ url: "https://hooks.slack.com/services/T000/B000/XXXX" })), `${D}.steps.2.params`, /webhook/],
  ["a webhook address in a prompt", (i, d) => (d.steps[0].prompt = "Post to https://acme.webhook.office.com/webhookb2/abc"), `${D}.steps.0.prompt`, /webhook/],
  ["an address in a private range", (i, d) => (d.steps[0].prompt = "Read http://10.0.0.5/status first."), `${D}.steps.0.prompt`, /internal address/],
  ["a name of an internal network", (i, d) => (d.steps[0].prompt = "See https://grafana.internal/d/abc"), `${D}.steps.0.prompt`, /internal address/],
  ["this machine", (i, d) => d.steps.push(http({ url: "http://localhost:8080/x" })), `${D}.steps.2.params.url`, /internal address/],
  ["an id in UUID form", (i) => (i.package.agents[0].instructions = "Ask 3f2b8c1e-9a4d-4e7f-8b21-6c0d9e5a7f13 first."), "package.agents.0.instructions", /UUID/],
  ["a Teams chat id", (i, d) => d.steps.push(post({ chat: "19:abcdef0123456789@thread.v2" })), `${D}.steps.2.params.chat`, /Teams/],
  ["a Slack id", (i, d) => d.steps.push(post({ user: "U01ABCDEF2" })), `${D}.steps.2.params.user`, /Slack/],
  ["an e-mail address", (i, d) => (d.steps[0].prompt = "Write to someone@example.com."), `${D}.steps.0.prompt`, /e-mail/],
  ["the id of the automation in the hub that exported it", (i) => (i.package.automation.id = "3f2b8c1e-9a4d-4e7f-8b21-6c0d9e5a7f13"), "package.automation.id", /id of the item/],
  ["a voice agent", (i, d) => (d.voice_agent = "my-voice"), `${D}.voice_agent`, /whoever installs/],
]) {
  test(`a template with ${what} is refused`, async () => {
    const errors = await check(variant(change));
    assert.ok(errors.some((e) => e.field === field && pattern.test(e.message)), messages(errors));
  });
}

// What the hub refuses in the definition (`AutomationSpec::decode_value`, `validate` and the registry of actions of
// app-core), or lowers without a word (`downgrade_auto`).
for (const [what, change, field, pattern] of [
  ["a definition newer than the hub reads", (i, d) => (d.schema_version = 21), `${D}.schema_version`, /20/],
  ["a field the definition does not have", (i, d) => (d.budget = {}), `${D}.budget`, /unknown field/],
  ["a trigger kind the hub does not know", (i, d) => (d.triggers[0].kind = "rss"), `${D}.triggers.0.kind`, /trigger kind/],
  ["a field the trigger does not have", (i, d) => d.triggers.push(poll({ since: "x" })), `${D}.triggers.1.since`, /unknown field/],
  ["a step kind the hub does not know", (i, d) => (d.steps[0].kind = "script"), `${D}.steps.0.kind`, /step kind/],
  ["a field the step does not have", (i, d) => (d.steps[1].input = "summary"), `${D}.steps.1.input`, /unknown field/],
  ["a step without a key", (i, d) => delete d.steps[1].key, `${D}.steps.1.key`, /key/],
  ["two steps with the same key", (i, d) => (d.steps[1].key = "summary"), `${D}.steps.1.key`, /already/],
  ["a step that needs one that is not there", (i, d) => (d.steps[1].needs = ["nothing"]), `${D}.steps.1.needs`, /nothing/],
  ["an action the hub does not know", (i, d) => (d.steps[1].action = "shell.run"), `${D}.steps.1.action`, /does not know/],
  ["an action the engine does not run", (i, d) => d.steps.push({ ...post({}), action: "slack.thread-summary" }), `${D}.steps.2.action`, /does not run/],
  ["an action that writes outside in auto", (i, d) => d.steps.push(post({}, { mode: "auto" })), `${D}.steps.2.mode`, /approve/],
  ["a tool that writes in auto", (i, d) => (d.steps[0].write_tools = [{ name: "github__create_issue", class: "external_write", mode: "auto" }]), `${D}.steps.0.write_tools.0.mode`, /approve/],
  ["a mode the hub does not know", (i, d) => (d.steps[1].mode = "sometimes"), `${D}.steps.1.mode`, /draft/],
]) {
  test(`a template with ${what} is refused`, async () => {
    const errors = await check(variant(change));
    assert.ok(errors.some((e) => e.field === field && pattern.test(e.message)), messages(errors));
  });
}

test("an action that only reads or stays in the app runs in auto, and every action may wait for approval", async () => {
  const wait = { key: "wait", kind: "action", action: "github.checks_wait", mode: "auto", params: {} };
  assert.deepEqual(await check(variant((i, d) => d.steps.push(wait))), []);
  assert.deepEqual(await check(variant((i, d) => d.steps.push(post({})))), []);
});

test("a marker stands for what whoever installs fills, so it is not a credential", async () => {
  assert.deepEqual(await check(variant((i, d) => d.steps.push(http({ url: "https://api.example.com/x?token={{event.token}}" })))), []);
});

test("the index lists a template with its envelope, and the job that signs takes it", async () => {
  const catalog = mkdtempSync(join(tmpdir(), "template-"));
  mkdirSync(join(catalog, "templates"));
  writeFileSync(join(catalog, "templates", "example.json"), JSON.stringify(template()));
  writeFileSync(join(catalog, "retired.json"), "{}");
  const commit = "a".repeat(40);
  const index = await buildIndex(catalog, { commit, committedAt: 1000 });
  const [entry] = JSON.parse(index).items;
  assert.equal(entry.kind, "template");
  assert.equal(entry.path, "templates/example.json");
  assert.deepEqual(entry.name, { en: "Example", "pt-BR": "Exemplo" });
  assert.deepEqual(entry.tags, ["example"]);
  assert.equal(Object.hasOwn(entry, "requires"), false);
  assert.deepEqual(checkIndex({ root: catalog, index: Buffer.from(index), commit, committedAt: 1000, now: 1000, retired: {} }), []);
});

// The ceilings of the contract (`check_ceilings`, `check_limits` and the checks of each step in automation.rs).
const bigText = (bytes) => "a".repeat(bytes);
for (const [what, change, field, pattern] of [
  ["a description over 4 KiB", (i, d) => (d.description = bigText(4 * 1024 + 1)), `${D}.description`, /4096 bytes/],
  ["a prompt over 64 KiB", (i, d) => (d.steps[0].prompt = bigText(64 * 1024 + 1)), `${D}.steps.0.prompt`, /65536 bytes/],
  ["a step with more than 32 needs", (i, d) => (d.steps[1].needs = Array(33).fill("summary")), `${D}.steps.1.needs`, /32/],
  ["max_turns over 200", (i, d) => (d.steps[0].max_turns = 201), `${D}.steps.0.max_turns`, /200/],
  ["more than 32 tools", (i, d) => (d.steps[0].tools = Array.from({ length: 33 }, (_, n) => `github__tool_${n}`)), `${D}.steps.0.tools`, /32/],
  ["more than 32 tools that write", (i, d) => (d.steps[0].write_tools = Array.from({ length: 33 }, (_, n) => ({ name: `github__w${n}`, class: "external_write" }))), `${D}.steps.0.write_tools`, /32/],
  ["a tool that writes without a class the contract knows", (i, d) => (d.steps[0].write_tools = [{ name: "github__create_issue", class: "outside" }]), `${D}.steps.0.write_tools.0.class`, /internal_write/],
  ["a schedule over a week", (i, d) => (d.triggers[0] = { kind: "schedule", every_minutes: 10081 }), `${D}.triggers.0.every_minutes`, /10080/],
  ["a poll every 0 minutes", (i, d) => d.triggers.push({ kind: "github_poll", on: "new_head", every_minutes: 0 }), `${D}.triggers.1.every_minutes`, /10080/],
  ["a model step with a timeout over 120 minutes", (i, d) => (d.steps[0].timeout_minutes = 121), `${D}.steps.0.timeout_minutes`, /120/],
  ["a for_each over 100 items", (i, d) => (d.steps[1].for_each = { over: "{{steps.summary.items}}", max: 101 }), `${D}.steps.1.for_each.max`, /100/],
  ["limits with a field the contract does not have", (i, d) => (d.limits = { per_run_usd: 1 }), `${D}.limits.per_run_usd`, /unknown field/],
  ["a run longer than a day", (i, d) => (d.limits = { max_minutes: 1441 }), `${D}.limits.max_minutes`, /1440/],
  ["a limit on what happens past it that the contract does not know", (i, d) => (d.limits = { on_limit: "stop" }), `${D}.limits.on_limit`, /pause/],
  ["a group without a window", (i, d) => (d.group = { key: "{{event.repo}}", after_run: "cover" }), `${D}.group.window_minutes`, /required/],
  ["a group with a window over a day", (i, d) => (d.group = { key: "{{event.repo}}", window_minutes: 1441, after_run: "cover" }), `${D}.group.window_minutes`, /1440/],
]) {
  test(`a template with ${what} is refused`, async () => {
    const errors = await check(variant(change));
    assert.ok(errors.some((e) => e.field === field && pattern.test(e.message)), messages(errors));
  });
}

// Text that hides or reorders what the person reads, in any string of the template; what identifies a person or a
// network in the envelope too; an address on an internal network written without a scheme; and an address that a
// marker fills where nothing guards where it goes.
for (const [what, change, field, pattern] of [
  ["a bidi control in a prompt", (i, d) => (d.steps[0].prompt = "Summarize‮ the day."), `${D}.steps.0.prompt`, /U\+202E/],
  ["a tag character in the instructions of an agent", (i) => (i.package.agents[0].instructions = "Write\u{E0041}\u{E0042} short summaries."), "package.agents.0.instructions", /U\+E0041/],
  ["a zero width space in a param", (i, d) => (d.steps[1].params.title = "Ex​ample"), `${D}.steps.1.params.title`, /U\+200B/],
  ["a tag character in the name of the envelope", (i) => (i.name.en = "Example\u{E0020}"), "name.en", /U\+E0020/],
  ["an e-mail address in the description of the envelope", (i) => (i.description.en = "Ask someone@example.com."), "description.en", /e-mail/],
  ["an internal address in the tags", (i) => (i.tags = ["intranet-corp", "10.0.0.5"]), "tags.1", /internal address/],
  ["a private address with a port and no scheme", (i, d) => (d.steps[0].prompt = "Read 10.0.0.5:8080 first."), `${D}.steps.0.prompt`, /internal address/],
  ["a name of an internal network with no scheme", (i, d) => (d.steps[0].prompt = "See grafana.corp.local for the graphs."), `${D}.steps.0.prompt`, /internal address/],
  ["an address filled by a marker in a tool read", (i, d) => d.steps.push({ key: "read", kind: "read", source: "tool", params: { connection: "docs", tool: "fetch", args: { url: "https://{{event.host}}/status" } } }), `${D}.steps.2.params.args.url`, /marker/],
  ["an address filled by a marker in the args of a poll", (i, d) => d.triggers.push({ kind: "mcp_poll", connection: "docs", tool: "list", dedupe_key: "id", args: { url: "{{event.base}}/items" } }), `${D}.triggers.1.args.url`, /marker/],
]) {
  test(`a template with ${what} is refused`, async () => {
    const errors = await check(variant(change));
    assert.ok(errors.some((e) => e.field === field && pattern.test(e.message)), messages(errors));
  });
}

test("a version number, a file name and a marker in a prompt are not addresses", async () => {
  assert.deepEqual(await check(variant((i, d) => (d.steps[0].prompt = "Read CLAUDE.md and {{event.repo}} at release 1.2.3, then steps.summary.text."))), []);
});
