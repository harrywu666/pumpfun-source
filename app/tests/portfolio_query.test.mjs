import assert from "node:assert/strict";
import { test } from "node:test";
import Module, { createRequire } from "node:module";

const requireBackend = createRequire(
  new URL("../packages/backend/package.json", import.meta.url),
);
const { require: requireTs } = requireBackend("tsx/cjs/api");

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};
const { GET } = requireTs(
  "../packages/frontend/src/app/api/portfolio/route.ts",
  import.meta.url,
);
Module._load = originalLoad;

const ADDRESS = "So11111111111111111111111111111111111111112";

test("portfolio query accepts exactly one address key before the live reader", async () => {
  const previousRpcUrl = process.env.SOLANA_RPC_URL;
  delete process.env.SOLANA_RPC_URL;
  try {
    for (const query of [
      "",
      "foo=bar",
      "address=x&address=y",
      `address=${ADDRESS}&unknown=1`,
      `address=${ADDRESS}&=bypass`,
    ]) {
      const response = await GET(
        new Request(`http://local.test/api/portfolio?${query}`),
      );
      assert.equal(response.status, 400, query);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), {
        ok: false,
        error: {
          code: "INVALID_ADDRESS",
          message: "Provide exactly one Solana public-key address.",
          retryable: false,
        },
      });
    }

    const valid = await GET(
      new Request(`http://local.test/api/portfolio?address=${ADDRESS}`),
    );
    assert.equal(valid.status, 503);
    assert.equal(
      (await valid.json()).error.code,
      "RPC_CONFIGURATION_INVALID",
    );
  } finally {
    if (previousRpcUrl === undefined) delete process.env.SOLANA_RPC_URL;
    else process.env.SOLANA_RPC_URL = previousRpcUrl;
  }
});
