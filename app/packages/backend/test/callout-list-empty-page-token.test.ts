import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import {
  CalloutsStore,
  type CalloutFacts,
  type CalloutsDataset,
} from "../src/callouts-store.js";

const headers = { authorization: `Bearer pf_live_${"a".repeat(49)}` };
const path = "/v1/callout/list/person";

function facts(): CalloutFacts {
  return {
    calloutId: "callout-a",
    userId: "synthetic-wallet",
    coinMint: "synthetic-mint",
    marketCap: 100,
    calloutPrice: 0,
    calloutPriceUsd: 2,
    multiple: 1,
    createdAt: 0,
    maxPriceSol: 0,
    maxPriceUsd: 2,
    likes: 3,
    repostCount: 2,
    quoteCount: 1,
    updateCount: 20,
    commentCount: 4,
    replyCount: 24,
    maxMultiplier: null,
    maxMultiplierAt: null,
    mediaUrl: null,
    quotedCalloutId: null,
  };
}

function dataset(): CalloutsDataset {
  return {
    schemaVersion: 1,
    dataSource: "synthetic",
    observedAt: "2026-10-29T00:00:00.000Z",
    authors: [
      {
        authorId: "person",
        userName: "Synthetic author",
        profileImage: null,
        isVerified: false,
        verifiedBadgeVisible: false,
        accountKind: "person",
        xUsername: null,
        xFollowerCount: 0,
      },
    ],
    callouts: [
      {
        calloutId: "callout-a",
        authorId: "person",
        hidden: false,
        deleted: false,
        facts: facts(),
      },
    ],
    updates: [],
  };
}

test("explicit empty page tokens fail closed instead of restarting pagination", async () => {
  const app = buildApp([], {
    calloutsStore: new CalloutsStore(dataset()),
  });
  try {
    const firstPage = await app.inject({
      method: "GET",
      url: `${path}?limit=1`,
      headers,
    });
    assert.equal(firstPage.statusCode, 200);
    assert.deepEqual(
      firstPage
        .json()
        .callouts.map((row: { calloutId: string }) => row.calloutId),
      ["callout-a"],
    );

    for (const suffix of ["pageToken=", "pageToken"]) {
      const response = await app.inject({
        method: "GET",
        url: `${path}?limit=1&${suffix}`,
        headers,
      });
      assert.equal(response.statusCode, 400, suffix);
      assert.deepEqual(response.json(), {
        error: "BAD_REQUEST",
        reason: "CALLOUT_LIST_PAGE_TOKEN_INVALID",
      });
    }
  } finally {
    await app.close();
  }
});
