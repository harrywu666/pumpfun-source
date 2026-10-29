import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp } from "../src/app.js";

const RANKED = "/services/frontend/home-feed";
const NEW = "/services/frontend/home-feed/new";

function withQuery(path: string, query: Record<string, string>): string {
  return `${path}?${new URLSearchParams(query)}`;
}

test("home feed USD filters accept equivalent scientific notation", async () => {
  const app = buildApp();
  try {
    const origin = await app.listen({ host: "127.0.0.1", port: 0 });
    const cases = [
      [RANKED, "minMarketCapUsd", "1.25e5", "125000"],
      [RANKED, "maxCostBasisUsd", String(1e-7), "0.0000001"],
      [NEW, "minCalloutMarketCapUsd", "1E5", "100000"],
    ] as const;

    for (const [path, field, scientific, decimal] of cases) {
      const scientificResponse = await fetch(
        origin + withQuery(path, { [field]: scientific }),
      );
      const decimalResponse = await fetch(
        origin + withQuery(path, { [field]: decimal }),
      );
      const scientificText = await scientificResponse.text();

      assert.equal(
        scientificResponse.status,
        200,
        `${path} ${field}=${scientific}: ${scientificText}`,
      );
      assert.equal(decimalResponse.status, 200);
      assert.deepEqual(
        JSON.parse(scientificText),
        await decimalResponse.json(),
        `${path} ${field}`,
      );
    }
  } finally {
    await app.close();
  }
});

test("home feed still rejects malformed or non-finite number literals", async () => {
  const app = buildApp();
  try {
    const origin = await app.listen({ host: "127.0.0.1", port: 0 });
    for (const value of ["1e", "1e+", "1e-", "1e2.3", "1e309", "-1e3"]) {
      const response = await fetch(
        origin + withQuery(RANKED, { minCostBasisUsd: value }),
      );
      assert.equal(response.status, 400, value);
      assert.equal((await response.json()).error, "INVALID_NUMBER");
    }
  } finally {
    await app.close();
  }
});
