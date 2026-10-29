import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
const requireBackend = createRequire(
  new URL("../packages/backend/package.json", import.meta.url),
);
const { require: requireTs } = requireBackend("tsx/cjs/api");
const { readWalletRecordWithRpc } = requireTs(
  "../packages/frontend/src/app/wallet-program-record/server.ts",
  import.meta.url,
);
const { handleWalletRecord } = requireTs(
  "../packages/frontend/src/app/wallet-program-record/handler.ts",
  import.meta.url,
);
const { isWalletRecord, fetchWalletRecord } = requireTs(
  "../packages/frontend/src/app/wallet-program-record/client.ts",
  import.meta.url,
);
const sdkRequire = createRequire(
  new URL("../packages/sdk/package.json", import.meta.url),
);
const sdk = sdkRequire("./dist/index.js");
const { PublicKey } = sdkRequire("@solana/web3.js");
const contract = requireTs(
  "../packages/frontend/src/app/wallet-program-record/contract.json",
  import.meta.url,
);
const USER = "So11111111111111111111111111111111111111112",
  OTHER = "11111111111111111111111111111111";
const GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const PDA = sdk.userVolumeAccumulatorPda(new PublicKey(USER)).toBase58();
const MAX = (1n << 64n) - 1n;
function bytes() {
  const b = Buffer.alloc(contract.minimumBytes);
  Buffer.from(contract.discriminator).copy(b);
  for (const field of contract.fields) {
    const start = field.bytes[0];
    if (field.type === "pubkey") new PublicKey(USER).toBuffer().copy(b, start);
    else if (field.type === "bool")
      b[start] = Number(field.name === "needs_claim");
    else if (field.type === "u64")
      b.writeBigUInt64LE(MAX - BigInt(start), start);
    else if (field.type === "i64") b.writeBigInt64LE(-9n, start);
  }
  return b;
}
function account(data = bytes()) {
  return {
    owner: contract.programId,
    executable: false,
    lamports: 2_039_280,
    rentEpoch: "18446744073709551615",
    space: data.length,
    data: [data.toString("base64"), "base64"],
  };
}
function fixture(value = account(), genesis = GENESIS) {
  const calls = [],
    call = async (method, params, signal) => {
      calls.push({ method, params, signal });
      return method === "getGenesisHash"
        ? genesis
        : { context: { slot: 321 }, value };
    };
  return { call, calls };
}
const read = (f, signal) =>
  readWalletRecordWithRpc(USER, f.call, "public-rpc.example", signal);

