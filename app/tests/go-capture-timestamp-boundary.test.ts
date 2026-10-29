import assert from "node:assert/strict";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const captureSource = join(appRoot, "evidence/web/objects/e66810e11f481135");
const manifestSource = join(appRoot, "evidence/web/manifest.json");
const evidenceSource = join(
  appRoot,
  "packages/frontend/src/app/go/evidence.ts",
);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return {
        url: "data:text/javascript,export {}",
        shortCircuit: true,
      };
    }
    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      !extname(specifier)
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

test("GO loader rejects a rewritten capture timestamp", async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), "pmup-go-timestamp-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));

  const evidenceRoot = join(tempRoot, "evidence");
  await mkdir(join(evidenceRoot, "web/objects"), { recursive: true });
  await copyFile(
    captureSource,
    join(evidenceRoot, "web/objects/e66810e11f481135"),
  );

  const manifest = JSON.parse(await readFile(manifestSource, "utf8"));
  const manifestPath = join(evidenceRoot, "web/manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest));

  const childCwd = join(tempRoot, "a/b");
  await mkdir(childCwd, { recursive: true });
  const originalCwd = process.cwd();
  process.chdir(childCwd);

  try {
    const { loadGoEvidence } = await import(
      `${pathToFileURL(evidenceSource).href}?test=${Date.now()}`
    );
    const authentic = await loadGoEvidence();
    assert.equal(authentic.ok, true);

    await writeFile(
      manifestPath,
      JSON.stringify({
        ...manifest,
        captured_at: "2026-11-30T00:00:00Z",
      }),
    );
    const altered = await loadGoEvidence();
    const phases = altered.ok
      ? Object.fromEntries(
          Object.entries(
            Object.groupBy(
              altered.snapshot.bounties,
              (bounty: { phaseAtCapture: string }) => bounty.phaseAtCapture,
            ),
          ).map(([phase, bounties]) => [phase, bounties?.length]),
        )
      : undefined;

    assert.equal(
      altered.ok,
      false,
      `rewritten capture timestamp was accepted with phases ${JSON.stringify(phases)}`,
    );
    assert.match(altered.error, /timestamp/i);
  } finally {
    process.chdir(originalCwd);
  }
});
