// Cases the hub can run too: each file in test/fixtures/hub-parity is `{ name, accept, item | raw | base64 }`, the
// item as an object, as the exact text, or as the exact bytes. `accept` is this catalog's answer; `hub_accepts` marks
// the few where the catalog is stricter than the hub on purpose.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateFile } from "../scripts/lib/validate.mjs";

const dir = fileURLToPath(new URL("fixtures/hub-parity/", import.meta.url));

for (const name of readdirSync(dir).sort()) {
  const c = JSON.parse(readFileSync(join(dir, name), "utf8"));
  test(`${c.accept ? "accepts" : "refuses"} ${c.name}`, async () => {
    const bytes = c.base64 !== undefined ? Buffer.from(c.base64, "base64") : Buffer.from(c.raw ?? JSON.stringify(c.item), "utf8");
    const catalog = mkdtempSync(join(tmpdir(), "parity-"));
    mkdirSync(join(catalog, "connections"));
    const file = join(catalog, "connections", "example.json");
    writeFileSync(file, bytes);
    const errors = await validateFile(file);
    assert.equal(errors.length === 0, c.accept, JSON.stringify(errors));
  });
}
