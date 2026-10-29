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
  BalanceBatchQueryError,
  loadPortfolioBalancesStore,
  PortfolioBalancesStore,
  type PortfolioBalancesDataset,
} from "../src/portfolio-balances-store.js";

// Public-format synthetic identifiers; no wallet connection or ownership claim.
const A = "1".repeat(32),
  B = "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi",
  C = "8qbHbw2BbbTHBW1sbeqakYXVKRQM8Ne7pLK7m6CVfeR",
  UNKNOWN = "CktRuQ2mttgRGkXJtyksdKHjUdc2C4TgDzyB98oEzy8";
const headers = { authorization: `Bearer pf_live_${"A".repeat(49)}` };
const spec = JSON.parse(
  readFileSync(
    new URL("../../../contracts/developer.openapi.json", import.meta.url),
    "utf8",
  ),
);
const responseSchema =
  spec.paths["/portfolio-summary/balances"].post.responses["200"].content[
    "application/json"
  ].schema;
function dataset(): PortfolioBalancesDataset {
  return {
    schemaVersion: 1,
    dataSource: "synthetic",
    observedAt: "2026-01-01T00:00:00Z",
    wallets: [
      {
        wallet: A,
        balance: {
          totalValueUsd: 12.5,
          solPriceUsd: null,
          nativeBalanceSol: 0,
        },
      },
      {
        wallet: B,
        balance: {
          totalValueUsd: null,
          solPriceUsd: 100,
          nativeBalanceSol: null,
        },
      },
      { wallet: C, balance: null },
    ],
  };
}
function appFor(data = dataset()) {
  return buildApp([], {
    portfolioBalancesStore: new PortfolioBalancesStore(data),
  });
}

test("batch returns every requested identity, collapses duplicate keys and distinguishes unavailable/null/zero", () => {
  const store = new PortfolioBalancesStore(dataset());
  const result = store.batch([A, C, B, UNKNOWN, A]);
  assertSchema(result, responseSchema, "$", spec);
  assert.deepEqual(Object.keys(result.wallets), [A, C, B, UNKNOWN]);
  assert.deepEqual(result.wallets[A], {
    totalValueUsd: 12.5,
    solPriceUsd: null,
    nativeBalanceSol: 0,
    perpCashUsd: null,
  });
  assert.deepEqual(result.wallets[B], {
    totalValueUsd: null,
    solPriceUsd: 100,
    nativeBalanceSol: null,
    perpCashUsd: null,
  });
  assert.equal(result.wallets[C], null);
  assert.equal(result.wallets[UNKNOWN], null);
  assert.equal(Object.keys(store.batch(Array(50).fill(A)).wallets).length, 1);
});

test("caller input and result mutation cannot change the fixed snapshot", () => {
  const data = dataset();
  const store = new PortfolioBalancesStore(data);
  data.wallets[0].balance!.totalValueUsd = 999;
  const row = store.batch([A]).wallets[A]!;
  row.totalValueUsd = 123;
  assert.equal(store.batch([A]).wallets[A]!.totalValueUsd, 12.5);
});

test("programmatic batch validation enforces the 1–50/Solana wallet boundary", () => {
  const store = new PortfolioBalancesStore(dataset());
  for (const value of [
    [],
    Array(51).fill(A),
    ["0".repeat(32)],
    ["1".repeat(31)],
    ["1".repeat(45)],
    [null],
    new Array(1),
    null,
  ]) {
    assert.throws(() => store.batch(value as string[]), BalanceBatchQueryError);
  }
});

test("real HTTP preserves public API projection regardless of owner-only flags", async () => {
  const app = appFor();
  try {
    const origin = await app.listen({ host: "127.0.0.1", port: 0 });
    for (const options of [
      {},
      { fresh: true },
      { holdings: true },
      { fresh: true, holdings: true },
    ]) {
      const response = await fetch(`${origin}/v1/portfolio-summary/balances`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ wallets: [A, B, C, UNKNOWN], ...options }),
      });
      assert.equal(response.status, 200);
      assert.equal(
        response.headers.get("x-reconstruction-data-source"),
        "synthetic",
      );
      assert.equal(
        response.headers.get("x-reconstruction-observed-at"),
        dataset().observedAt,
      );
      assert.equal(
        response.headers.get("x-reconstruction-compatibility"),
        "unqualified",
      );
      const result = await response.json();
      assertSchema(result, responseSchema, "$", spec);
      assert.deepEqual(Object.keys(result.wallets), [A, B, C, UNKNOWN]);
      for (const row of Object.values(result.wallets) as Array<Record<
        string,
        unknown
      > | null>) {
        if (row !== null) {
          assert.equal(row.perpCashUsd, null);
          assert.equal(Object.hasOwn(row, "holdings"), false);
        }
      }
    }
  } finally {
    await app.close();
  }
});

