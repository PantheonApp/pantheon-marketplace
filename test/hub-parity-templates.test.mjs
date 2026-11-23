// The same as hub-parity.test.mjs, for templates: each file in test/fixtures/hub-parity-templates is
// `{ name, accept, item | raw | base64 }`, written as templates/example.json, for the hub to run the same cases.
// `accept` is this catalog's answer; `hub_accepts` marks the cases where the catalog is stricter than the hub on purpose.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateFile } from "../scripts/lib/validate.mjs";

const dir = fileURLToPath(new URL("fixtures/hub-parity-templates/", import.meta.url));

for (const name of readdirSync(dir).sort()) {
  const c = JSON.parse(readFileSync(join(dir, name), "utf8"));
  test(`${c.accept ? "accepts" : "refuses"} the template case: ${c.name}`, async () => {
    const bytes = c.base64 !== undefined ? Buffer.from(c.base64, "base64") : Buffer.from(c.raw ?? JSON.stringify(c.item), "utf8");
    const catalog = mkdtempSync(join(tmpdir(), "parity-"));
    mkdirSync(join(catalog, "templates"));
    const file = join(catalog, "templates", "example.json");
    writeFileSync(file, bytes);
    const errors = await validateFile(file);
    assert.equal(errors.length === 0, c.accept, JSON.stringify(errors));
  });
}
