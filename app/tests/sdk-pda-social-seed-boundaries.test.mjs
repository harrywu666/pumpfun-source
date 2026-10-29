import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(
  new URL("../packages/sdk/package.json", import.meta.url),
);
const sdk = require(join(root, "packages/sdk/dist/index.js"));
const { PublicKey } = require("@solana/web3.js");

test("social fee PDA rejects user IDs over the on-chain byte limit", () => {
  assert.throws(
    () => sdk.socialFeePda("123456789012345678901", sdk.Platform.GitHub),
    /userId must be at most 20 UTF-8 bytes/,
  );
  assert.throws(
    () => sdk.socialFeePda("é".repeat(11), sdk.Platform.GitHub),
    /userId must be at most 20 UTF-8 bytes/,
  );
});

test("createSocialFeePda refuses an overlong ID before building", async () => {
  await assert.rejects(
    sdk.PUMP_SDK.createSocialFeePda({
      payer: PublicKey.default,
      userId: "123456789012345678901",
      platform: sdk.Platform.GitHub,
    }),
    /userId must be at most 20 UTF-8 bytes/,
  );
});

test("social fee PDA rejects non-u8 platform values", () => {
  for (const platform of [1.5, Number.NaN, -1, 256]) {
    assert.throws(
      () => sdk.socialFeePda("user-42", platform),
      /platform must be an integer from 0 to 255/,
      String(platform),
    );
  }
});

test("social fee PDA keeps both valid boundaries distinct", () => {
  const first = sdk.socialFeePda("12345678901234567890", 0);
  const last = sdk.socialFeePda("12345678901234567890", 255);
  assert.notEqual(first.toBase58(), last.toBase58());
});