test("source producer reproduces archive-equal public SDK witnesses and unchanged used transport", () => {
  execFileSync(
    process.execPath,
    ["scripts/wallet-program-record/contract.mjs", "--check"],
    { cwd: new URL("..", import.meta.url) },
  );
  assert.equal(contract.minimumBytes, 106);
  assert.deepEqual(
    contract.fields.find((x) => x.name === "user").bytes,
    [8, 40],
  );
});
test("actual SDK decoder and reader preserve every unsigned field above JS precision and signed timestamp", async () => {
  const f = fixture(),
    result = await read(f);
  const decoded = sdk.PUMP_SDK.decodeUserVolumeAccumulator({
    data: bytes(),
    owner: new PublicKey(contract.programId),
    executable: false,
    lamports: 1,
  });
  assert.equal(result.recordPda, PDA);
  assert.equal(result.record.user, USER);
  assert.equal(result.contextSlot, 321);
  for (const field of contract.fields) {
    if (field.type === "u64" || field.type === "i64")
      assert.equal(
        result.record[field.decoded],
        decoded[field.decoded].toString(10),
      );
  }
  assert.equal(result.record.lastUpdateTimestamp, "-9");
  assert.equal(result.record.needsClaim, true);
  assert.equal(result.record.hasTotalClaimedTokens, false);
  assert.deepEqual(
    f.calls.map(({ method, params }) => ({ method, params })),
    [
      { method: "getGenesisHash", params: [] },
      {
        method: "getAccountInfo",
        params: [PDA, { encoding: "base64", commitment: "confirmed" }],
      },
    ],
  );
  assert.equal(isWalletRecord(result, USER), true);
});
test("missing records remain null and unsupported old layouts are never zero-extended or substituted", async () => {
  const missing = await read(fixture(null));
  assert.equal(missing.record, null);
  assert.equal(missing.dataBytes, null);
  for (const length of [0, 8, 40, 74, 105])
    await assert.rejects(
      read(fixture(account(bytes().subarray(0, length)))),
      /unavailable or unsupported/,
    );
  const extra = Buffer.concat([bytes(), Buffer.alloc(32)]);
  assert.equal((await read(fixture(account(extra)))).dataBytes, 138);
});
test("owner, embedded wallet, discriminator, boolean, bounded base64 and account metadata fail closed", async () => {
  for (const change of [
    (a) => {
      a.owner = OTHER;
    },
    (a) => {
      a.executable = true;
    },
    (a) => {
      a.lamports = Number.MAX_SAFE_INTEGER + 1;
    },
    (a) => {
      a.lamports = "100";
    },
    (a) => {
      a.space = 1;
    },
    (a) => {
      a.data[0] += "\n";
    },
    (a) => {
      a.data[1] = "base64+zstd";
    },
    (a) => {
      a.data = ["A".repeat(22_001), "base64"];
    },
  ]) {
    const a = account();
    change(a);
    await assert.rejects(read(fixture(a)), /unavailable or unsupported/);
  }
  for (const offset of [
    0,
    ...contract.fields.filter((f) => f.type === "bool").map((f) => f.bytes[0]),
  ]) {
    const b = bytes();
    b[offset] = 2;
    await assert.rejects(
      read(fixture(account(b))),
      /unavailable or unsupported/,
    );
  }
  const b = bytes();
  new PublicKey(OTHER).toBuffer().copy(b, 8);
  await assert.rejects(read(fixture(account(b))), /unavailable or unsupported/);
});
test("wallet/cluster/context and abort gates prevent invalid or cancelled follow-on account requests", async () => {
  const f = fixture();
  await assert.rejects(
    readWalletRecordWithRpc("seed phrase", f.call, "public-rpc.example"),
    /canonical/,
  );
  assert.equal(f.calls.length, 0);
  const wrong = fixture(null, "wrong-cluster");
  await assert.rejects(read(wrong), /not Solana mainnet/);
  assert.equal(wrong.calls.length, 1);
  for (const response of [
    {},
    { context: { slot: -1 }, value: null },
    { context: { slot: 1.5 }, value: null },
    { context: {}, value: null },
    { context: { slot: 1 } },
  ])
    await assert.rejects(
      readWalletRecordWithRpc(
        USER,
        async (method) => (method === "getGenesisHash" ? GENESIS : response),
        "public-rpc.example",
      ),
      /unavailable or unsupported/,
    );
  const controller = new AbortController(),
    calls = [];
  await assert.rejects(
    readWalletRecordWithRpc(
      USER,
      async (method) => {
        calls.push(method);
        controller.abort(new Error("cancelled"));
        return GENESIS;
      },
      "public-rpc.example",
      controller.signal,
    ),
    /cancelled/,
  );
  assert.deepEqual(calls, ["getGenesisHash"]);
  await assert.rejects(read(fixture(), controller.signal), /cancelled/);
});
test("browser acceptance binds wallet/PDA/program and exact integer widths without exposing provider failures", async () => {
  const good = await read(fixture());
  for (const changed of [
    { ...good, address: OTHER },
    { ...good, recordPda: OTHER },
    { ...good, programId: OTHER },
    { ...good, record: { ...good.record, user: OTHER } },
    {
      ...good,
      record: { ...good.record, cashbackEarned: (1n << 64n).toString() },
    },
    {
      ...good,
      record: { ...good.record, lastUpdateTimestamp: (1n << 63n).toString() },
    },
    { ...good, record: { ...good.record, totalClaimedTokens: "01" } },
    { ...good, record: null, dataBytes: 106 },
  ])
    assert.equal(isWalletRecord(changed, USER), false);
  let seen;
  const actual = await fetchWalletRecord(
    USER,
    undefined,
    async (url, options) => {
      seen = { url, options };
      return Response.json(good);
    },
  );
  assert.equal(actual.record.user, USER);
  assert.equal(seen.url, `/api/portfolio/pump-record?address=${USER}`);
  assert.equal(seen.options.credentials, "omit");
  assert.equal(seen.options.cache, "no-store");
  assert.deepEqual(seen.options.headers, { Accept: "application/json" });
  await assert.rejects(
    fetchWalletRecord(USER, undefined, async () =>
      Response.json({ secret: "private-provider" }, { status: 503 }),
    ),
    (e) => !e.message.includes("private-provider"),
  );
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  let count = 0;
  await assert.rejects(
    fetchWalletRecord(USER, controller.signal, async () => {
      count++;
      return Response.json(good);
    }),
    /cancelled/,
  );
  assert.equal(count, 0);
});
test("handler rejects malformed queries before reader and returns bounded no-store errors", async () => {
  let count = 0;
  const reader = async () => {
    count++;
    throw new Error("private-provider");
  };
  for (const query of [
    "",
    "address=x&address=y",
    `address=${USER}&unknown=1`,
    `address=${USER}&=bypass`,
  ]) {
    const result = await handleWalletRecord(
      new Request(`http://local.test/api/portfolio/pump-record?${query}`),
      reader,
    );
    assert.equal(result.status, 400);
    assert.equal(result.headers.get("cache-control"), "no-store");
  }
  assert.equal(count, 0);
  const result = await handleWalletRecord(
    new Request(`http://local.test/?address=${USER}`),
    reader,
  );
  assert.equal(result.status, 502);
  assert.ok(!(await result.text()).includes("private-provider"));
});

