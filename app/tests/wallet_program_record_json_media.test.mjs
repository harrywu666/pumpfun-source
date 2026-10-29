import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const requireBackend = createRequire(
  new URL("../packages/backend/package.json", import.meta.url),
);
const { require: requireTs } = requireBackend("tsx/cjs/api");
const { readWalletRecordWithRpc } = requireTs(
  "../packages/frontend/src/app/wallet-program-record/server.ts",
  import.meta.url,
);
const { fetchWalletRecord } = requireTs(
  "../packages/frontend/src/app/wallet-program-record/client.ts",
  import.meta.url,
);
const contract = requireTs(
  "../packages/frontend/src/app/wallet-program-record/contract.json",
  import.meta.url,
);

const sdkRequire = createRequire(
  new URL("../packages/sdk/package.json", import.meta.url),
);
const sdk = sdkRequire("./dist/index.js");
const { PublicKey } = sdkRequire("@solana/web3.js");

const USER = "So11111111111111111111111111111111111111112";
const GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

function accountData() {
  const bytes = Buffer.alloc(contract.minimumBytes);
  Buffer.from(contract.discriminator).copy(bytes);
  for (const field of contract.fields) {
    const start = field.bytes[0];
    if (field.type === "pubkey")
      new PublicKey(USER).toBuffer().copy(bytes, start);
    else if (field.type === "bool") bytes[start] = 1;
    else if (field.type === "u64") bytes.writeBigUInt64LE(0n, start);
    else if (field.type === "i64") bytes.writeBigInt64LE(-9n, start);
  }
  return bytes;
}

function account() {
  const data = accountData();
  return {
    owner: contract.programId,
    executable: false,
    lamports: 2_039_280,
    rentEpoch: "18446744073709551615",
    space: data.length,
    data: [data.toString("base64"), "base64"],
  };
}

async function goodRecord() {
  const call = async (method) =>
    method === "getGenesisHash"
      ? GENESIS
      : { context: { slot: 321 }, value: account() };
  return readWalletRecordWithRpc(USER, call, "public-rpc.example");
}

test("rejects a JSON-looking wallet record with a non-JSON media type", async () => {
  const record = await goodRecord();
  await assert.rejects(
    fetchWalletRecord(
      USER,
      undefined,
      async () =>
        new Response(JSON.stringify(record), {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
    ),
    /unavailable or unsupported/,
  );
});

test("accepts documented JSON and structured JSON suffix media types", async () => {
  const record = await goodRecord();
  for (const contentType of [
    "application/json",
    "application/json; charset=utf-8",
    "application/problem+json",
  ]) {
    const result = await fetchWalletRecord(
      USER,
      undefined,
      async () =>
        new Response(JSON.stringify(record), {
          status: 200,
          headers: { "content-type": contentType },
        }),
    );
    assert.equal(result.record.user, USER);
  }
});
