import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PUBLIC_KEY, signIndex, verifyIndex } from "../scripts/lib/signature.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

function testKeys() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }),
    publicBase64: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
  };
}

test("a signature over the exact bytes verifies with the matching public key", () => {
  const { privatePem, publicBase64 } = testKeys();
  const bytes = Buffer.from('{"format":"app-marketplace-index"}\n');
  const signature = signIndex(bytes, privatePem);
  assert.equal(Buffer.from(signature, "base64").length, 64);
  assert.equal(verifyIndex(bytes, signature, publicBase64), true);
});

test("changing one byte of the index breaks the signature", () => {
  const { privatePem, publicBase64 } = testKeys();
  const bytes = Buffer.from('{"format":"app-marketplace-index"}\n');
  const signature = signIndex(bytes, privatePem);
  const tampered = Buffer.from(bytes);
  tampered[3] ^= 1;
  assert.equal(verifyIndex(tampered, signature, publicBase64), false);
});

test("another key does not verify the signature", () => {
  const signer = testKeys();
  const other = testKeys();
  const bytes = Buffer.from("index");
  assert.equal(verifyIndex(bytes, signIndex(bytes, signer.privatePem), other.publicBase64), false);
});

test("the published public key is the one in keys/index-signing.pub", () => {
  assert.equal(readFileSync(join(root, "keys/index-signing.pub"), "utf8").trim(), PUBLIC_KEY);
  assert.equal(PUBLIC_KEY, "MCowBQYDK2VwAyEAVDPQ3V7UnUkEVn+wer6sHmDEldnGR3FTbSbzXI8Q7pc=");
});

test("the public key is an Ed25519 key in SPKI form, the header the hub strips before the 32 bytes of the key", () => {
  const der = Buffer.from(PUBLIC_KEY, "base64");
  assert.equal(der.length, 44);
  assert.deepEqual([...der.subarray(0, 12)], [0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]);
});

test("the verify CLI with the public key of the repository refuses a signature by another key", () => {
  const { privatePem } = testKeys();
  const dir = mkdtempSync(join(tmpdir(), "sign-"));
  const index = join(dir, "index.json");
  writeFileSync(index, '{"format":"app-marketplace-index","items":[]}\n');
  writeFileSync(`${index}.sig`, signIndex(readFileSync(index), privatePem));
  const run = spawnSync(process.execPath, ["scripts/verify-index.mjs", index], { cwd: root, encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /does not match/);
});

test("the CLIs sign with INDEX_SIGNING_KEY and verify, and the verify CLI fails on a tampered index", () => {
  const { privatePem, publicBase64 } = testKeys();
  const dir = mkdtempSync(join(tmpdir(), "sign-"));
  const index = join(dir, "index.json");
  writeFileSync(index, '{"format":"app-marketplace-index","items":[]}\n');
  const sign = spawnSync(process.execPath, ["scripts/sign-index.mjs", index], { cwd: root, encoding: "utf8", env: { ...process.env, INDEX_SIGNING_KEY: privatePem } });
  assert.equal(sign.status, 0, sign.stderr);
  const verify = () => spawnSync(process.execPath, ["scripts/verify-index.mjs", index, "--public-key", publicBase64], { cwd: root, encoding: "utf8" });
  assert.equal(verify().status, 0, verify().stderr);
  writeFileSync(index, '{"format":"app-marketplace-index","items":[ ]}\n');
  assert.equal(verify().status, 1);
});

test("signing without INDEX_SIGNING_KEY fails", () => {
  const env = { ...process.env };
  delete env.INDEX_SIGNING_KEY;
  const run = spawnSync(process.execPath, ["scripts/sign-index.mjs", join(root, "package.json")], { cwd: root, encoding: "utf8", env });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /INDEX_SIGNING_KEY/);
});
