import "server-only";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type GoSnapshot, verifyGoEvidence } from "./go-data";

const evidenceRoot = resolve(process.cwd(), "../../evidence");
const capturePath = resolve(evidenceRoot, "web/objects/e66810e11f481135");
const manifestPath = resolve(evidenceRoot, "web/manifest.json");
const GO_CAPTURED_AT = "2026-10-28T10:48:45.546100+00:00";

export type GoEvidenceResult =
  | { ok: true; snapshot: GoSnapshot }
  | { ok: false; error: string };

export async function loadGoEvidence(): Promise<GoEvidenceResult> {
  try {
    const [bytes, manifestText] = await Promise.all([
      readFile(capturePath),
      readFile(manifestPath, "utf8"),
    ]);
    const manifest: unknown = JSON.parse(manifestText);
    if (
      typeof manifest !== "object" ||
      manifest === null ||
      Array.isArray(manifest) ||
      (manifest as { captured_at?: unknown }).captured_at !== GO_CAPTURED_AT
    ) {
      throw new Error("Capture manifest timestamp does not match");
    }
    return {
      ok: true,
      snapshot: verifyGoEvidence(bytes, manifest),
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown GO evidence validation failure",
    };
  }
}
