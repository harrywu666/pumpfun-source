import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { recover } from "../scripts/original-contracts/auth/recover.mjs";

const kernelDir = "packages/frontend/src/original-contracts/auth/kernels";
const receiptDir = "research/original-auth-session-20261028";

async function outputFixture(t) {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "original-auth-publication-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, kernelDir), { recursive: true });
  await mkdir(path.join(root, receiptDir), { recursive: true });
  return root;
}

test("failed publication leaves every existing recovery artifact untouched", async (t) => {
  const root = await outputFixture(t);
  const reader = path.join(root, kernelDir, "reader-b7990dc05987.mjs");
  const decoder = path.join(root, kernelDir, "decoder-d48cce6d6408.mjs");
  const sentinel =
    "sentinel: existing reader must survive a failed publication\n";
  await writeFile(reader, sentinel);
  await mkdir(decoder);

  await assert.rejects(
    recover({ check: false, outputRoot: root }),
    /publication target is not a regular file/,
  );
  assert.equal(await readFile(reader, "utf8"), sentinel);
  await assert.rejects(
    readFile(path.join(root, receiptDir, "PROVENANCE.json"), "utf8"),
    { code: "ENOENT" },
  );
});

test("successful publication can be verified from the same output root", async (t) => {
  const root = await outputFixture(t);
  await recover({ check: false, outputRoot: root });
  const receipt = await recover({ check: true, outputRoot: root });
  assert.equal(receipt.contexts.length, 3);
  assert.equal(receipt.contexts.flatMap((entry) => entry.variants).length, 6);
});
