import test from "node:test";
import assert from "node:assert/strict";
import {
  BalanceBatchQueryError,
  PortfolioBalancesStore,
  type PortfolioBalancesDataset,
} from "../src/portfolio-balances-store.js";

const VALID_WALLET = "1".repeat(32);
const NONCANONICAL_WALLET = "1".repeat(33);

function dataset(): PortfolioBalancesDataset {
  return {
    schemaVersion: 1,
    dataSource: "synthetic",
    observedAt: "2026-01-01T00:00:00Z",
    wallets: [{ wallet: VALID_WALLET, balance: null }],
  };
}

test("materialization rejects wallet keys that do not decode to 32 bytes", () => {
  const data = dataset();
  data.wallets[0].wallet = NONCANONICAL_WALLET;

  assert.throws(() => new PortfolioBalancesStore(data), /wallet identity/);
});

test("batch selection rejects wallet keys that do not decode to 32 bytes", () => {
  const store = new PortfolioBalancesStore(dataset());

  assert.throws(
    () => store.batch([NONCANONICAL_WALLET]),
    BalanceBatchQueryError,
  );
});
