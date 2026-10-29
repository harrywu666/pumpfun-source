import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(
  new URL("../packages/sdk/package.json", import.meta.url),
);
const { PublicKey } = require("@solana/web3.js");
const { poolPda } = require(join(root, "packages/sdk/dist/swap/index.js"));

const owner = new PublicKey(new Uint8Array(32).fill(1));
const baseMint = new PublicKey(new Uint8Array(32).fill(2));
const quoteMint = new PublicKey(new Uint8Array(32).fill(3));

const derivePool = (index) => poolPda(index, owner, baseMint, quoteMint);

test("poolPda accepts the full create_pool u16 index range", () => {
  assert.doesNotThrow(() => derivePool(0));
  assert.doesNotThrow(() => derivePool(0xffff));
});

test("poolPda rejects negative pool indexes instead of deriving a colliding PDA", () => {
  assert.throws(
    () => derivePool(-1),
    /pool index must be an integer between 0 and 65535/i,
  );
  assert.throws(
    () => derivePool(-65535),
    /pool index must be an integer between 0 and 65535/i,
  );
});

test("poolPda rejects fractional and out-of-range pool indexes", () => {
  for (const index of [1.5, 65536, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => derivePool(index),
      /pool index must be an integer between 0 and 65535/i,
      `expected poolPda(${index}) to throw`,
    );
  }
});
