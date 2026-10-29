import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
const requireBackend = createRequire(
  new URL("../packages/backend/package.json", import.meta.url),
);
const { require: requireTs } = requireBackend("tsx/cjs/api");
const { readHolderConfigurationWithRpc } = requireTs(
  "../packages/frontend/src/app/holder-rewards-config/server.ts",
  import.meta.url,
);
const { handleHolderConfiguration } = requireTs(
  "../packages/frontend/src/app/holder-rewards-config/handler.ts",
  import.meta.url,
);
const { isHolderConfiguration, readHolderConfiguration } = requireTs(
  "../packages/frontend/src/app/holder-rewards-config/client.ts",
  import.meta.url,
);
const sdkRequire = createRequire(
  new URL("../packages/sdk/package.json", import.meta.url),
);
const sdk = sdkRequire("./dist/index.js");
const { PublicKey } = sdkRequire("@solana/web3.js");
const contract = requireTs(
  "../packages/frontend/src/app/holder-rewards-config/contract.json",
  import.meta.url,
);
const MINT = "So11111111111111111111111111111111111111112";
const REWARDS = sdk.holderRewardsPda(new PublicKey(MINT)).toBase58();
const GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
function data(name, flag = true) {
  const spec = contract.accounts[name],
    bytes = Buffer.alloc(spec.size);
  Buffer.from(spec.discriminator).copy(bytes);
  if (name === "Global") {
    new PublicKey(MINT)
      .toBuffer()
      .copy(bytes, spec.fields.holder_reward_claim_authority[0]);
    bytes[spec.fields.is_holder_reward_enabled[0]] = Number(flag);
  } else {
    sdk
      .holderRewardsPda(new PublicKey(MINT))
      .toBuffer()
      .copy(bytes, spec.fields.creator[0]);
    bytes[spec.fields.is_holder_reward[0]] = Number(flag);
  }
  return bytes;
}
function account(bytes) {
  return {
    owner: contract.programId,
    executable: false,
    lamports: 2_039_280,
    rentEpoch: "18446744073709551615",
    space: bytes.length,
    data: [bytes.toString("base64"), "base64"],
  };
}
function fixture({
  global = account(data("Global")),
  curve = account(data("BondingCurve")),
  genesis = GENESIS,
} = {}) {
  const calls = [];
  const call = async (method, params, signal) => {
    calls.push({ method, params, signal });
    return method === "getGenesisHash"
      ? genesis
      : { context: { slot: 321 }, value: [global, curve] };
  };
  return { call, calls };
}
const read = (f, signal) =>
  readHolderConfigurationWithRpc(MINT, f.call, "public-rpc.example", signal);

