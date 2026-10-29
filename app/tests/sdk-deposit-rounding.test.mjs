import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(
  new URL("../packages/sdk/package.json", import.meta.url),
);
const BN = require("bn.js");
const { PumpAmmSdk } = require(join(root, "packages/sdk/dist/swap/index.js"));

function liquidityState({ baseAmount, quoteAmount, lpSupply }) {
  return {
    pool: {
      lpSupply: new BN(lpSupply),
      protocolFees: new BN(0),
      creatorFees: new BN(0),
    },
    poolBaseTokenAccount: { amount: new BN(baseAmount) },
    poolQuoteTokenAccount: { amount: new BN(quoteAmount) },
  };
}

test("base deposit autocomplete quotes the pool-required counterpart", () => {
  const sdk = new PumpAmmSdk();

  const roundedDown = sdk.depositBaseInput(
    liquidityState({ baseAmount: 3, quoteAmount: 5, lpSupply: 7 }),
    new BN(1),
    0,
  );
  assert.equal(roundedDown.lpToken.toString(), "2");
  assert.equal(roundedDown.quote.toString(), "2");

  const roundedUp = sdk.depositBaseInput(
    liquidityState({ baseAmount: 10, quoteAmount: 10, lpSupply: 3 }),
    new BN(5),
    0,
  );
  assert.equal(roundedUp.lpToken.toString(), "1");
  assert.equal(roundedUp.quote.toString(), "4");
});

test("quote deposit autocomplete quotes the pool-required base", () => {
  const sdk = new PumpAmmSdk();

  const roundedDown = sdk.depositQuoteInput(
    liquidityState({ baseAmount: 5, quoteAmount: 3, lpSupply: 7 }),
    new BN(1),
    0,
  );
  assert.equal(roundedDown.lpToken.toString(), "2");
  assert.equal(roundedDown.base.toString(), "2");

  const roundedUp = sdk.depositQuoteInput(
    liquidityState({ baseAmount: 10, quoteAmount: 10, lpSupply: 3 }),
    new BN(5),
    0,
  );
  assert.equal(roundedUp.lpToken.toString(), "1");
  assert.equal(roundedUp.base.toString(), "4");
});

test("deposit autocomplete does not quote a counterpart for zero LP", () => {
  const sdk = new PumpAmmSdk();
  const state = liquidityState({
    baseAmount: 10,
    quoteAmount: 10,
    lpSupply: 3,
  });

  const fromBase = sdk.depositBaseInput(state, new BN(1), 0);
  assert.equal(fromBase.lpToken.toString(), "0");
  assert.equal(fromBase.quote.toString(), "0");

  const fromQuote = sdk.depositQuoteInput(state, new BN(1), 0);
  assert.equal(fromQuote.lpToken.toString(), "0");
  assert.equal(fromQuote.base.toString(), "0");
});