test("Next automatic HEAD dispatch reaches the same bounded public reader", async () => {
  const success = await read(fixture());
  let reads = 0;
  const reader = async () => {
    reads++;
    return success;
  };
  const head = await handleWalletRecord(
    new Request(`http://local.test/api/portfolio/pump-record?address=${USER}`, {
      method: "HEAD",
    }),
    reader,
  );
  assert.deepEqual(
    {
      headStatus: head.status,
      cacheControl: head.headers.get("cache-control"),
      reads,
    },
    { headStatus: 200, cacheControl: "no-store", reads: 1 },
  );
});
test("real local HTTP client traverses actual handler and SDK reader for success, missing and unsupported records", async (t) => {
  let value = account(),
    requests = [];
  const server = createServer(async (req, res) => {
    requests.push({
      method: req.method,
      url: req.url,
      cookie: req.headers.cookie,
    });
    const request = new Request(`http://127.0.0.1${req.url}`);
    const response = await handleWalletRecord(request, (user, options) =>
      readWalletRecordWithRpc(
        user,
        fixture(value).call,
        "public-rpc.example",
        options.signal,
      ),
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const http = (url, init) => fetch(base + url, init);
  assert.equal(
    (await fetchWalletRecord(USER, undefined, http)).record.user,
    USER,
  );
  value = null;
  assert.equal((await fetchWalletRecord(USER, undefined, http)).record, null);
  value = account(bytes().subarray(0, 40));
  await assert.rejects(
    fetchWalletRecord(USER, undefined, http),
    /unavailable or unsupported/,
  );
  assert.ok(
    requests.every(
      (r) =>
        r.method === "GET" &&
        r.url === `/api/portfolio/pump-record?address=${USER}` &&
        r.cookie === undefined,
    ),
  );
});
