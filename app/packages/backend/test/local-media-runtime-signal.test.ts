import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { startWithLocalMedia } from "../src/local-media-runtime.js";

const TOKEN = "synthetic-signal-only-local-capability-12345";

async function waitForFile(path: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await delay(20);
    }
  }
  throw new Error("The synthetic startup child did not become ready.");
}

test("startup signal listeners are scoped to the pending bootstrap", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "local-media-listener-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const before = {
    SIGINT: process.listenerCount("SIGINT"),
    SIGTERM: process.listenerCount("SIGTERM"),
  };
  const result = await startWithLocalMedia(
    {
      LOCAL_MEDIA_DIRECTORY: directory,
      LOCAL_MEDIA_TOKEN: TOKEN,
      HOST: "127.0.0.1",
    },
    async ({ store }) => {
      assert.equal(
        process.listenerCount("SIGINT"),
        before.SIGINT + (before.SIGINT === 0 ? 1 : 0),
      );
      assert.equal(
        process.listenerCount("SIGTERM"),
        before.SIGTERM + (before.SIGTERM === 0 ? 1 : 0),
      );
      await store.close();
      return "started";
    },
  );
  assert.equal(result, "started");
  assert.equal(process.listenerCount("SIGINT"), before.SIGINT);
  assert.equal(process.listenerCount("SIGTERM"), before.SIGTERM);
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  test(`startup cleanup releases media ownership on ${signal} before bootstrap returns`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "local-media-signal-"));
    const marker = join(directory, "bootstrap-pending");
    const script = `
      import { writeFile } from "node:fs/promises";
      import { startWithLocalMedia } from "./src/local-media-runtime.js";

      await startWithLocalMedia(
        {
          LOCAL_MEDIA_DIRECTORY: process.env.TEST_MEDIA_DIRECTORY,
          LOCAL_MEDIA_TOKEN: process.env.TEST_MEDIA_TOKEN,
          HOST: "127.0.0.1",
        },
        async () => {
          await writeFile(process.env.TEST_MARKER, "pending");
          setInterval(() => {}, 1_000);
          await new Promise(() => {});
        },
      );
    `;
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", script],
      {
        cwd: join(import.meta.dirname, ".."),
        env: {
          ...process.env,
          TEST_MEDIA_DIRECTORY: directory,
          TEST_MEDIA_TOKEN: TOKEN,
          TEST_MARKER: marker,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      await rm(directory, { recursive: true, force: true });
    });

    assert.equal(await waitForFile(marker), "pending");
    assert.deepEqual((await readdir(directory)).sort(), [
      ".media-owner",
      "bootstrap-pending",
    ]);
    const exited = once(child, "exit");
    child.kill(signal);
    await exited;

    assert.deepEqual(
      await readdir(directory),
      ["bootstrap-pending"],
      `stale media ownership blocked the next start\n${stderr}`,
    );
  });
}
