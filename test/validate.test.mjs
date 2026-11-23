import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertSourceText, validateCatalog, validateFile } from "../scripts/lib/validate.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixture = (path) => join(root, "test", "fixtures", path);

function fieldsOf(errors) {
  return errors.map((e) => e.field);
}

test("the catalog in the repository is valid: the connection types, and no template or package yet", async () => {
  const { items, errors } = await validateCatalog(root);
  assert.deepEqual(errors, []);
  assert.deepEqual(items.map((i) => `${i.kind}:${i.id}`), ["connection:github"]);
});

const bad = [
  ["templates/unknown-agent.json", "package.automacao.spec.steps.0.profile", /ghost/],
  ["templates/wrong-folder.json", "kind", /templates/],
  ["templates/unknown-fields.json", "package.automacao.spec.steps.0.retries", /unknown field/],
  ["templates/unknown-fields.json", "package.automacao.gatilhos.0.channels", /unknown field/],
  ["templates/unknown-fields.json", "package.agents.0.toolsets", /unknown field/],
  ["templates/needs-cycle.json", "package.automacao.spec.steps", /cycle.*write.*post|cycle.*post.*write/],
];

for (const [path, field, message] of bad) {
  test(`rejects ${path} at ${field}`, async () => {
    const errors = await validateFile(fixture(path));
    const hit = errors.find((e) => e.field === field);
    assert.ok(hit, `expected an error at ${field}, got ${JSON.stringify(fieldsOf(errors))}`);
    assert.match(hit.message, message);
    assert.ok(hit.file.endsWith(path));
  });
}

test("the CLI with no arguments validates the whole catalog and exits zero", () => {
  const env = { ...process.env, MARKETPLACE_FORBIDDEN_TERMS: join(tmpdir(), "no-such-terms-file") };
  const run = spawnSync(process.execPath, ["scripts/validate.mjs"], { cwd: root, encoding: "utf8", env });
  assert.equal(run.status, 0, run.stderr);
});

function tempCatalog(folder) {
  const catalog = mkdtempSync(join(tmpdir(), "catalog-"));
  mkdirSync(join(catalog, folder));
  return catalog;
}

test("a file in templates/ or packages/ is refused until they have their plan, even a valid one", async () => {
  for (const folder of ["templates", "packages"]) {
    const catalog = tempCatalog(folder);
    const item = JSON.parse(readFileSync(fixture("templates/slack-reply.json"), "utf8"));
    if (folder === "packages") item.kind = "package";
    writeFileSync(join(catalog, folder, "slack-reply.json"), JSON.stringify(item));
    writeFileSync(join(catalog, folder, ".gitkeep"), "");
    const { items, errors } = await validateCatalog(catalog);
    assert.deepEqual(items, [], folder);
    assert.equal(errors.length, 1, JSON.stringify(errors));
    assert.match(errors[0].message, /not accepted yet/);
  }
});

test("a symlink in the catalog is refused, even when it points to a valid item", async () => {
  const catalog = tempCatalog("connections");
  symlinkSync(join(root, "connections/github.json"), join(catalog, "connections/github.json"));
  const { items, errors } = await validateCatalog(catalog);
  assert.deepEqual(items, []);
  assert.match(errors[0].message, /regular file/);
});

/** A copy of a template fixture with a change, written to a temporary catalog folder. */
function variant(change, folder = "templates", from = "slack-reply") {
  const item = JSON.parse(readFileSync(fixture(`templates/${from}.json`), "utf8"));
  change(item);
  const file = join(tempCatalog(folder), folder, `${item.id}.json`);
  writeFileSync(file, JSON.stringify(item));
  return file;
}

test("a template without a trigger fails at the trigger list", async () => {
  const errors = await validateFile(variant((item) => (item.package.automacao.gatilhos = [])));
  const hit = errors.find((e) => e.field === "package.automacao.gatilhos");
  assert.ok(hit, JSON.stringify(fieldsOf(errors)));
  assert.match(hit.message, /at least one trigger/);
});

test("a package may come without a trigger", async () => {
  const file = variant((item) => {
    item.kind = "package";
    item.package.automacao.gatilhos = [];
  }, "packages");
  assert.deepEqual(await validateFile(file), []);
});

test("a trigger that reads a connection missing from the requirements fails at its kind", async () => {
  const errors = await validateFile(
    variant((item) => {
      item.package.automacao.gatilhos = [{ kind: "poll", source: "github" }];
      item.package.requisitos.conexoes = [{ id: "slack", nome: "Slack" }];
    }),
  );
  const hit = errors.find((e) => e.field === "package.automacao.gatilhos.0.kind");
  assert.ok(hit, JSON.stringify(fieldsOf(errors)));
  assert.match(hit.message, /"poll" trigger reads the "github" connection/);
});

