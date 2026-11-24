// What docs/your-own-catalog.md teaches: a catalog of its own, signed with its own key, that the scripts of this
// repository accept. If the format of the key or of the signature changes, the guide is out of date and this fails.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex } from "../scripts/lib/build-index.mjs";
import { PUBLIC_KEY, signIndex, verifyIndex } from "../scripts/lib/signature.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const AT = { commit: "0123456789abcdef0123456789abcdef01234567", committedAt: 1792000000 };
const GUIDES = ["docs/your-own-catalog.md", "docs/your-own-catalog.pt-BR.md"];

/** The shell block of a guide that makes the key pair. */
function keyCommand(guide) {
  const blocks = [...readFileSync(join(root, guide), "utf8").matchAll(/^```sh\n([\s\S]*?)^```$/gm)].map((m) => m[1]);
  const found = blocks.filter((block) => block.includes("generateKeyPairSync"));
  assert.equal(found.length, 1, `${guide} has one block that makes the key pair`);
  return found[0];
}

/** Runs the command of the guide in a folder. */
function runKeyCommand(dir) {
  const path = `${dirname(process.execPath)}:${process.env.PATH ?? ""}`;
  return spawnSync("sh", ["-c", keyCommand(GUIDES[0])], { cwd: dir, encoding: "utf8", env: { ...process.env, PATH: path } });
}

/** Runs the command of the guide in a new folder and reads the pair it leaves there. */
function keysFromGuide(t) {
  const dir = mkdtempSync(join(tmpdir(), "own-catalog-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const run = runKeyCommand(dir);
  assert.equal(run.status, 0, run.stderr);
  return {
    dir,
    privateFile: join(dir, "index-signing.key"),
    privatePem: readFileSync(join(dir, "index-signing.key"), "utf8"),
    publicBase64: readFileSync(join(dir, "index-signing.pub"), "utf8").trim(),
  };
}

test("both guides teach the same command to make the key pair", () => {
  assert.equal(keyCommand(GUIDES[1]), keyCommand(GUIDES[0]));
});

test("the command of the guide makes an Ed25519 pair the scripts read, with the private key readable only by its owner", (t) => {
  const keys = keysFromGuide(t);
  assert.match(keys.privatePem, /^-----BEGIN PRIVATE KEY-----\n/);
  assert.equal(statSync(keys.privateFile).mode & 0o777, 0o600);
  assert.equal(Buffer.from(keys.publicBase64, "base64").length, 44);
  const bytes = Buffer.from("index");
  assert.equal(verifyIndex(bytes, signIndex(bytes, keys.privatePem), keys.publicBase64), true);
});

test("an index of this catalog signed with a new key verifies with that key and not with the official one", async (t) => {
  const keys = keysFromGuide(t);
  const index = Buffer.from(await buildIndex(root, AT));
  const signature = signIndex(index, keys.privatePem);
  assert.equal(verifyIndex(index, signature, keys.publicBase64), true);
  assert.equal(verifyIndex(index, signature, PUBLIC_KEY), false);
});

test("the CLIs sign with the new key in INDEX_SIGNING_KEY and verify it with --public-key, as the pipeline and the guide do", async (t) => {
  const keys = keysFromGuide(t);
  const index = join(keys.dir, "index.json");
  writeFileSync(index, await buildIndex(root, AT));
  const sign = spawnSync(process.execPath, ["scripts/sign-index.mjs", index], { cwd: root, encoding: "utf8", env: { ...process.env, INDEX_SIGNING_KEY: keys.privatePem } });
  assert.equal(sign.status, 0, sign.stderr);
  const verify = (...args) => spawnSync(process.execPath, ["scripts/verify-index.mjs", index, ...args], { cwd: root, encoding: "utf8" });
  const own = verify("--public-key", keys.publicBase64);
  assert.equal(own.status, 0, own.stderr);
  assert.match(own.stdout, /is valid/);
  const official = verify();
  assert.equal(official.status, 1);
  assert.match(official.stderr, /does not match/);
});

test("run again in the same folder, the command of the guide refuses to overwrite the pair", (t) => {
  const keys = keysFromGuide(t);
  const again = runKeyCommand(keys.dir);
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /index-signing\.key and index-signing\.pub already exist/);
  assert.equal(readFileSync(keys.privateFile, "utf8"), keys.privatePem);
  assert.equal(readFileSync(join(keys.dir, "index-signing.pub"), "utf8").trim(), keys.publicBase64);
  assert.equal(statSync(keys.privateFile).mode & 0o777, 0o600);
});

for (const [present, absent] of [["index-signing.pub", "index-signing.key"], ["index-signing.key", "index-signing.pub"]]) {
  test(`with only ${present} in the folder, the command of the guide stops before it writes ${absent}`, (t) => {
    const dir = mkdtempSync(join(tmpdir(), "own-catalog-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(join(dir, present), "kept\n");
    const run = runKeyCommand(dir);
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, new RegExp(`${present.replace(".", "\\.")} already exists`));
    assert.deepEqual(readdirSync(dir), [present]);
    assert.equal(readFileSync(join(dir, present), "utf8"), "kept\n");
  });
}

test("the environment and the secret the guides tell to create are the ones the pipeline reads", () => {
  const workflow = readFileSync(join(root, ".github/workflows/publish.yml"), "utf8");
  for (const guide of GUIDES) {
    const command = readFileSync(join(root, guide), "utf8").match(/gh secret set (\S+) --env (\S+)/);
    assert.ok(command, `${guide} tells how to set the secret`);
    const [, secret, environment] = command;
    assert.match(workflow, new RegExp(`^\\s+environment: ${environment}$`, "m"), `${guide}: environment ${environment}`);
    assert.ok(workflow.includes(`\${{ secrets.${secret} }}`), `${guide}: secret ${secret}`);
  }
});
