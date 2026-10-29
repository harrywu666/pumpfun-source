import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app.js";
import { assertSchema } from "../src/schema-validator.js";
import {
  loadUserTradesStore,
  UserTradesStore,
  TradesQueryError,
  type TradeFacts,
  type UserTradesDataset,
} from "../src/user-trades-store.js";

const SOLANA = 1399811149;
const API_KEY = `pf_live_${"A".repeat(49)}`; // Synthetic shape, not an actual credential.
const headers = { authorization: `Bearer ${API_KEY}` };
const sid = (value: number) => String(value).padStart(26, "0");
const spec = JSON.parse(
  readFileSync(
    new URL("../../../contracts/developer.openapi.json", import.meta.url),
    "utf8",
  ),
);
const schema =
  spec.paths["/user-trades/{id}"].get.responses["200"].content[
    "application/json"
  ].schema;

export function dataset(): UserTradesDataset {
  const facts = (
    value: number,
    extra: Partial<TradeFacts> = {},
  ): TradeFacts => ({
    tx: "synthetic-multi-fill",
    isBuy: true,
    timestamp: "2026-01-01T00:00:03Z",
    amountUsd: 3.25,
    baseAmount: 10,
    priceUsd: 0.325,
    mint: "same-mint",
    chainId: SOLANA,
    walletAddress: "sol-a",
    userId: "person-a",
    slotIndexId: sid(value),
    amountSol: 0.02,
    ...extra,
  });
  return {
    schemaVersion: 1,
    dataSource: "synthetic",
    observedAt: "2026-01-01T01:00:00Z",
    users: [
      { id: "person-a", aliases: ["alias-a"] },
      { id: "person-b", aliases: [] },
      { id: "empty-person", aliases: [] },
    ],
    wallets: [
      { address: "sol-a", chainId: SOLANA, userId: "person-a" },
      { address: "evm-a", chainId: 8453, userId: "person-a" },
      { address: "sol-b", chainId: SOLANA, userId: "person-b" },
      { address: "unregistered", chainId: SOLANA, userId: null },
      { address: "empty-wallet", chainId: SOLANA, userId: null },
    ],
    rows: [
      { kind: "trade", facts: facts(11) },
      { kind: "trade", facts: facts(12, { isBuy: false }) },
      {
        kind: "transfer",
        facts: facts(13, {
          timestamp: "2026-01-01T00:00:04Z",
          amountUsd: null,
          priceUsd: null,
          amountSol: null,
        }),
      },
      {
        kind: "trade",
        facts: facts(14, {
          walletAddress: "evm-a",
          chainId: 8453,
          timestamp: "2026-01-01T00:00:05Z",
          amountUsd: null,
          priceUsd: null,
          amountSol: null,
        }),
      },
      {
        kind: "trade",
        facts: facts(15, {
          walletAddress: "sol-b",
          userId: "person-b",
          timestamp: "2026-01-01T00:00:06Z",
          mint: "other-mint",
        }),
      },
      {
        kind: "trade",
        facts: facts(16, {
          walletAddress: "unregistered",
          userId: null,
          timestamp: null,
          mint: "unknown-metadata",
        }),
      },
    ],
    coins: [
      {
        mint: "same-mint",
        chainId: SOLANA,
        name: "Synthetic Solana coin",
        symbol: null,
        image: null,
      },
      {
        mint: "same-mint",
        chainId: 8453,
        name: "Synthetic EVM coin",
        symbol: "EXAMPLE",
        image: null,
      },
      {
        mint: "other-mint",
        chainId: SOLANA,
        name: "Other subject coin",
        symbol: null,
        image: null,
      },
    ],
    traders: [
      {
        userId: "person-a",
        userName: "Synthetic A",
        walletAddress: "sol-a",
        profileImage: null,
        isVerified: false,
        verifiedBadgeVisible: false,
      },
      {
        userId: "person-b",
        userName: "Synthetic B",
        walletAddress: "sol-b",
        profileImage: null,
        isVerified: true,
        verifiedBadgeVisible: false,
      },
    ],
  };
}

function appFor(data: unknown = dataset()) {
  return buildApp([], { userTradesStore: new UserTradesStore(data) });
}

