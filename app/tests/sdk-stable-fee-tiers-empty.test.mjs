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
const { PublicKey } = require("@solana/web3.js");
const {
  computeFeesBps,
  feesForQuoteMint,
  pumpPoolAuthorityPda,
  USDC_MINT,
} = require(join(root, "packages/sdk/dist/swap/index.js"));

const fees = (lp, protocol, creator) => ({
  lpFeeBps: new BN(lp),
  protocolFeeBps: new BN(protocol),
  creatorFeeBps: new BN(creator),
});

function feeConfig(overrides = {}) {
  return {
    admin: PublicKey.default,
    flatFees: fees(25, 5, 0),
    feeTiers: [
      {
        marketCapLamportsThreshold: new BN(0),
        fees: fees(20, 5, 5),
      },
    ],
    stableFeeTiers: [],
    exoticFlatFees: fees(0, 0, 0),
    ...overrides,
  };
}

test("rejects a canonical USDC quote when stable fee tiers are empty", () => {
  assert.throws(
    () =>
      feesForQuoteMint({
        feeConfig: feeConfig(),
        isPumpPool: true,
        marketCap: new BN("1000000000000000"),
        quoteMint: USDC_MINT,
      }),
    /stable fee tiers/i,
  );
});

test("rejects the production fee computation for the same empty schedule", () => {
  const baseMint = new PublicKey(new Uint8Array(32).fill(9));
  const globalConfig = {
    creatorFeeConfigurable: false,
  };

  assert.throws(
    () =>
      computeFeesBps({
        globalConfig,
        feeConfig: feeConfig(),
        creator: pumpPoolAuthorityPda(baseMint),
        baseMintSupply: new BN("1000000000000000"),
        baseMint,
        baseReserve: new BN("1000000000"),
        quoteReserve: new BN("1000000000"),
        quoteMint: USDC_MINT,
      }),
    /stable fee tiers/i,
  );
});

test("keeps the SOL-like and unconfigured exotic schedules unchanged", () => {
  const config = feeConfig();
  const solFees = feesForQuoteMint({
    feeConfig: config,
    isPumpPool: true,
    marketCap: new BN("1000000000000000"),
    quoteMint: PublicKey.default,
  });
  const exoticFees = feesForQuoteMint({
    feeConfig: config,
    isPumpPool: true,
    marketCap: new BN("1000000000000000"),
    quoteMint: new PublicKey(new Uint8Array(32).fill(7)),
  });

  assert.equal(solFees, config.feeTiers[0].fees);
  assert.equal(exoticFees, config.flatFees);
});
