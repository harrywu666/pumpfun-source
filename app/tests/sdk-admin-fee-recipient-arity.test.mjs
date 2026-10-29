import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(
  new URL("../packages/sdk/package.json", import.meta.url),
);
const { Connection, PublicKey } = require("@solana/web3.js");
const BN = require("bn.js");
const { PumpAmmAdminSdk } = require("./dist/swap/index.js");

const key = (label) =>
  new PublicKey(createHash("sha256").update(label).digest());
const admin = key("admin");
const authority = key("authority");
const recipients = (count) =>
  Array.from({ length: count }, (_, index) => key(`recipient-${index}`));
const sdk = new PumpAmmAdminSdk(new Connection("http://127.0.0.1:8899"));

for (const method of ["createConfig", "updateFeeConfig"]) {
  for (const count of [7, 9]) {
    test(`${method} rejects ${count} protocol fee recipients`, async () => {
      await assert.rejects(
        async () =>
          sdk[method](
            new BN(1),
            new BN(2),
            recipients(count),
            new BN(3),
            admin,
            authority,
          ),
        /exactly 8 protocol fee recipients/i,
      );
    });
  }

  test(`${method} accepts eight protocol fee recipients`, async () => {
    const instruction = await sdk[method](
      new BN(1),
      new BN(2),
      recipients(8),
      new BN(3),
      admin,
      authority,
    );
    assert.ok(instruction.data.length > 0);
  });
}
