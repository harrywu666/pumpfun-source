import assert from "node:assert/strict";
import { request } from "node:http";
import { test } from "node:test";
import { buildApp } from "../src/app.js";

function read(origin: string): Promise<{
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const outgoing = request(`${origin}/recorded-framing`, (response) => {
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
      outgoing.destroy(new Error("fixture response timed out")),
    );
    outgoing.on("error", reject);
    outgoing.end();
  });
}

test("fixture replay cannot override the HTTP server's transfer framing", async () => {
  const app = buildApp([
    {
      method: "GET",
      path: "/recorded-framing",
      status: 200,
      headers: {
        "Content-Length": "1",
        "Transfer-Encoding": "chunked",
        "X-Recorded": "kept",
      },
      body: { recorded: true },
      source: "synthetic:transfer-framing",
    },
  ]);
  try {
    const origin = await app.listen({ host: "127.0.0.1", port: 0 });
    const response = await read(origin);
    // app.inject tolerates conflicting framing headers, so this uses a real
    // socket where Node's HTTP client enforces RFC 9112 framing.
    assert.equal(response.status, 200);
    assert.equal(response.headers["transfer-encoding"], undefined);
    assert.equal(response.headers["x-recorded"], "kept");
    assert.deepEqual(JSON.parse(response.body), { recorded: true });
  } finally {
    await app.close();
  }
});