test("SDK/IDL producer authenticates archive sources, physical field ranges and unchanged used transport", () => {
  execFileSync(
    process.execPath,
    ["scripts/holder-rewards-config/contract.mjs", "--check"],
    { cwd: new URL("..", import.meta.url), stdio: "pipe" },
  );
  assert.deepEqual(
    contract.accounts.Global.fields.is_holder_reward_enabled,
    [1086, 1087],
  );
  assert.deepEqual(
    contract.accounts.BondingCurve.fields.is_holder_reward,
    [124, 125],
  );
});
test("actual read pair preserves independent flags and public authority without deriving eligibility", async () => {
  const f = fixture({ global: account(data("Global", false)) });
  const signal = new AbortController().signal;
  const value = await read(f, signal);
  assert.equal(value.global.isHolderRewardEnabled, false);
  assert.equal(value.curve.isHolderReward, true);
  assert.equal(value.global.holderRewardClaimAuthority, MINT);
  assert.equal(value.curve.creator, REWARDS);
  assert.equal(value.curve.creatorMatchesHolderRewardsPda, true);
  assert.equal(value.contextSlot, 321);
  assert.equal(value.programId, sdk.PUMP_PROGRAM_ID.toBase58());
  assert.deepEqual(
    Object.keys(value).filter((key) => /claimable|eligible|payout/i.test(key)),
    [],
  );
  assert.deepEqual(
    f.calls.map(({ method, params }) => ({ method, params })),
    [
      { method: "getGenesisHash", params: [] },
      {
        method: "getMultipleAccounts",
        params: [
          [sdk.GLOBAL_PDA.toBase58(), sdk.bondingCurvePda(MINT).toBase58()],
          { encoding: "base64", commitment: "confirmed" },
        ],
      },
    ],
  );
  assert.ok(f.calls.every((call) => call.signal === signal));
  assert.equal(isHolderConfiguration(value, MINT, REWARDS), true);
});
test("SDK-padded defaults never become observed false or zero-key fields for older layouts", async () => {
  for (const [globalLength, curveLength] of [
    [1045, 49],
    [1054, 124],
    [1086, 124],
  ]) {
    const global = data("Global").subarray(0, globalLength),
      curve = data("BondingCurve").subarray(0, curveLength);
    assert.equal(
      sdk.PUMP_SDK.decodeGlobal({ data: global }).isHolderRewardEnabled,
      false,
    );
    assert.equal(
      sdk.PUMP_SDK.decodeBondingCurve({ data: curve }).isHolderReward,
      false,
    );
    const value = await read(
      fixture({ global: account(global), curve: account(curve) }),
    );
    assert.equal(value.global.isHolderRewardEnabled, null);
    assert.equal(value.curve.isHolderReward, null);
    assert.equal(
      value.global.holderRewardClaimAuthority,
      globalLength >= 1086 ? MINT : null,
    );
    assert.equal(value.curve.creator, curveLength >= 81 ? REWARDS : null);
    assert.equal(isHolderConfiguration(value, MINT, REWARDS), true);
  }
});
test("Global records shorter than the oldest valid layout fail closed", async () => {
  const short = data("Global").subarray(0, 1044);
  await assert.rejects(
    read(fixture({ global: account(short) })),
    (error) => error.code === "RPC_RESPONSE_INVALID",
  );

  const value = await read(fixture());
  assert.equal(
    isHolderConfiguration(
      {
        ...value,
        global: {
          status: "decoded",
          dataBytes: short.length,
          isHolderRewardEnabled: null,
          holderRewardClaimAuthority: null,
        },
      },
      MINT,
      REWARDS,
    ),
    false,
  );
});
test("complete physical fields are observed even when newer trailing fields are absent", async () => {
  const value = await read(
    fixture({
      global: account(data("Global").subarray(0, 1087)),
      curve: account(data("BondingCurve").subarray(0, 125)),
    }),
  );
  assert.equal(value.global.isHolderRewardEnabled, true);
  assert.equal(value.curve.isHolderReward, true);
  const zero = await read(
    fixture({
      global: account(data("Global", false)),
      curve: account(data("BondingCurve", false)),
    }),
  );
  assert.equal(zero.global.isHolderRewardEnabled, false);
  assert.equal(zero.curve.isHolderReward, false);
});
test("missing accounts remain distinct from disabled flags", async () => {
  const value = await read(fixture({ global: null, curve: null }));
  assert.deepEqual(value.global, {
    status: "missing",
    dataBytes: null,
    isHolderRewardEnabled: null,
    holderRewardClaimAuthority: null,
  });
  assert.equal(value.curve.status, "missing");
  assert.equal(value.curve.isHolderReward, null);
  assert.equal(value.curve.creatorMatchesHolderRewardsPda, null);
});
test("wrong program, discriminator, executable, malformed/oversized bytes and noncanonical booleans fail closed", async () => {
  const wrongBool = data("Global");
  wrongBool[1086] = 2;
  const bad = [
    { ...account(data("Global")), owner: MINT },
    { ...account(data("Global")), executable: true },
    account(data("BondingCurve")),
    account(Buffer.alloc(7)),
    { ...account(data("Global")), data: ["%%%=", "base64"] },
    { ...account(data("Global")), data: ["AAAA", "base64+zstd"] },
    { ...account(data("Global")), space: 1 },
    { ...account(data("Global")), lamports: "9007199254740993" },
    account(wrongBool),
    account(Buffer.alloc(65_537)),
  ];
  for (const global of bad)
    await assert.rejects(
      read(fixture({ global })),
      (error) => error.code === "RPC_RESPONSE_INVALID",
    );
  await assert.rejects(
    read(fixture({ curve: account(data("BondingCurve").subarray(0, 48)) })),
    (error) => error.code === "RPC_RESPONSE_INVALID",
  );
});
test("cluster, response shape, invalid address and cancellation do not produce partial configuration", async () => {
  await assert.rejects(
    read(fixture({ genesis: "devnet" })),
    (error) => error.code === "WRONG_CLUSTER",
  );
  await assert.rejects(
    readHolderConfigurationWithRpc(
      "invalid",
      async () => assert.fail("must not call RPC"),
      "public-rpc.example",
    ),
    (error) => error.code === "INVALID_ADDRESS",
  );
  const controller = new AbortController();
  controller.abort();
  const f = fixture();
  await assert.rejects(
    read(f, controller.signal),
    (error) => error.name === "AbortError",
  );
  assert.equal(f.calls.length, 0);
  for (const result of [
    { context: { slot: -1 }, value: [] },
    { context: { slot: 1 }, value: [null] },
    { context: { slot: 1 }, value: [null, null, null] },
  ])
    await assert.rejects(
      readHolderConfigurationWithRpc(
        MINT,
        async (method) => (method === "getGenesisHash" ? GENESIS : result),
        "public-rpc.example",
      ),
      (error) => error.code === "RPC_RESPONSE_INVALID",
    );
});
test("client rejects a mismatched mint, default-filled legacy fields and invalid field-presence claims", async () => {
  const value = await read(fixture());
  assert.equal(
    isHolderConfiguration({ ...value, mint: REWARDS }, MINT, REWARDS),
    false,
  );
  assert.equal(
    isHolderConfiguration(
      {
        ...value,
        global: {
          ...value.global,
          dataBytes: 1045,
          isHolderRewardEnabled: false,
        },
      },
      MINT,
      REWARDS,
    ),
    false,
  );
  assert.equal(
    isHolderConfiguration(
      {
        ...value,
        curve: { ...value.curve, creatorMatchesHolderRewardsPda: false },
      },
      MINT,
      REWARDS,
    ),
    false,
  );
});
test("real local HTTP client→actual handler→SDK read pipeline, errors and request privacy", async () => {
  const requests = [],
    f = fixture();
  const server = createServer(async (request, response) => {
    requests.push({
      method: request.method,
      cookie: request.headers.cookie,
      authorization: request.headers.authorization,
    });
    const url = `http://127.0.0.1:${server.address().port}${request.url}`;
    const result = await handleHolderConfiguration(
      new Request(url, { method: request.method }),
      (mint) =>
        readHolderConfigurationWithRpc(mint, f.call, "public-rpc.example"),
    );
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(await result.text());
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const transport = (url, options) => fetch(new URL(url, base), options);
    const value = await readHolderConfiguration(
      MINT,
      REWARDS,
      new AbortController().signal,
      transport,
    );
    assert.equal(value.curve.isHolderReward, true);
    const duplicate = await fetch(
      `${base}/api/holder-rewards/configuration?mint=${MINT}&mint=${MINT}`,
    );
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.headers.get("cache-control"), "no-store");
    assert.ok(
      requests.every(
        (request) =>
          request.method === "GET" &&
          request.cookie === undefined &&
          request.authorization === undefined,
      ),
    );
    const failed = await handleHolderConfiguration(
      new Request(`${base}/api/holder-rewards/configuration?mint=${MINT}`),
      async () => {
        throw new Error("private-provider-body");
      },
    );
    assert.equal(failed.status, 502);
    assert.doesNotMatch(await failed.text(), /private-provider/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
