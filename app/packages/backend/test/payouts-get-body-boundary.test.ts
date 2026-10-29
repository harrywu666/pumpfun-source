import test from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { buildApp } from "../src/app.js";
import { PayoutsStore, type PayoutsDataset } from "../src/payouts-store.js";

const authorization = `Bearer pf_live_${"a".repeat(49)}`;
const path = "/v1/payouts/leaderboard";
const now = "2026-10-29T00:00:00.000Z";

function dataset(): PayoutsDataset {
  return {
    schemaVersion: 1,
    dataSource: "synthetic",
    observedAt: now,
    generatedAt: now,
    owners: [],
    payouts: [
      {
        id: "a",
        wallet: "wallet-a",
        amountAtomic: "100000",
        status: "confirmed",
        paidAt: now,
      },
      {
        id: "b",
        wallet: "wallet-b",
        amountAtomic: "200000",
        status: "confirmed",
        paidAt: now,
      },
    ],
    windows: {},
  };
}

function get(
  origin: string,
  body?: string,
  authenticated = true,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      `${origin}${path}?pageSize=1`,
      {
        method: "GET",
        headers: {
          ...(authenticated ? { authorization } : {}),
          ...(body === undefined
            ? {}
            : {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(body),
              }),
        },
      },
      (response) => {
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          resolve({ status: response.statusCode ?? 0, body: responseBody });
        });
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

test("GET payouts rejects unsupported request bodies instead of serving default query state", async () => {
  const app = buildApp([], { payoutsStore: new PayoutsStore(dataset()) });
  try {
    const origin = await app.listen({ host: "127.0.0.1", port: 0 });
    const control = await get(origin);
    assert.equal(control.status, 200);
    assert.equal(JSON.parse(control.body).entries.length, 1);

    for (const body of [
      JSON.stringify({ pageSize: 1, period: "1d" }),
      JSON.stringify({ page: 0 }),
    ]) {
      const response = await get(origin, body);
      assert.equal(response.status, 400, body);
      assert.deepEqual(JSON.parse(response.body), {
        statusCode: 400,
        error: "INVALID_BODY",
      });
    }

    assert.equal(
      (await get(origin, JSON.stringify({ page: 0 }), false)).status,
      401,
    );
  } finally {
    await app.close();
  }
});