test("an mcp-poll trigger whose server is missing from the requirements fails at its server", async () => {
  const errors = await validateFile(
    variant((item) => {
      item.package.automacao.gatilhos.push({ kind: "mcp-poll", server: "tickets", tool: "list_open" });
      item.package.requisitos.servidores = [];
    }),
  );
  const hit = errors.find((e) => e.field === "package.automacao.gatilhos.1.server");
  assert.ok(hit, JSON.stringify(fieldsOf(errors)));
  assert.match(hit.message, /server "tickets"/);
});

test("a trigger whose connection and server are in the requirements passes", async () => {
  const file = variant((item) => {
    item.package.automacao.gatilhos = [{ kind: "mcp-poll", server: "tickets", tool: "list_open" }];
    item.package.requisitos.conexoes = [];
    item.package.requisitos.servidores = [{ nome: "tickets" }];
  });
  assert.deepEqual(await validateFile(file), []);
});

async function errorAt(file, field, message = /./) {
  const errors = await validateFile(file);
  const hit = errors.find((e) => e.field === field && message.test(e.message));
  assert.ok(hit, `expected an error at ${field}, got ${JSON.stringify(fieldsOf(errors))}`);
  return hit;
}

test("a template that reads the event and only has clock triggers fails at the step that reads it", async () => {
  const file = variant((item) => (item.package.automacao.gatilhos = [{ kind: "cron", expression: "0 9 * * 1-5" }]));
  const hit = await errorAt(file, "package.automacao.spec.steps.0.prompt");
  assert.match(hit.message, /reads \{\{event\.channel\}\}/);
  assert.match(hit.message, /"cron" brings no event/);
});

const reading = (text) => (item) => {
  item.package.automacao.gatilhos = [{ kind: "cron", expression: "0 9 * * 1-5" }];
  item.package.automacao.spec.steps[0].prompt = `Resumo do dia.\n${text}`;
};

test("the event read with spaces inside the braces counts", async () => {
  const hit = await errorAt(variant(reading("{{ event.text }}")), "package.automacao.spec.steps.0.prompt");
  assert.match(hit.message, /reads \{\{event\.text\}\}/);
});

test("the whole event read counts", async () => {
  const hit = await errorAt(variant(reading("{{event}}")), "package.automacao.spec.steps.0.prompt");
  assert.match(hit.message, /reads \{\{event\}\}/);
});

test("a template with a trigger that brings an event and one that does not fails when it reads the event", async () => {
  const file = variant((item) => item.package.automacao.gatilhos.push({ kind: "cron", expression: "0 9 * * 1-5" }));
  const hit = await errorAt(file, "package.automacao.spec.steps.0.prompt");
  assert.match(hit.message, /"cron" brings no event/);
});

test("a webhook trigger brings no event, and a manual one does", async () => {
  const webhook = variant((item) => {
    item.package.automacao.gatilhos = [{ kind: "webhook" }];
    item.package.omitidos = [{ codigo: "argumentos", onde: "gatilho:0", params: ["path"] }];
  });
  assert.match((await errorAt(webhook, "package.automacao.spec.steps.0.prompt")).message, /"webhook" brings no event/);
  const manual = variant((item) => (item.package.automacao.gatilhos = [{ kind: "manual" }]));
  assert.deepEqual(await validateFile(manual), []);
});

test("the event in fields the app does not render, like the name, does not count", async () => {
  const file = variant((item) => {
    reading("sem evento")(item);
    item.package.automacao.spec.steps[0].name = "Responder {{event.author}}";
    item.package.automacao.spec.steps[1].params = {};
  });
  assert.deepEqual(await validateFile(file), []);
});

test("a webhook trigger without its path and without the omitted entry fails at the path", async () => {
  const file = variant((item) => item.package.automacao.gatilhos.push({ kind: "webhook" }));
  const hit = await errorAt(file, "package.automacao.gatilhos.1.path");
  assert.match(hit.message, /"codigo": "argumentos", "onde": "gatilho:1", "params": \["path"\]/);
});

