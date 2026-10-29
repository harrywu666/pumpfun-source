import assert from "node:assert/strict";
import test from "node:test";
import { GET as readLeaderboard } from "../packages/frontend/src/app/api/leaderboard/route";

test("leaderboard route fails closed when a successful upstream response is not JSON media", async () => {
  const previousKey = process.env.PUMPFUN_DEVELOPER_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.PUMPFUN_DEVELOPER_API_KEY = `pf_live_${"A".repeat(49)}`;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        entries: [
          {
            rank: 1,
            walletAddress: "synthetic-wallet",
            username: null,
            userId: null,
            xUsername: null,
            profileImage: null,
            isVerified: false,
            verifiedBadgeVisible: false,
            pnlSol: 1,
            realizedPnlSol: 1,
            unrealizedPnlSol: 0,
            pnlUsd: 1,
            pnlPercent: 1,
            realizedPnlUsd: 1,
            unrealizedPnlUsd: 0,
            buySpendSol: 1,
            positionsCount: 0,
            lastRefreshedAtMs: 1,
            topPositions: [],
          },
        ],
        periodType: 0,
        periodLabel: "Daily",
        windowStartSec: 1,
      }),
      { headers: { "content-type": "text/html" } },
    );
  try {
    const response = await readLeaderboard(
      new Request(
        "http://localhost/api/leaderboard?category=traders&period=daily&sort=combined",
      ),
    );
    assert.equal(response.status, 502);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = (await response.json()) as {
      ok: boolean;
      error: { code: string };
    };
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "INVALID_UPSTREAM_RESPONSE");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined)
      delete process.env.PUMPFUN_DEVELOPER_API_KEY;
    else process.env.PUMPFUN_DEVELOPER_API_KEY = previousKey;
  }
});