test("file change is not an API-host fresh privilege; restart explicitly imports the next snapshot", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pump-balances-"));
  const file = join(dir, "balances.json");
  writeFileSync(file, JSON.stringify(dataset()));
  let app = buildApp([], {
    portfolioBalancesStore: loadPortfolioBalancesStore(file),
  });
  try {
    let origin = await app.listen({ host: "127.0.0.1", port: 0 });
    const changed = dataset();
    changed.observedAt = "2026-01-02T00:00:00Z";
    changed.wallets[0].balance!.totalValueUsd = 20;
    writeFileSync(file, JSON.stringify(changed));
    const read = async () =>
      fetch(`${origin}/v1/portfolio-summary/balances`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ wallets: [A], fresh: true, holdings: true }),
      });
    const old = await read();
    assert.equal((await old.json()).wallets[A].totalValueUsd, 12.5);
    assert.equal(
      old.headers.get("x-reconstruction-observed-at"),
      dataset().observedAt,
    );
    await app.close();
    app = buildApp([], {
      portfolioBalancesStore: loadPortfolioBalancesStore(file),
    });
    origin = await app.listen({ host: "127.0.0.1", port: 0 });
    const next = await read();
    assert.equal((await next.json()).wallets[A].totalValueUsd, 20);
    assert.equal(
      next.headers.get("x-reconstruction-observed-at"),
      changed.observedAt,
    );
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("HTTP rejects malformed payloads/selections and retains the inherited key gate", async () => {
  const app = appFor();
  try {
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/v1/portfolio-summary/balances",
          payload: { wallets: [A] },
        })
      ).statusCode,
      401,
    );
    for (const payload of [
      null,
      [],
      {},
      { wallets: [] },
      { wallets: Array(51).fill(A) },
      { wallets: ["bad"] },
      { wallets: [A], fresh: "true" },
      { wallets: [A], holdings: 1 },
      { wallets: [A], owner: A },
    ]) {
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/v1/portfolio-summary/balances",
            headers: { ...headers, "content-type": "application/json" },
            payload: JSON.stringify(payload),
          })
        ).statusCode,
        400,
      );
    }
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/v1/portfolio-summary/balances?wallets=other",
          headers,
          payload: { wallets: [A] },
        })
      ).statusCode,
      400,
    );
  } finally {
    await app.close();
  }
});

test("default app still returns501; a materialization enables only this route", async () => {
  const fallback = buildApp();
  const enabled = appFor();
  try {
    const request = {
      method: "POST" as const,
      url: "/v1/portfolio-summary/balances",
      headers,
      payload: { wallets: [A] },
    };
    assert.equal((await fallback.inject(request)).statusCode, 501);
    assert.equal((await enabled.inject(request)).statusCode, 200);
    assert.equal(
      (
        await enabled.inject({
          url: `/v1/portfolio-summary?user=${A}`,
          headers,
        })
      ).statusCode,
      501,
    );
  } finally {
    await fallback.close();
    await enabled.close();
  }
});

test("admission rejects duplicate identities, private fields, missing/undefined facts and invalid provenance", () => {
  const mutate: Array<(data: PortfolioBalancesDataset) => void> = [
    (data) => {
      data.wallets.push(structuredClone(data.wallets[0]));
    },
    (data) => {
      data.wallets[0].wallet = "invalid";
    },
    (data) => {
      (data.wallets[0].balance as any).perpCashUsd = 123;
    },
    (data) => {
      (data.wallets[0].balance as any).holdings = [];
    },
    (data) => {
      delete (data.wallets[0].balance as any).solPriceUsd;
    },
    (data) => {
      (data.wallets[0].balance as any).totalValueUsd = undefined;
    },
    (data) => {
      data.wallets[0].balance!.totalValueUsd = Infinity;
    },
    (data) => {
      data.observedAt = "2026-02-30T00:00:00Z";
    },
    (data) => {
      (data as any).dataSource = "upstream-verified";
    },
  ];
  for (const change of mutate) {
    const data = dataset();
    change(data);
    assert.throws(() => new PortfolioBalancesStore(data));
  }
});

test("bounded startup import rejects corruption, oversized/nonregular and invalidUTF8 input", () => {
  const dir = mkdtempSync(join(tmpdir(), "pump-balance-load-"));
  const file = join(dir, "balances.json");
  try {
    writeFileSync(file, "{");
    assert.throws(() => loadPortfolioBalancesStore(file));
    writeFileSync(file, Buffer.from([0xff]));
    assert.throws(() => loadPortfolioBalancesStore(file));
    writeFileSync(file, "");
    truncateSync(file, 16 * 1024 * 1024 + 1);
    assert.throws(() => loadPortfolioBalancesStore(file), /16MiB/);
    assert.throws(() => loadPortfolioBalancesStore(dir), /regular file/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('materialized public balance facts reject negatives without collapsing null and zero', () => {
  for (const field of ['totalValueUsd', 'solPriceUsd', 'nativeBalanceSol'] as const) {
    const data = dataset(); data.wallets[0].balance![field] = -0.01;
    assert.throws(() => new PortfolioBalancesStore(data), /balance/);
  }
  assert.doesNotThrow(() => new PortfolioBalancesStore(dataset()));
});