test("a repository expression that matches everything counts as not chosen", async () => {
  const thread = variant((item) => {
    item.package.automacao.gatilhos[0].repoMatch = ".*";
    item.package.omitidos = item.package.omitidos.filter((o) => o.codigo !== "argumentos");
  }, "templates", "pr-thread-reply");
  assert.match((await errorAt(thread, "package.automacao.gatilhos.0.repoMatch")).message, /"argumentos"/);
  const poll = variant((item) => (item.package.automacao.gatilhos[0].repoMatch = "^.*$"), "templates", "pr-review");
  assert.match((await errorAt(poll, "package.automacao.gatilhos.0.repoMatch")).message, /matches every repository|leave .* out/);
});

test("a template that reads the event passes when every trigger brings one", async () => {
  const file = variant((item) => item.package.automacao.gatilhos.push({ kind: "manual" }));
  assert.deepEqual(await validateFile(file), []);
});

test("a template that leaves the GitHub owner out without the omitted entry fails at the owner", async () => {
  const file = variant((item) => (item.package.omitidos = []), "templates", "pr-review");
  const hit = await errorAt(file, "package.automacao.gatilhos.0.owner");
  assert.match(hit.message, /"dono-do-github"/);
});

test("a template that leaves the repositories of a thread reply trigger out without the omitted entry fails at repoMatch", async () => {
  const file = variant((item) => (item.package.omitidos = item.package.omitidos.filter((o) => o.codigo !== "argumentos")), "templates", "pr-thread-reply");
  const hit = await errorAt(file, "package.automacao.gatilhos.0.repoMatch");
  assert.match(hit.message, /"argumentos"/);
});

test("a template with a Teams inbox trigger that does not hold the chats for the person fails at chatsRestritos", async () => {
  const file = variant((item) => delete item.package.automacao.gatilhos[0].chatsRestritos, "templates", "teams-reply");
  const hit = await errorAt(file, "package.automacao.gatilhos.0.chatsRestritos");
  assert.match(hit.message, /chats/);
});

test("every trigger kind in the schema says what the person chooses, and how a template leaves each field out", () => {
  const schema = JSON.parse(readFileSync(join(root, "schemas/template.schema.json"), "utf8"));
  for (const branch of schema.$defs.trigger.allOf) {
    const kind = branch.if.properties.kind.const;
    const chooses = branch.then["x-person-chooses"];
    assert.ok(Array.isArray(chooses), kind);
    // Each field is left out in exactly one way: the app needs it to create the trigger, an omitted entry, or a field that holds the trigger.
    const ways = [branch.then["x-required-to-run"] ?? [], Object.keys(branch.then["x-omitted-code"] ?? {}), Object.keys(branch.then["x-held-by"] ?? {})];
    for (const f of chooses) assert.equal(ways.filter((w) => w.includes(f)).length, 1, `${kind}.${f}`);
    assert.deepEqual(ways.flat().sort(), [...chooses].sort(), kind);
    // The app holds a trigger only for a field it needs to run it.
    for (const f of branch.then["x-pending-choice"] ?? []) assert.ok(ways[0].includes(f), `${kind}.${f}`);
  }
});

test("x-pending-choice marks only what the app holds, the pending choice of the app", () => {
  // Marking a field the app does not hold lets batch through on a trigger the app drops: change both together.
  const schema = JSON.parse(readFileSync(join(root, "schemas/template.schema.json"), "utf8"));
  const held = Object.fromEntries(
    schema.$defs.trigger.allOf.filter((b) => b.then["x-pending-choice"] !== undefined).map((b) => [b.if.properties.kind.const, b.then["x-pending-choice"]]),
  );
  assert.deepEqual(held, { "slack-channel": ["channels"] });
});

test("a template may declare the minimum app version as x.y.z", async () => {
  assert.deepEqual(await validateFile(variant((item) => (item.minAppVersion = "0.1.10"))), []);
});

for (const bad of ["0.2", "v0.2.0", "0.2.0-beta", "01.2.0", "0.2.0.1", 2]) {
  test(`a template with minAppVersion ${JSON.stringify(bad)} fails at minAppVersion`, async () => {
    const errors = await validateFile(variant((item) => (item.minAppVersion = bad)));
    const hit = errors.find((e) => e.field === "minAppVersion");
    assert.ok(hit, JSON.stringify(fieldsOf(errors)));
    assert.match(hit.message, /x\.y\.z/);
  });
}

/** slack-reply with its inbox trigger in batch, reading what the batch event brings. */
const batched = (change = () => {}) =>
  variant((item) => {
    item.package.automacao.gatilhos[0].batch = { windowMinutes: 60, max: 50 };
    item.package.automacao.spec.steps[0].prompt =
      "Resuma as mensagens.\n{{event.items}}\nDe {{ event.windowStart }} a {{event.windowEnd}}: {{event.count}} decididas, {{event.cut}} cortadas, {{event.deferred}} adiadas.";
    change(item);
  });

