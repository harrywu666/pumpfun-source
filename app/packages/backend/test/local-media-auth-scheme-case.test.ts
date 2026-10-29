import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildApp } from "../src/app.js";
import {
  LOCAL_MEDIA_PREFIX as P,
  LocalMediaStore,
} from "../src/local-media-store.js";

const TOKEN = "synthetic-test-only-local-capability-123456789";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1cAAAAASUVORK5CYII=",
  "base64",
);

test("local capability accepts case variants of the HTTP auth scheme", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "media-auth-scheme-"));
  const store = await LocalMediaStore.open(directory);
  const app = buildApp([], { localMedia: { store, token: TOKEN } });
  t.after(async () => {
    try {
      await app.close();
    } finally {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  const image = await store.putImage(PNG, "image/png");
  for (const scheme of ["Bearer", "bearer", "BEARER", "bEaReR"]) {
    const response = await app.inject({
      url: `${P}/images/${image.id}`,
      headers: { authorization: `${scheme} ${TOKEN}` },
    });
    assert.equal(response.statusCode, 200, scheme);
  }

  const wrongScheme = await app.inject({
    url: `${P}/images/${image.id}`,
    headers: { authorization: `Basic ${TOKEN}` },
  });
  assert.equal(wrongScheme.statusCode, 401);
});
