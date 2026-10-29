import test from "node:test";
import assert from "node:assert/strict";
import { buildApp, type Fixture } from "../src/app.js";

function recordedQuery(query: Record<string, string>): Fixture {
  return {
    method: "GET",
    path: "/query",
    query,
    status: 200,
    body: { recorded: true },
    source: "synthetic:fixture-query-decoding",
  };
}

test("malformed query escapes cannot alias a valid fixture", async () => {
  const requests = [
    [{ q: "\ufffd" }, "/query?q=%FF"],
    [{ q: "%ZZ" }, "/query?q=%ZZ"],
    [{ q: "\ufffd%A" }, "/query?q=%E0%A4%A"],
  ] as const;
  const app = buildApp(requests.map(([query]) => recordedQuery(query)));
  try {
    const origin = await app.listen({ port: 0, host: "127.0.0.1" });
    for (const [, url] of requests) {
      const response = await fetch(origin + url);
      assert.equal(response.status, 400, url);
      assert.deepEqual(await response.json(), {
        statusCode: 400,
        error: "INVALID_QUERY_ENCODING",
      });
    }
  } finally {
    await app.close();
  }
});

test("valid query escapes, plus, Unicode and literal percent remain replayable", async () => {
  const requests = [
    [{ q: "\ufffd" }, "/query?q=%EF%BF%BD"],
    [{ q: "%ZZ" }, "/query?q=%25ZZ"],
    [{ q: "a b" }, "/query?q=a+b"],
    [{ q: "a+b" }, "/query?q=a%2Bb"],
    [{ q: "\u2713 caf\u00e9" }, "/query?q=%E2%9C%93+caf%C3%A9"],
  ] as const;
  const app = buildApp(requests.map(([query]) => recordedQuery(query)));
  try {
    const origin = await app.listen({ port: 0, host: "127.0.0.1" });
    for (const [, url] of requests) {
      const response = await fetch(origin + url);
      assert.equal(response.status, 200, url);
      assert.deepEqual(await response.json(), { recorded: true });
    }
  } finally {
    await app.close();
  }
});
