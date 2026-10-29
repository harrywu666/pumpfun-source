import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("failed Chrome startup removes its temporary profile", async (t) => {
  const work = await mkdtemp(join(tmpdir(), "shell-parity-startup-test-"));
  t.after(() => rm(work, { recursive: true, force: true }));
  const chrome = join(work, "chrome-fails");
  const temporary = join(work, "tmp");
  await mkdir(temporary);
  await writeFile(chrome, "#!/bin/sh\nexit 23\n");
  await chmod(chrome, 0o755);

  const result = spawnSync(
    process.execPath,
    [
      "scripts/shell-parity.mjs",
      "--chrome",
      chrome,
      "--out",
      join(work, "out"),
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, TMPDIR: temporary },
    },
  );

  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Chrome exited before DevTools was ready/);
  assert.deepEqual(await readdir(temporary), []);
});