test("person reads join only canonical wallets; raw wallet is narrower and multi-fill tx rows survive", () => {
  const store = new UserTradesStore(dataset());
  const result = store.page("person-a")!;
  assertSchema(result, schema, "$", spec);
  assert.deepEqual(
    result.trades.map((row) => row.slotIndexId),
    [sid(14), sid(12), sid(11)],
  );
  assert.equal(new Set(result.trades.map((row) => row.tx)).size, 1);
  assert.deepEqual(
    store.page("sol-a")!.trades.map((row) => row.slotIndexId),
    [sid(12), sid(11)],
  );
  assert.deepEqual(store.page("alias-a"), result);
  assert.deepEqual(
    result.coins.map((coin) => coin.name),
    ["Synthetic EVM coin", "Synthetic Solana coin"],
  );
  assert.deepEqual(
    result.traders.map((profile) => profile.userId),
    ["person-a"],
  );
  assert.equal(result.trades[0].amountUsd, null);
  assert.equal(result.trades[0].priceUsd, null);
  assert.equal(result.trades[0].amountSol, null);
  assert.ok(result.trades.every((row) => !Object.hasOwn(row, "kind")));
});

test("explicit trade/transfer selection projects kind and preserves each independently unknown value", () => {
  const store = new UserTradesStore(dataset());
  const all = store.page("person-a", { types: ["transfers", "trades"] })!;
  assertSchema(all, schema, "$", spec);
  assert.deepEqual(
    all.trades.map((row) => row.kind),
    ["trade", "transfer", "trade", "trade"],
  );
  const transfers = store.page("person-a", { types: ["transfers"] })!;
  assert.equal(transfers.trades.length, 1);
  assert.equal(transfers.trades[0].amountUsd, null);
  assert.equal(transfers.trades[0].baseAmount, 10);
  assert.equal(transfers.trades[0].kind, "transfer");
  assert.equal(
    store.page("person-a", { types: ["trades"] })!.trades[0].kind,
    "trade",
  );
});

test("keyset cursor keeps same-second fills and is bound to materialization, identity and filters", () => {
  const store = new UserTradesStore(dataset());
  const first = store.page("person-a", { limit: 1 })!;
  assert.equal(first.trades[0].slotIndexId, sid(14));
  assert.ok(first.nextCursor);
  const second = store.page("alias-a", { limit: 1, cursor: first.nextCursor })!;
  const third = store.page("person-a", {
    limit: 200,
    cursor: second.nextCursor!,
  })!;
  assert.deepEqual(
    second.trades.map((row) => row.slotIndexId),
    [sid(12)],
  );
  assert.deepEqual(
    third.trades.map((row) => row.slotIndexId),
    [sid(11)],
  );
  assert.equal(third.nextCursor, null);
  for (const opts of [
    { mint: "same-mint" },
    { chainId: SOLANA },
    { types: ["trades"] as const },
  ]) {
    assert.throws(
      () =>
        store.page("person-a", {
          ...opts,
          types: opts.types ? [...opts.types] : undefined,
          cursor: first.nextCursor!,
        }),
      TradesQueryError,
    );
  }
  assert.throws(
    () => store.page("sol-a", { cursor: first.nextCursor! }),
    TradesQueryError,
  );
  const changed = dataset();
  changed.observedAt = "2026-01-01T02:00:00Z";
  assert.throws(
    () =>
      new UserTradesStore(changed).page("person-a", {
        cursor: first.nextCursor!,
      }),
    TradesQueryError,
  );
  for (const cursor of [
    "",
    "!",
    `${first.nextCursor}=`,
    Buffer.from('{"v":1}').toString("base64url"),
    "a".repeat(2049),
  ])
    assert.throws(() => store.page("person-a", { cursor }), TradesQueryError);
});

test("cursor decoding rejects a UTF-8 BOM added to a valid payload", () => {
  const store = new UserTradesStore(dataset());
  const cursor = store.page("person-a", { limit: 1 }).nextCursor!;
  const body = Buffer.from(cursor, "base64url");
  const bomCursor = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    body,
  ]).toString("base64url");
  assert.throws(
    () => store.page("person-a", { limit: 1, cursor: bomCursor }),
    TradesQueryError,
  );
});

