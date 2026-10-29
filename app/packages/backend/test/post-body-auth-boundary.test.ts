import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";

const validKey = `pf_live_${"A".repeat(49)}`;
const paths = [
  "/v1/users/batch",
  "/v1/profiles/verified",
  "/v1/achievements/overlays",
];
const malformedBodies = [
  {
    name: "empty JSON",
    contentType: "application/json",
    body: "",
    authenticatedStatus: 400,
  },
  {
    name: "malformed JSON",
    contentType: "application/json",
    body: "{",
    authenticatedStatus: 400,
  },
  {
    name: "unsupported media type",
    contentType: "application/xml",
    body: "<request />",
    authenticatedStatus: 415,
  },
];

test("POST credential failures run before request-body parsing", async () => {
  const app = buildApp();
  try {
    const origin = await app.listen({ host: "127.0.0.1", port: 0 });
    for (const path of paths) {
      for (const sample of malformedBodies) {
        const unauthenticated = await fetch(`${origin}${path}`, {
          method: "POST",
          headers: { "content-type": sample.contentType },
          body: sample.body,
        });
        assert.equal(unauthenticated.status, 401, `${path}: ${sample.name}`);
        assert.equal(
          (await unauthenticated.json()).error,
          "API_KEY_REQUIRED",
          `${path}: ${sample.name}`,
        );

        const authenticated = await fetch(`${origin}${path}`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${validKey}`,
            "content-type": sample.contentType,
          },
          body: sample.body,
        });
        assert.equal(
          authenticated.status,
          sample.authenticatedStatus,
          `${path}: ${sample.name}`,
        );
      }
    }
  } finally {
    await app.close();
  }
});
