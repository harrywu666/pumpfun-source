import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { buildApp } from "../src/app.js";
import { PortfolioBalancesStore } from "../src/portfolio-balances-store.js";

const wallet = "1".repeat(32);
const apiKey = `pf_live_${"A".repeat(49)}`;
const payload = JSON.stringify({ wallets: [wallet] });

async function postAs(t: TestContext, contentType: string) {
  const app = buildApp([], {
    portfolioBalancesStore: new PortfolioBalancesStore({
      schemaVersion: 1,
      dataSource: "synthetic",
      observedAt: "2026-01-01T00:00:00Z",
      wallets: [],
    }),
  });
  t.after(() => app.close());
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  return fetch(`${origin}/v1/portfolio-summary/balances`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": contentType,
    },
    body: payload,
  });
}

test("balance batches reject JSON text sent as text/plain", async (t) => {
  const text = await postAs(t, "text/plain; charset=utf-8");
  assert.equal(text.status, 415);
  assert.equal((await text.json()).statusCode, 415);
});

test("balance batches reject JSON bodies declared with a non-UTF-8 charset", async (t) => {
  const nonUtf8 = await postAs(t, "application/json; charset=iso-8859-1");
  assert.equal(nonUtf8.status, 415);
  assert.equal((await nonUtf8.json()).statusCode, 415);
});

test("balance batches retain the declared JSON UTF-8 media type", async (t) => {
  const supported = await postAs(t, "application/json; charset=utf-8");
  assert.equal(supported.status, 200);
});
