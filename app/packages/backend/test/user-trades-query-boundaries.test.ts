import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import {
  UserTradesStore,
  type UserTradesDataset,
} from "../src/user-trades-store.js";

const API_KEY = `pf_live_${"A".repeat(49)}`;
const headers = { authorization: `Bearer ${API_KEY}` };

function dataset(): UserTradesDataset {
  return {
    schemaVersion: 1,
    dataSource: "synthetic",
    observedAt: "2026-01-01T01:00:00Z",
    users: [],
    wallets: [{ address: "wallet-a", chainId: 1399811149, userId: null }],
    rows: [
      {
        kind: "trade",
        facts: {
          tx: "tx-a",
          isBuy: true,
          timestamp: "2026-01-01T00:00:00Z",
          amountUsd: null,
          baseAmount: null,
          priceUsd: null,
          mint: "mint-a",
          chainId: 1399811149,
          walletAddress: "wallet-a",
          userId: null,
          slotIndexId: "00000000000000000000000001",
          amountSol: null,
        },
      },
    ],
    coins: [],
    traders: [],
  };
}

test("types= is the contract's empty kind selection, not one empty item", async () => {
  const app = buildApp([], { userTradesStore: new UserTradesStore(dataset()) });
  try {
    const response = await app.inject({
      url: "/v1/user-trades/wallet-a?types=",
      headers,
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      trades: [],
      traders: [],
      coins: [],
      nextCursor: null,
    });

    for (const query of ["types=,", "types=trades,", "types=,trades"]) {
      const invalid = await app.inject({
        url: `/v1/user-trades/wallet-a?${query}`,
        headers,
      });
      assert.equal(invalid.statusCode, 400, query);
    }
  } finally {
    await app.close();
  }
});
