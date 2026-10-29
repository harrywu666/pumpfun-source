import assert from "node:assert/strict";
import test from "node:test";
import {
  NATIVE_FEED_LIVE_SUBJECT,
  NativeFeedDataError,
  validateNativeCursorInput,
  validateNativeFeedPage,
  validateNativeNewCount,
} from "../packages/frontend/src/components/feed/native-feed-data.ts";

const TOKEN = "eyJ2IjoxLCJrIjoicmFuayJ9.ABCD_efgh-1234";

function coin(id = "00000000-0000-4000-8000-000000000001") {
  return {
    coinMint: "LOCAL_EXAMPLE_MINT_001",
    coinName: "Local Example Alpha",
    coinImage: null,
    symbol: "LXA",
    marketCap: 125_000,
    chain: "solana",
    position: {
      userId: "local-example-author-a",
      userName: "Local Example Author A",
      profileImage: null,
      walletAddress: null,
      isVerified: false,
      verifiedBadgeVisible: false,
      costBasisUsd: 2_500,
      contentKind: "callout",
      callout: {
        calloutId: id,
        chain: "solana",
        assetClass: "ASSET_CLASS_TOKEN",
        calledOutAtMcap: 100_000,
        multiple: 1.25,
        thesis: "Synthetic local callout for frontend validation.",
        mediaUrl: null,
        calloutTimestamp: "2026-10-28T11:55:00.000Z",
      },
    },
  };
}

test("validates ranked and newest local response projections", () => {
  const ranked = validateNativeFeedPage(
    { coins: [coin()], nextPageToken: TOKEN },
    "ranked",
  );
  assert.equal(ranked.coins[0].authorName, "Local Example Author A");
  assert.equal(ranked.coins[0].multiple, 1.25);
  assert.equal(ranked.nextPageToken, TOKEN);

  const newest = validateNativeFeedPage(
    {
      coins: [coin()],
      nextPageToken: TOKEN,
      headToken: TOKEN,
      liveSubject: NATIVE_FEED_LIVE_SUBJECT,
    },
    "newest",
  );
  assert.equal(newest.headToken, TOKEN);
  assert.equal(newest.liveSubject, NATIVE_FEED_LIVE_SUBJECT);
});

test("validates the bounded local snapshot count", () => {
  assert.deepEqual(
    validateNativeNewCount({ newCount: 2, capped: false, headToken: TOKEN }),
    { newCount: 2, capped: false, headToken: TOKEN },
  );
  assert.throws(
    () =>
      validateNativeNewCount({ newCount: 26, capped: true, headToken: TOKEN }),
    NativeFeedDataError,
  );
});

test("rejects duplicate callout identities and unbounded arrays", () => {
  assert.throws(
    () => validateNativeFeedPage({ coins: [coin(), coin()] }, "ranked"),
    /repeats a callout identity/,
  );
  assert.throws(
    () =>
      validateNativeFeedPage(
        {
          coins: Array.from({ length: 51 }, (_, index) => coin(String(index))),
        },
        "ranked",
      ),
    /bounded array/,
  );
});

test("rejects unsafe strings, non-finite values and invented verification", () => {
  const unsafe = coin();
  unsafe.position.callout.thesis = "unsafe\u0000text";
  assert.throws(
    () => validateNativeFeedPage({ coins: [unsafe] }, "ranked"),
    /bounded safe string/,
  );

  const nonfinite = coin();
  nonfinite.marketCap = Number.POSITIVE_INFINITY;
  assert.throws(
    () => validateNativeFeedPage({ coins: [nonfinite] }, "ranked"),
    /finite non-negative number/,
  );

  const verified = coin();
  verified.position.isVerified = true;
  assert.throws(
    () => validateNativeFeedPage({ coins: [verified] }, "ranked"),
    /must not invent a verified author/,
  );
});

test("counts string limits in Unicode code points", () => {
  const thesis = "🚀".repeat(2_000);
  const atLimit = coin();
  atLimit.position.callout.thesis = thesis;
  assert.equal(thesis.length, 4_000);
  assert.equal([...thesis].length, 2_000);
  assert.equal(
    validateNativeFeedPage({ coins: [atLimit] }, "ranked").coins[0].thesis,
    thesis,
  );

  const overLimit = coin();
  overLimit.position.callout.thesis = "🚀".repeat(2_001);
  assert.throws(
    () => validateNativeFeedPage({ coins: [overLimit] }, "ranked"),
    /bounded safe string/,
  );
});

test("requires unavailable media and identity fields to remain null", () => {
  const external = coin();
  external.coinImage = "https://example.com/token.png" as never;
  assert.throws(
    () => validateNativeFeedPage({ coins: [external] }, "ranked"),
    /must remain unavailable/,
  );

  const wallet = coin();
  wallet.position.walletAddress = "invented-wallet" as never;
  assert.throws(
    () => validateNativeFeedPage({ coins: [wallet] }, "ranked"),
    /must remain unavailable/,
  );
});

test("treats cursors as opaque bounded tokens without decoding them", () => {
  assert.equal(validateNativeCursorInput(TOKEN, "cursor"), TOKEN);
  assert.equal(validateNativeCursorInput(undefined, "cursor"), undefined);
  for (const value of ["", "not a cursor", "a.b.c", "x".repeat(513)]) {
    assert.throws(
      () => validateNativeCursorInput(value, "cursor"),
      NativeFeedDataError,
    );
  }
});

test("rejects malformed response envelopes and realtime claims", () => {
  assert.throws(
    () => validateNativeFeedPage({ coins: [], unexpected: true }, "ranked"),
    /unexpected/,
  );
  assert.throws(
    () =>
      validateNativeFeedPage(
        { coins: [], headToken: null, liveSubject: "live.production" },
        "newest",
      ),
    /unavailable boundary/,
  );
});