test("a trigger with filter takes batch, and the template reads what the batch event brings", async () => {
  assert.deepEqual(await validateFile(batched()), []);
});

for (const [batch, at, message] of [
  [{ windowMinutes: 0, max: 50 }, "windowMinutes", />= 1/],
  [{ windowMinutes: 10081, max: 50 }, "windowMinutes", /<= 10080/],
  [{ windowMinutes: 60, max: 0 }, "max", />= 1/],
  [{ windowMinutes: 60, max: 501 }, "max", /<= 500/],
  [{ windowMinutes: 60, max: 2.5 }, "max", /integer/],
  [{ windowMinutes: 60 }, "max", /required/],
  [{ windowMinutes: 60, max: 50, every: 5 }, "every", /unknown field/],
]) {
  test(`batch ${JSON.stringify(batch)} fails at batch.${at}, with the limits of the app`, async () => {
    const hit = await errorAt(batched((item) => (item.package.automacao.gatilhos[0].batch = batch)), `package.automacao.gatilhos.0.batch.${at}`);
    assert.match(hit.message, message);
  });
}

test("batch on a trigger without filter fails at batch, as the app refuses it", async () => {
  for (const trigger of [{ kind: "cron", expression: "0 9 * * 1-5" }, { kind: "manual" }]) {
    const file = batched((item) => (item.package.automacao.gatilhos = [{ ...trigger, batch: { windowMinutes: 60, max: 50 } }]));
    const hit = await errorAt(file, "package.automacao.gatilhos.0.batch");
    assert.match(hit.message, new RegExp(`"${trigger.kind}" trigger has no filter`));
  }
});

test("with batch, a step that reads a field of a single event fails, because the batch event has no such field", async () => {
  const file = batched((item) => (item.package.automacao.spec.steps[0].prompt += "\nCanal: {{event.channel}}"));
  const hit = await errorAt(file, "package.automacao.spec.steps.0.prompt");
  assert.match(hit.message, /reads \{\{event\.channel\}\}/);
  assert.match(hit.message, /"slack-inbox" has batch/);
});

test("the batch event still counts as no event when a clock trigger starts the run", async () => {
  const file = batched((item) => item.package.automacao.gatilhos.push({ kind: "cron", expression: "0 9 * * 1-5" }));
  assert.match((await errorAt(file, "package.automacao.spec.steps.0.prompt")).message, /"cron" brings no event/);
});

/** slack-reply with a batched slack-channel trigger that leaves the channels to choose. */
const channelBatched = (minAppVersion) =>
  batched((item) => {
    item.minAppVersion = minAppVersion;
    item.package.automacao.gatilhos = [{ kind: "slack-channel", everyMinutes: 5, batch: { windowMinutes: 60, max: 50 } }];
    item.package.omitidos = [];
  });

test("batch on a trigger the app holds until the person chooses passes from the app that holds it", async () => {
  assert.deepEqual(await validateFile(channelBatched("0.2.0")), []);
});

test("batch on a trigger the app only creates after the person chooses fails at batch, because the app drops it whole", async () => {
  const file = batched((item) => {
    item.minAppVersion = "0.2.0";
    item.package.automacao.gatilhos = [{ kind: "poll", source: "github", everyMinutes: 5, batch: { windowMinutes: 60, max: 50 } }];
    item.package.requisitos.conexoes = [{ id: "github", nome: "GitHub" }];
    item.package.omitidos = [{ codigo: "dono-do-github", onde: "gatilho:0" }];
  });
  const hit = await errorAt(file, "package.automacao.gatilhos.0.batch");
  assert.match(hit.message, /without repoMatch/);
  assert.match(hit.message, /drops the whole trigger, batch included/);
});

test("a package keeps batch out of a trigger the app holds, because a package declares no minAppVersion", async () => {
  const file = variant((item) => {
    item.kind = "package";
    delete item.minAppVersion;
    item.package.automacao.gatilhos = [{ kind: "slack-channel", everyMinutes: 5, batch: { windowMinutes: 60, max: 50 } }];
    item.package.omitidos = [];
  }, "packages");
  const hit = await errorAt(file, "package.automacao.gatilhos.0.batch");
  assert.match(hit.message, /without channels/);
});

