import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const requireBackend = createRequire(
  new URL("../packages/backend/package.json", import.meta.url),
);
const { require: requireTs } = requireBackend("tsx/cjs/api");
const { readPdaBalances, PublicBalanceError } = requireTs(
  "../packages/frontend/src/app/holder-rewards/read-balances.ts",
  import.meta.url,
);
const PDA = "54SthQvXp5vQrse2JBjVUgsZVU3RrCtPAKQhqcn7XJnh";
const OTHER = "Cxpv3PFKz8jFfeQHUFQRTXCyNUz6WScMG8XrM8wLwBun";
const PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const PROGRAM22 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
function result(address = PDA) {
  const group = (program, programId) => ({
    program,
    programId,
    contextSlot: 123,
    accounts: [],
    mints: [],
  });
  return {
    ok: true,
    address,
    cluster: "mainnet-beta",
    genesisHash: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
    commitment: "confirmed",
    observedAt: "2026-10-29T02:00:00.000Z",
    endpointHost: "public-rpc.example",
    sol: {
      lamports: "9007199254740993",
      amount: "9007199.254740993",
      contextSlot: 123,
    },
    splToken: group("spl-token", PROGRAM),
    token2022: group("token-2022", PROGRAM22),
    snapshotAtomic: false,
  };
}
function fetchFor(payload, status = 200) {
  return async () => Response.json(payload, { status });
}
const signal = () => new AbortController().signal;

test("request is fixed same-origin read with omitted credentials; exact quantities/slots preserved", async () => {
  let request;
  const payload = result();
  const actual = await readPdaBalances(PDA, {
    signal: signal(),
    fetch: async (url, options) => {
      request = { url, options };
      return Response.json(payload);
    },
  });
  assert.deepEqual(actual, payload);
  assert.equal(actual.sol.lamports, "9007199254740993");
  assert.equal(request.url, `/api/portfolio?address=${PDA}`);
  assert.equal(request.options.method, "GET");
  assert.equal(request.options.credentials, "omit");
  assert.equal(request.options.cache, "no-store");
  assert.deepEqual(request.options.headers, { Accept: "application/json" });
  assert.equal(request.options.body, undefined);
});
test("response identity, cluster and token-program roles must match the derived account", async () => {
  const wrongProgram = result();
  wrongProgram.splToken.programId = PROGRAM22;
  const wrongCluster = result();
  wrongCluster.genesisHash = "untrusted-cluster";
  const ownerMismatch = result();
  ownerMismatch.splToken.accounts = [
    {
      tokenAccount: OTHER,
      mint: OTHER,
      owner: OTHER,
      program: "spl-token",
      programId: PROGRAM,
      rawAmount: "1",
      decimals: 0,
      amount: "1",
      state: "initialized",
      isNative: false,
      extensions: [],
    },
  ];
  for (const payload of [
    result(OTHER),
    wrongProgram,
    wrongCluster,
    ownerMismatch,
  ])
    await assert.rejects(
      readPdaBalances(PDA, { signal: signal(), fetch: fetchFor(payload) }),
      PublicBalanceError,
    );
});
test("null, wrong structure, non-JSON and invalid JSON fail closed", async () => {
  for (const payload of [null, {}, { ok: true }, { ok: false, error: {} }])
    await assert.rejects(
      readPdaBalances(PDA, { signal: signal(), fetch: fetchFor(payload) }),
      PublicBalanceError,
    );
  await assert.rejects(
    readPdaBalances(PDA, {
      signal: signal(),
      fetch: async () =>
        new Response("<html>provider debug</html>", {
          headers: { "Content-Type": "text/html" },
        }),
    }),
    /invalid response/,
  );
  await assert.rejects(
    readPdaBalances(PDA, {
      signal: signal(),
      fetch: async () =>
        new Response("{", { headers: { "Content-Type": "application/json" } }),
    }),
    SyntaxError,
  );
});
test("HTTP errors and malformed success statuses cannot expose provider payloads or fabricated holdings", async () => {
  for (const [code, expected] of [
    ["RPC_RATE_LIMITED", /rate limited/],
    ["RPC_TIMEOUT", /timed out/],
    ["RPC_UNAVAILABLE", /unavailable/],
  ]) {
    await assert.rejects(
      readPdaBalances(PDA, {
        signal: signal(),
        fetch: fetchFor(
          {
            ok: false,
            error: {
              code,
              message: "private-provider-payload",
              retryable: true,
            },
          },
          503,
        ),
      }),
      (error) => {
        assert.match(error.message, expected);
        assert.doesNotMatch(error.message, /private-provider/);
        return true;
      },
    );
  }
  await assert.rejects(
    readPdaBalances(PDA, { signal: signal(), fetch: fetchFor(result(), 500) }),
    /unavailable/,
  );
});
test("a late transport response after cancellation remains aborted", async () => {
  const controller = new AbortController();
  await assert.rejects(
    readPdaBalances(PDA, {
      signal: controller.signal,
      fetch: async () => {
        controller.abort();
        return Response.json(result());
      },
    }),
    (error) => error.name === "AbortError",
  );
});
test("real loopback HTTP preserves fixed URL/method and supports controlled server failure", async () => {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({
      method: request.method,
      path: request.url,
      cookie: request.headers.cookie,
      authorization: request.headers.authorization,
    });
    response.setHeader("Content-Type", "application/json");
    response.statusCode = requests.length === 1 ? 200 : 429;
    response.end(
      JSON.stringify(
        requests.length === 1
          ? result()
          : {
              ok: false,
              error: {
                code: "RPC_RATE_LIMITED",
                message: "upstream-detail",
                retryable: true,
              },
            },
      ),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const transport = (url, options) => fetch(new URL(url, base), options);
    assert.equal(
      (await readPdaBalances(PDA, { signal: signal(), fetch: transport }))
        .address,
      PDA,
    );
    await assert.rejects(
      readPdaBalances(PDA, { signal: signal(), fetch: transport }),
      /rate limited/,
    );
    assert.deepEqual(
      requests,
      [0, 1].map(() => ({
        method: "GET",
        path: `/api/portfolio?address=${PDA}`,
        cookie: undefined,
        authorization: undefined,
      })),
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("published derivation and existing server RPC boundary remain unchanged", async () => {
  for (const [path, expected] of Object.entries({
    "src/app/api/portfolio/route.ts":
      "1ca52ec7988c68db52ed4cf75a951189789e1cdf2ca3499755c678fab9fa8e9f",
    "src/app/portfolio/rpc.ts":
      "600e4a05c569dec818662b4be38ea513ad20a4b4bb7fb6bc1783a088c569259f",
    "src/app/portfolio/types.ts":
      "059bce99fd82d1e7166c6cb57577abd6be2a11d606f76b4d20caf97f9b021122",
    "src/app/holder-rewards-derivation.ts":
      "01d5dc18ac17bfd7ea78eaa4d777166f3decbb03cefe8e601385197bc891b1b6",
  })) {
    const bytes = await readFile(
      new URL(`../packages/frontend/${path}`, import.meta.url),
    );
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expected);
  }
});
