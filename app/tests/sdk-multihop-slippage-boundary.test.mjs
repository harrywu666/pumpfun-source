import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";

const requireBackend = createRequire(
  new URL("../packages/backend/package.json", import.meta.url),
);
const { require: requireTs } = requireBackend("tsx/cjs/api");
const { multiHopSwapQuote } = requireTs(
  "../packages/sdk/src/swap/multiHop.ts",
  import.meta.url,
);

const requireSdk = createRequire(
  new URL("../packages/sdk/package.json", import.meta.url),
);
const BN = requireSdk("bn.js");
const { PublicKey } = requireSdk("@solana/web3.js");

const BASE_MINT = PublicKey.default;
const QUOTE_MINT = new PublicKey("So11111111111111111111111111111111111111112");

function quote(slippage, onQuote = () => {}) {
  return multiHopSwapQuote({
    inMint: QUOTE_MINT,
    hops: [
      {
        kind: "curve",
        baseMint: BASE_MINT,
        quoteMint: QUOTE_MINT,
        baseTokenProgram: PublicKey.default,
        quoteTokenProgram: PublicKey.default,
        quote: (amount) => {
          onQuote();
          return amount;
        },
      },
    ],
    amountIn: new BN(1_000_000),
    slippage,
    globalConfig: {},
    feeConfig: null,
  });
}

test("rejects invalid slippage before quoting any hop", () => {
  for (const slippage of [-1, 101, Number.NaN, Infinity, -Infinity]) {
    let quoted = false;
    assert.throws(
      () => quote(slippage, () => (quoted = true)),
      /slippage must be a finite number between 0 and 100\./,
      `slippage=${String(slippage)}`,
    );
    assert.equal(quoted, false, `slippage=${String(slippage)} quoted a hop`);
  }
});

test("accepts the inclusive 0 through 100 percent slippage bounds", () => {
  for (const [slippage, expected] of [
    [0, "1000000"],
    [1, "990000"],
    [100, "1"],
  ]) {
    const result = quote(slippage);
    assert.equal(result.amountOut.toString(), "1000000");
    assert.equal(result.minAmountOut.toString(), expected);
  }
});
