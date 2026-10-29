import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildApp, type Fixture } from "../src/app.js";
import { CalloutsStore, type CalloutsDataset } from "../src/callouts-store.js";
import { assertSchema } from "../src/schema-validator.js";
const headers = { authorization: `Bearer pf_live_${"a".repeat(49)}` };
const path = "/v1/callout/user/author/mint/mint";
const spec = JSON.parse(
  readFileSync(
    new URL("../../../contracts/developer.openapi.json", import.meta.url),
    "utf8",
  ),
);
const schema =
  spec.paths["/callout/user/{userId}/mint/{coinMint}"].get.responses[200]
    .content["application/json"].schema;
function dataset(): CalloutsDataset {
  const author = {
    authorId: "author",
    userName: "Synthetic author",
    profileImage: null,
    isVerified: false,
    verifiedBadgeVisible: false,
    accountKind: "person" as const,
    xUsername: null,
    xFollowerCount: 0,
  };
  return {
    schemaVersion: 1,
    dataSource: "synthetic",
    observedAt: "2026-10-29T00:00:00.000Z",
    authors: [author, { ...author, authorId: "group", accountKind: "group" }],
    callouts: [
      {
        calloutId: "a",
        authorId: "author",
        hidden: false,
        deleted: false,
        facts: {
          calloutId: "a",
          userId: "posting-wallet",
          coinMint: "mint",
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
          updateCount: 1,
          commentCount: 0,
          replyCount: 1,
          maxMultiplier: null,
          maxMultiplierAt: null,
          mediaUrl: null,
          quotedCalloutId: null,
        },
      },
    ],
    updates: [
      {
        calloutId: "a",
        authorId: "author",
        hidden: false,
        deleted: false,
        body: {
          id: "update",
          content: "Synthetic update",
          createdAt: null,
          likeCount: 0,
          mediaUrl: null,
          parentMessageId: null,
          repostCount: 0,
        },
      },
    ],
  };
}

test("configured user/mint lookup returns the exact legacy DTO and no carousel by default or zero", async () => {
  const data = dataset();
  Object.assign(data.callouts[0].facts!, {
    quotedCalloutId: "q",
    viewCount: 0,
    mediaTranscript: "",
    assetClass: "ASSET_CLASS_TOKEN",
    chain: null,
  });
  const target = structuredClone(data.callouts[0]);
  target.calloutId = "q";
  target.authorId = "group";
  Object.assign(target.facts!, {
    calloutId: "q",
    coinMint: "other",
    quotedCalloutId: null,
  });
  target.quoteFacts = {
    calloutId: "q",
    calledOutAtMcap: 120,
    multiple: 1,
    thesis: null,
    mediaUrl: null,
    calloutTimestamp: data.observedAt,
    likes: 0,
    updateCount: 0,
    commentCount: 0,
    replyCount: 0,
    maxMultiplier: null,
    maxMultiplierAt: null,
    calloutPrice: 2,
    repostCount: 0,
    quoteCount: 0,
    actingUserId: null,
    actingUser: null,
  };
  data.callouts.push(target);
  const store = new CalloutsStore(data);
  const app = buildApp([], { calloutsStore: store });
  try {
    for (const suffix of ["", "?quotesLimit=0"]) {
      const result = await app.inject({ url: path + suffix, headers });
      assert.equal(result.statusCode, 200);
      const body = result.json();
      assertSchema(body, schema, "user/mint lookup", spec);
      assert.deepEqual(Object.keys(body).sort(), ["callout", "quotes"]);
      const expected = store.get("a").callout!;
      const {
        userName,
        profileImage,
        isVerified,
        verifiedBadgeVisible,
        accountKind,
        xUsername,
        xFollowerCount,
        ...legacy
      } = expected;
      assert.deepEqual(body, { callout: legacy, quotes: [] });
      assert.equal(body.callout.user_uuid, "author");
      assert.equal(body.callout.userId, "posting-wallet");
      assert.equal(body.callout.quotedCallout.callout.calloutId, "q");
      assert.equal(body.callout.viewCount, 0);
      assert.equal(body.callout.mediaTranscript, "");
      assert.equal(
        result.headers["x-reconstruction-compatibility"],
        "unqualified",
      );
      assert.equal(
        result.headers["x-reconstruction-observed-at"],
        store.observedAt,
      );
    }
    store.getByUserMint("author", "mint").callout!.updates[0].content =
      "mutated";
    assert.equal(
      store.getByUserMint("author", "mint").callout!.updates[0].content,
      "Synthetic update",
    );
  } finally {
    await app.close();
  }
});

