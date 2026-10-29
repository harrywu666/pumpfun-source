import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";
import { buildApp } from "../src/app.js";

const authorization = `Bearer pf_live_${"A".repeat(49)}`;
const payload = '{"addresses":[]}';

async function sendRaw(
  origin: string,
  contentTypes: readonly string[],
  body = payload,
): Promise<{ status: number; body: unknown }> {
  const url = new URL(origin);
  return await new Promise((resolve, reject) => {
    const socket = net.connect(Number(url.port), url.hostname, () => {
      socket.end(
        [
          "POST /v1/users/batch HTTP/1.1",
          `Host: ${url.host}`,
          `Authorization: ${authorization}`,
          ...contentTypes.map((type) => `Content-Type: ${type}`),
          `Content-Length: ${Buffer.byteLength(body)}`,
          "Connection: close",
          "",
          body,
        ].join("\r\n"),
      );
    });
    const chunks: Buffer[] = [];
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("error", reject);
    socket.on("end", () => {
      const response = Buffer.concat(chunks).toString("utf8");
      const separator = response.indexOf("\r\n\r\n");
      const status = Number(response.match(/^HTTP\/1\.1 (\d{3})/)?.[1]);
      resolve({
        status,
        body: JSON.parse(response.slice(separator + 4)),
      });
    });
  });
}

test("duplicate Content-Type fields fail closed before body parsing", async () => {
  const app = buildApp();
  try {
    const origin = await app.listen({ port: 0, host: "127.0.0.1" });
    for (const types of [
      ["application/json", "text/plain"],
      ["text/plain", "application/json"],
      ["application/json", "application/json"],
    ]) {
      const response = await sendRaw(origin, types);
      assert.equal(response.status, 400, types.join(" then "));
      assert.deepEqual(response.body, {
        statusCode: 400,
        error: "DUPLICATE_CONTENT_TYPE",
      });
    }
    const beforeParsing = await sendRaw(
      origin,
      ["application/json", "text/plain"],
      "{",
    );
    assert.equal(beforeParsing.status, 400);
    assert.deepEqual(beforeParsing.body, {
      statusCode: 400,
      error: "DUPLICATE_CONTENT_TYPE",
    });
  } finally {
    await app.close();
  }
});

test("one Content-Type field retains native JSON behavior", async () => {
  const app = buildApp();
  try {
    const origin = await app.listen({ port: 0, host: "127.0.0.1" });
    const response = await sendRaw(origin, ["application/json"]);
    assert.equal(response.status, 201);
    assert.deepEqual(response.body, []);
  } finally {
    await app.close();
  }
});
