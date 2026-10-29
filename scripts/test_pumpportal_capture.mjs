import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const script = fileURLToPath(
  new URL("./pumpportal-capture.mjs", import.meta.url),
);

const websocketMock = `
class FakeWebSocket {
  #listeners = new Map();
  #timer;

  constructor() {
    setTimeout(() => {
      this.#emit("open", {});
      this.#emit("message", {
        data: JSON.stringify({
          txType: "create",
          mint: "So11111111111111111111111111111111111111112",
          name: "Mock",
          symbol: "MOCK",
        }),
      });
      this.#timer = setInterval(() => {}, 1000);
    }, 20);
  }

  addEventListener(type, listener) {
    const listeners = this.#listeners.get(type) ?? [];
    listeners.push(listener);
    this.#listeners.set(type, listeners);
  }

  send() {}

  close() {
    clearInterval(this.#timer);
    setTimeout(() => this.#emit("close", { code: 1000 }), 0);
  }

  #emit(type, event) {
    for (const listener of this.#listeners.get(type) ?? []) listener(event);
  }
}

globalThis.WebSocket = FakeWebSocket;
`;

function waitForOutput(stream, text, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${JSON.stringify(text)}:\n${output}`));
    }, timeoutMs);
    stream.on("data", (chunk) => {
      output += chunk;
      if (output.includes(text)) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
}

test("SIGTERM finalizes the capture before exiting", async () => {
  const temp = mkdtempSync(join(tmpdir(), "pumpportal-capture-test-"));
  const output = join(temp, "capture");
  const mockPath = join(temp, "websocket-mock.mjs");
  writeFileSync(mockPath, websocketMock);

  const child = spawn(
    process.execPath,
    [
      "--import",
      pathToFileURL(mockPath).href,
      script,
      "--duration",
      "30",
      "--output",
      output,
    ],
    {
      env: { ...process.env, PUMPPORTAL_API_KEY: "test-key" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  try {
    await waitForOutput(child.stdout, "[capture] connected");
    child.kill("SIGTERM");
    const { code, signal } = await new Promise((resolve) => {
      child.on("exit", (code, signal) => resolve({ code, signal }));
    });

    assert.equal(signal, null, stderr);
    assert.equal(code, 0, stderr);
    assert.deepEqual(readdirSync(output).sort(), [
      "README.md",
      "events.json",
      "manifest.json",
      "summary.json",
      "token-index.json",
      "verify.py",
    ]);
    const summary = JSON.parse(readFileSync(join(output, "summary.json"), "utf8"));
    assert.equal(summary.total_events, 1);
    assert.ok(summary.end_utc);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    rmSync(temp, { recursive: true, force: true });
  }
});
