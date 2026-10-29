import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { test } from "node:test";

const sdkRequire = createRequire(
  new URL("../packages/sdk/package.json", import.meta.url),
);
const sdk = sdkRequire("./dist/index.js");
const { OnlinePumpAmmSdk } = sdkRequire("./dist/swap/index.js");
const { Connection, PublicKey } = sdkRequire("@solana/web3.js");

const POOL_DISCRIMINATOR = Buffer.from([241, 154, 109, 4, 17, 177, 109, 188]);
const POOL_ACCOUNT_LENGTH = 300;
const poolKey = new PublicKey(Buffer.alloc(32, 201));
const creator = new PublicKey(Buffer.alloc(32, 1));
const baseMint = new PublicKey(Buffer.alloc(32, 2));
const quoteMint = new PublicKey(Buffer.alloc(32, 3));
const lpMint = new PublicKey(Buffer.alloc(32, 4));
const baseVault = new PublicKey(Buffer.alloc(32, 5));
const quoteVault = new PublicKey(Buffer.alloc(32, 6));
const coinCreator = new PublicKey(Buffer.alloc(32, 7));

function poolAccountData() {
  const data = Buffer.alloc(POOL_ACCOUNT_LENGTH);
  POOL_DISCRIMINATOR.copy(data);
  data[8] = 255;
  data.writeUInt16LE(7, 9);
  creator.toBuffer().copy(data, 11);
  baseMint.toBuffer().copy(data, 43);
  quoteMint.toBuffer().copy(data, 75);
  lpMint.toBuffer().copy(data, 107);
  baseVault.toBuffer().copy(data, 139);
  quoteVault.toBuffer().copy(data, 171);
  data.writeBigUInt64LE(1_000n, 203);
  coinCreator.toBuffer().copy(data, 211);
  data[243] = 0;
  data[244] = 0;
  data.writeBigUInt64LE(5n, 261);
  data[269] = 0;
  data[270] = 0;
  data.writeBigUInt64LE(0n, 271);
  data.writeBigUInt64LE(0n, 279);
  return data;
}

async function accountServer(owner, data) {
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    assert.equal(payload.method, "getAccountInfo");
    assert.equal(payload.params[0], poolKey.toBase58());
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: payload.id,
        result: {
          context: { slot: 1 },
          value: {
            data: [data.toString("base64"), "base64"],
            executable: false,
            lamports: 2_039_280,
            owner: owner.toBase58(),
            rentEpoch: 0,
            space: data.length,
          },
        },
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    connection: new Connection(
      `http://127.0.0.1:${server.address().port}`,
      "confirmed",
    ),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function withOwnedPool(owner, run) {
  const fixture = await accountServer(owner, poolAccountData());
  try {
    return await run(fixture.connection);
  } finally {
    await fixture.close();
  }
}

test("fetchPool binds AccountInfo.owner to the pump-amm program", async () => {
  const pool = await withOwnedPool(sdk.PUMP_AMM_PROGRAM_ID, (connection) =>
    new OnlinePumpAmmSdk(connection).fetchPool(poolKey),
  );
  assert.equal(pool.baseMint.toBase58(), baseMint.toBase58());
  assert.equal(pool.creatorFeeBps.toString(), "5");

  await assert.rejects(
    withOwnedPool(sdk.PUMP_PROGRAM_ID, (connection) =>
      new OnlinePumpAmmSdk(connection).fetchPool(poolKey),
    ),
    /account owner.*expected pump-amm program/,
  );
});

test("setCoinCreatorInstructions refuses a non-pump-amm pool account", async () => {
  await assert.rejects(
    withOwnedPool(sdk.PUMP_PROGRAM_ID, (connection) =>
      new OnlinePumpAmmSdk(connection).setCoinCreatorInstructions(
        poolKey,
        new PublicKey(Buffer.alloc(32, 8)),
      ),
    ),
    /account owner.*expected pump-amm program/,
  );
});