test("a held trigger and one with an omitted entry keep batch: the app creates them with the whole config", async () => {
  const file = batched((item) => {
    item.package.automacao.gatilhos.push({ kind: "teams-inbox", mentions: true, chatsRestritos: 1, batch: { windowMinutes: 30, max: 50 } });
    item.package.requisitos.conexoes.push({ id: "teams", nome: "Microsoft Teams" });
  });
  assert.deepEqual(await validateFile(file), []);
});

test("a template where one trigger that brings an event has batch and another has not fails at the one without", async () => {
  const file = batched((item) => {
    item.package.automacao.gatilhos.push({ kind: "teams-inbox", mentions: true, chatsRestritos: 1 });
    item.package.requisitos.conexoes.push({ id: "teams", nome: "Microsoft Teams" });
  });
  const hit = await errorAt(file, "package.automacao.gatilhos.1.batch");
  assert.match(hit.message, /"slack-inbox" has batch/);
  assert.match(hit.message, /no prompt serves both/);
  assert.match(hit.message, /Batch all the triggers/);
});

test("a manual trigger next to a batched one fails telling to remove it, since manual takes no batch", async () => {
  const file = batched((item) => item.package.automacao.gatilhos.push({ kind: "manual" }));
  const hit = await errorAt(file, "package.automacao.gatilhos.1.batch");
  assert.match(hit.message, /"manual" trigger takes no batch: remove it/);
});

/** slack-reply with a filter on its inbox trigger. */
const filtered = (filter) => variant((item) => (item.package.automacao.gatilhos[0].filter = filter));

test("a filter with the conditions of the app passes", async () => {
  const conditions = [
    { path: "author", compare: "not_equals", against: "{{ event.channel }}" },
    { path: "text", compare: "matches", against: "^deploy\\b" },
    { path: "thread-ts" },
  ];
  assert.deepEqual(await validateFile(filtered(conditions)), []);
});

for (const [condition, at, message] of [
  [{ path: "author..login" }, "path", /pattern/],
  [{ path: "author", compare: "like" }, "compare", /must be one of/],
  [{ path: "author", against: "x".repeat(501) }, "against", /500/],
  [{ path: "author", against: "\u{1F600}".repeat(300) }, "against", /UTF-16/],
  [{ path: "author", against: "{{steps.read.text}}" }, "against", /only event markers/],
  [{ path: "author", compare: "matches", against: "(" }, "against", /regular expression/],
  [{ path: "author", value: "x" }, "value", /unknown field/],
  [{ compare: "exists" }, "path", /required/],
]) {
  test(`filter condition ${JSON.stringify(condition)} fails at filter.0.${at}`, async () => {
    const hit = await errorAt(filtered([condition]), `package.automacao.gatilhos.0.filter.0.${at}`);
    assert.match(hit.message, message);
  });
}

test("a filter with more than 20 conditions fails at the filter", async () => {
  const hit = await errorAt(filtered(Array.from({ length: 21 }, () => ({ path: "author" }))), "package.automacao.gatilhos.0.filter");
  assert.match(hit.message, /20/);
});

test("a template and a package with hidden text in the name or description are refused", async () => {
  const template = await validateFile(variant((item) => (item.name.en = "Reply \u202Eylper")));
  assert.match(template.find((e) => e.field === "name.en")?.message ?? "", /U\+202E/);
  const pkg = await validateFile(variant((item) => {
    item.kind = "package";
    item.description["pt-BR"] = "Responde\u200B no canal.";
  }, "packages"));
  assert.match(pkg.find((e) => e.field === "description.pt-BR")?.message ?? "", /U\+200B/);
  assert.deepEqual(await validateFile(variant((item) => (item.name.en = "Reply \u{1F469}\u200D\u{1F4BB}"))), []);
});

test("initiativeFromEvent takes only its known values, and initiativeMatchAi its limits", async () => {
  const bad = variant((item) => (item.package.automacao.spec.initiativeFromEvent = "always"), "templates", "pr-rereview");
  assert.ok((await validateFile(bad)).some((e) => e.field.includes("initiativeFromEvent")));
  const tuned = variant((item) => (item.package.automacao.spec.initiativeMatchAi = { secondsTotal: 30, concurrency: 2 }), "templates", "pr-rereview");
  assert.deepEqual(await validateFile(tuned), []);
});

test("on a Node whose JSON.parse gives no source text, the validator stops with a clear error instead of refusing every item", () => {
  const oldParse = (text, reviver) => reviver.call({ "": JSON.parse(text) }, "", JSON.parse(text));
  assert.throws(() => assertSourceText(oldParse), /needs Node 22 or newer/);
  assert.doesNotThrow(() => assertSourceText());
});