test("canonical group author and mint select only visible matching rows", async () => {
  const data = dataset();
  const other = structuredClone(data.callouts[0]);
  other.calloutId = "group-callout";
  other.authorId = "group";
  other.facts!.calloutId = other.calloutId;
  data.callouts.push(other);
  const hidden = structuredClone(data.callouts[0]);
  hidden.calloutId = "hidden";
  hidden.facts!.calloutId = "hidden";
  hidden.hidden = true;
  data.callouts.push(hidden);
  const app = buildApp([], { calloutsStore: new CalloutsStore(data) });
  try {
    const group = await app.inject({
      url: path.replace("/author/", "/group/"),
      headers,
    });
    assert.equal(group.statusCode, 200);
    assert.equal(group.json().callout.calloutId, "group-callout");
    const absent = await app.inject({
      url: path.replace("/mint/mint", "/mint/other"),
      headers,
    });
    assert.equal(absent.statusCode, 200);
    assert.deepEqual(absent.json(), { callout: null, quotes: [] });
    const person = await app.inject({ url: path, headers });
    assert.equal(person.statusCode, 200);
    assert.equal(person.json().callout.calloutId, "a");
    for (const field of ["hidden", "deleted"] as const) {
      const unavailable = dataset();
      unavailable.callouts[0][field] = true;
      const hiddenApp = buildApp([], {
        calloutsStore: new CalloutsStore(unavailable),
      });
      try {
        assert.deepEqual(
          (await hiddenApp.inject({ url: path, headers })).json(),
          { callout: null, quotes: [] },
        );
      } finally {
        await hiddenApp.close();
      }
    }
  } finally {
    await app.close();
  }
});

test("unknown canonical author, unmapped rows and ambiguous live slots remain unavailable", async () => {
  for (const scenario of [
    "unknown",
    "unmapped",
    "ambiguous",
    "chain_unavailable",
  ] as const) {
    const data = dataset();
    if (scenario === "chain_unavailable")
      data.callouts[0].facts!.chain = "eip155:1";
    if (scenario === "unmapped") data.callouts[0].facts = null;
    if (scenario === "ambiguous") {
      const other = structuredClone(data.callouts[0]);
      other.calloutId = "b";
      other.facts!.calloutId = "b";
      data.callouts.push(other);
    }
    const app = buildApp([], { calloutsStore: new CalloutsStore(data) });
    try {
      const result = await app.inject({
        url:
          scenario === "unknown"
            ? path.replace("/author/", "/posting-wallet/")
            : path,
        headers,
      });
      assert.equal(result.statusCode, 501);
      assert.equal(
        result.json().reason,
        `CALLOUT_LOOKUP_${scenario.toUpperCase()}`,
      );
      assert.equal(result.headers["x-reconstruction-data-source"], undefined);
    } finally {
      await app.close();
    }
  }
});

test("query limits are checked and unsupported chain/carousel/viewer inputs are explicit", async () => {
  const app = buildApp([], { calloutsStore: new CalloutsStore(dataset()) });
  try {
    for (const query of [
      "quotesLimit=-1",
      "quotesLimit=21",
      "quotesLimit=0.5",
      "quotesLimit=",
      "quotesLimit=0&%71uotesLimit=0",
    ]) {
      const r = await app.inject({ url: path + "?" + query, headers });
      assert.equal(r.statusCode, 400, query);
    }
    for (const query of [
      "quotesLimit=1",
      "quotesLimit=20",
      "chain=ton:-239",
      "userId=viewer",
      "?userId=viewer",
    ]) {
      const r = await app.inject({ url: path + "?" + query, headers });
      assert.equal(r.statusCode, 501, query);
      assert.equal(r.json().reason, "CALLOUT_LOOKUP_QUERY_UNSUPPORTED");
    }
    assert.equal((await app.inject(path)).statusCode, 401);
  } finally {
    await app.close();
  }
});

test("a nonzero quotes limit succeeds when there is no callout to hydrate", async () => {
  const app = buildApp([], { calloutsStore: new CalloutsStore(dataset()) });
  try {
    for (const quotesLimit of [1, 20]) {
      const result = await app.inject({
        url: `${path.replace("/mint/mint", "/mint/absent")}?quotesLimit=${quotesLimit}`,
        headers,
      });
      assert.equal(result.statusCode, 200);
      assert.deepEqual(result.json(), { callout: null, quotes: [] });
    }
  } finally {
    await app.close();
  }
});

test("no-adapter fixtures remain intact and configured store takes precedence", async () => {
  const fixture: Fixture = {
    method: "GET",
    path: "/v1/callout/user/author/mint/mint",
    query: {},
    status: 200,
    body: { callout: null, quotes: [] },
    headers: {},
    source: "synthetic local test",
  };
  const unconfigured = buildApp([fixture]);
  const configured = buildApp([fixture], {
    calloutsStore: new CalloutsStore(dataset()),
  });
  try {
    assert.deepEqual(
      (await unconfigured.inject({ url: path, headers })).json(),
      fixture.body,
    );
    const native = await configured.inject({ url: path, headers });
    assert.equal(native.statusCode, 200);
    assert.equal(native.json().callout.calloutId, "a");
  } finally {
    await unconfigured.close();
    await configured.close();
  }
});
