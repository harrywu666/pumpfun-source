import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { request } from "node:http";
import { test } from "node:test";
import { buildApp, type Fixture } from "../src/app.js";

function head(
  origin: string,
  path: string,
): Promise<{
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const outgoing = request(origin + path, { method: "HEAD" }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () =>
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        }),
      );
      response.on("error", reject);
    });
    outgoing.setTimeout(2_000, () =>
      outgoing.destroy(new Error("HEAD fixture response timed out")),
    );
    outgoing.on("error", reject);
    outgoing.end();
  });
}

test("HEAD uses the committed GET fixture without sending its body", async () => {
  const fixtures = JSON.parse(
    readFileSync(
      new URL("../../../contracts/public-fixtures.json", import.meta.url),
      "utf8",
    ),
  ) as Fixture[];
  const app = buildApp(fixtures);
  try {
    const origin = await app.listen({ host: "127.0.0.1", port: 0 });
    const response = await head(origin, "/services/frontend/sol-price");
    assert.equal(response.status, 200);
    assert.match(response.headers["content-type"] ?? "", /^application\/json/);
    assert.equal(response.body, "");
  } finally {
    await app.close();
  }
});

test("an explicit HEAD fixture takes precedence over GET fallback", async () => {
  const app = buildApp([
    {
      method: "GET",
      path: "/recorded-head",
      status: 200,
      headers: { "X-Recorded": "get" },
      body: { recorded: "get" },
      source: "synthetic:head-get",
    },
    {
      method: "HEAD",
      path: "/recorded-head",
      status: 200,
      headers: { "X-Recorded": "head" },
      body: null,
      source: "synthetic:head-explicit",
    },
  ]);
  try {
    const origin = await app.listen({ host: "127.0.0.1", port: 0 });
    const response = await head(origin, "/recorded-head");
    assert.equal(response.status, 200);
    assert.equal(response.headers["x-recorded"], "head");
    assert.equal(response.body, "");
  } finally {
    await app.close();
  }
});
