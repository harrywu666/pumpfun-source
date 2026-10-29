import assert from "node:assert/strict";
import test from "node:test";
import { parseJsonBody } from "../src/json-body-parser.js";
import { buildApp } from "./with-api-key.js";

const json = { "content-type": "application/json" };
const tooMany = JSON.stringify(
  Array.from({ length: 101 }, (_, index) => `address-${index}`),
);
const authorization = `Bearer pf_live_${"A".repeat(49)}`;

test("POST /v1/users/batch rejects ambiguous duplicate JSON object names", async () => {
  const app = buildApp();
  try {
    const origin = await app.listen({ host: "127.0.0.1", port: 0 });
    for (const payload of [
      `{"addresses":${tooMany},"addresses":[]}`,
      '{"addresses":[1],"addresses":[]}',
      '{"addresses":[],"forceFetch":"wrong","forceFetch":true}',
    ]) {
      const response = await fetch(`${origin}/v1/users/batch`, {
        method: "POST",
        headers: { ...json, authorization },
        body: payload,
      });
      assert.equal(response.status, 400, payload);
    }

    const valid = await fetch(`${origin}/v1/users/batch`, {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/json; charset=utf-8",
      },
      body: '{"addresses":[],"forceFetch":true}',
    });
    assert.equal(valid.status, 201);

    const malformed = await fetch(`${origin}/v1/users/batch`, {
      method: "POST",
      headers: { ...json, authorization },
      body: '{"addresses":[]',
    });
    assert.equal(malformed.status, 400);
  } finally {
    await app.close();
  }
});

test("the native JSON parser detects nested and escaped duplicate names", () => {
  assert.throws(
    () => parseJsonBody('{"outer":{"name":1,"\\u006eame":2}}'),
    /Duplicate JSON object name: name/,
  );
  assert.deepEqual(
    parseJsonBody(
      '{"first":{"name":1},"second":{"name":2},"text":"{\\"name\\":1}"}',
    ),
    {
      first: { name: 1 },
      second: { name: 2 },
      text: '{"name":1}',
    },
  );
});