test("chain-keyed identities and metadata never collapse same mint/slot across chains", () => {
  const data = dataset();
  data.rows[3].facts.slotIndexId = sid(12);
  data.rows[3].facts.timestamp = data.rows[1].facts.timestamp;
  const store = new UserTradesStore(data);
  const result = store.page("person-a", { mint: "same-mint", chainId: 8453 })!;
  assert.equal(result.trades.length, 1);
  assert.deepEqual(
    result.coins.map((row) => row.chainId),
    [8453],
  );
  assert.equal(store.page("person-a")!.trades.length, 3);
  const unknown = store.page("unregistered")!;
  assert.equal(unknown.trades[0].userId, null);
  assert.equal(unknown.trades[0].timestamp, null);
  assert.deepEqual(unknown.coins, []);
  assert.deepEqual(unknown.traders, []);
});

test("known empty identities differ from unknown, and inputs/results cannot mutate stored facts", () => {
  const data = dataset();
  const store = new UserTradesStore(data);
  data.rows[0].facts.amountUsd = 999;
  const empty = { trades: [], traders: [], coins: [], nextCursor: null };
  assert.deepEqual(store.page("empty-wallet"), empty);
  assert.deepEqual(store.page("empty-person"), empty);
  assert.equal(store.page("missing-person"), null);
  const result = store.page("sol-a")!;
  result.trades[1].amountUsd = 123;
  result.coins[0].name = "changed";
  assert.equal(store.page("sol-a")!.trades[1].amountUsd, 3.25);
  assert.equal(store.page("sol-a")!.coins[0].name, "Synthetic Solana coin");
});

test("real HTTP serves schema-conforming pages and retains cursor across a file reload/restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pump-trades-"));
  const file = join(dir, "trades.json");
  writeFileSync(file, JSON.stringify(dataset()));
  let app = buildApp([], { userTradesStore: loadUserTradesStore(file) });
  try {
    let origin = await app.listen({ host: "127.0.0.1", port: 0 });
    const first = await fetch(`${origin}/v1/user-trades/person-a?limit=1`, {
      headers,
    });
    assert.equal(first.status, 200);
    assert.equal(
      first.headers.get("x-reconstruction-data-source"),
      "synthetic",
    );
    assert.equal(
      first.headers.get("x-reconstruction-observed-at"),
      dataset().observedAt,
    );
    assert.equal(
      first.headers.get("x-reconstruction-compatibility"),
      "unqualified",
    );
    const body = await first.json();
    assertSchema(body, schema, "$", spec);
    await app.close();
    app = buildApp([], { userTradesStore: loadUserTradesStore(file) });
    origin = await app.listen({ host: "127.0.0.1", port: 0 });
    const second = await fetch(
      `${origin}/v1/user-trades/person-a?limit=2&cursor=${body.nextCursor}`,
      { headers },
    );
    assert.equal(second.status, 200);
    const page = await second.json();
    assertSchema(page, schema, "$", spec);
    assert.deepEqual(
      page.trades.map((row: UserTradeResult) => row.slotIndexId),
      [sid(12), sid(11)],
    );
    assert.equal(page.nextCursor, null);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
type UserTradeResult = { slotIndexId: string };

test("HTTP validation and inherited auth precede serving; unmodeled chain lanes stay explicit", async () => {
  const app = appFor();
  try {
    assert.equal(
      (await app.inject("/v1/user-trades/person-a?limit=bad")).statusCode,
      401,
    );
    for (const query of [
      "limit=0",
      "limit=201",
      "limit=1.5",
      "limit=",
      "chainId=9007199254740992",
      "limit=1&limit=2",
      "types=trades,other",
      "types=trades,transfers,trades",
      "cursor=bad",
      "unbound=1",
    ]) {
      assert.equal(
        (
          await app.inject({
            url: `/v1/user-trades/person-a?${query}`,
            headers,
          })
        ).statusCode,
        400,
        query,
      );
    }
    assert.equal(
      (
        await app.inject({
          url: "/v1/user-trades/person-a?chain=near:mainnet",
          headers,
        })
      ).statusCode,
      501,
    );
    assert.equal(
      (await app.inject({ url: "/v1/user-trades/missing", headers }))
        .statusCode,
      404,
    );
  } finally {
    await app.close();
  }
});

test("opt-in native history wins over fixtures; absent materialization preserves harness", async () => {
  const fixtures = [
    {
      method: "GET",
      path: "/v1/user-trades/person-a",
      status: 200,
      body: { syntheticReplay: true },
      source: "synthetic fixture for separation test",
    },
  ];
  const fallback = buildApp(fixtures);
  const native = buildApp(fixtures, {
    userTradesStore: new UserTradesStore(dataset()),
  });
  try {
    assert.deepEqual(
      (
        await fallback.inject({ url: "/v1/user-trades/person-a", headers })
      ).json(),
      { syntheticReplay: true },
    );
    const result = await native.inject({
      url: "/v1/user-trades/person-a",
      headers,
    });
    assert.equal(result.statusCode, 200);
    assertSchema(result.json(), schema, "$", spec);
  } finally {
    await fallback.close();
    await native.close();
  }
});

test("materialization admission rejects ambiguous identity, duplicate fills, private/unsupported data and invalid dates", () => {
  const mutations: Array<(data: UserTradesDataset) => void> = [
    (data) => {
      data.users[1].aliases.push("alias-a");
    },
    (data) => {
      data.users[0].aliases.push("sol-a");
    },
    (data) => {
      data.wallets[0].userId = "missing";
    },
    (data) => {
      data.rows.push(structuredClone(data.rows[0]));
    },
    (data) => {
      data.rows[0].facts.slotIndexId = "1";
    },
    (data) => {
      data.rows[0].facts.userId = "person-b";
    },
    (data) => {
      data.traders = data.traders.filter((row) => row.userId !== "person-a");
    },
    (data) => {
      data.rows[0].facts.timestamp = "2026-02-30T00:00:00Z";
    },
    (data) => {
      data.rows[0].facts.amountUsd = Infinity;
    },
    (data) => {
      (data.rows[0].facts as any).kind = "trade";
    },
    (data) => {
      (data.rows[0].facts as any).collectible = {};
    },
    (data) => {
      (data.traders[0] as any).hasLiked = true;
    },
    (data) => {
      data.coins.push(structuredClone(data.coins[0]));
    },
    (data) => {
      data.wallets[0].chainId = 0;
    },
    (data) => {
      data.observedAt = "not-an-instant";
    },
  ];
  for (const mutate of mutations) {
    const data = dataset();
    mutate(data);
    assert.throws(() => new UserTradesStore(data));
  }
});

test("startup loader fails closed on corrupt/oversize/nonregular/non-UTF8 sources", () => {
  const dir = mkdtempSync(join(tmpdir(), "pump-trades-load-"));
  const file = join(dir, "trades.json");
  try {
    writeFileSync(file, "{");
    assert.throws(() => loadUserTradesStore(file));
    writeFileSync(file, Buffer.from([0xff]));
    assert.throws(() => loadUserTradesStore(file));
    writeFileSync(file, "");
    truncateSync(file, 16 * 1024 * 1024 + 1);
    assert.throws(() => loadUserTradesStore(file), /16MiB/);
    assert.throws(() => loadUserTradesStore(dir), /regular file/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('startup refuses sparse arrays instead of indexing missing aliases', () => {
  for (const mutate of [
    (data: UserTradesDataset) => { data.users[0].aliases = new Array(1); },
    (data: UserTradesDataset) => { data.users[0].aliases = ['alias-a', 'second-alias']; delete data.users[0].aliases[0]; },
    (data: UserTradesDataset) => { data.users[0].aliases = ['alias-a', 'second-alias']; delete data.users[0].aliases[1]; },
  ]) {
    const data = dataset(); mutate(data);
    assert.throws(() => new UserTradesStore(data), /plain JSON|materialization|contract/);
  }
  assert.doesNotThrow(() => new UserTradesStore(dataset()));
});

test('trade-kind query arrays cannot contain absent elements',()=>{
  const store=new UserTradesStore(dataset());const types=new Array(1);
  assert.throws(()=>store.page('person-a',{types}),TradesQueryError);
  assert.doesNotThrow(()=>store.page('person-a',{types:['trades','transfers']}));
});

test('materialized trade executions cannot be newer than their observation checkpoint',()=>{
  const data=dataset();data.rows[0].facts.timestamp='2026-01-02T00:00:00Z';
  assert.throws(()=>new UserTradesStore(data),/observedAt/);
  const unknown=dataset();unknown.rows[0].facts.timestamp=null;assert.doesNotThrow(()=>new UserTradesStore(unknown));
});
