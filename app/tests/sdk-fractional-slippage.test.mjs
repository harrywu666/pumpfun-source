import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../packages/sdk/", import.meta.url));
const require = createRequire(join(root, "package.json"));
const { PUMP_SDK, PUMP_PROGRAM_ID } = require(join(root, "dist/index.js"));
const { PublicKey } = require("@solana/web3.js");
const BN = require("bn.js");

function u64At(instruction, offset) {
  return new BN(instruction.data.subarray(8 + offset, 16 + offset), "le");
}

function programInstruction(instructions) {
  const instruction = instructions.find((candidate) =>
    candidate.programId.equals(PUMP_PROGRAM_ID),
  );
  assert.ok(instruction, "expected a Pump program instruction");
  return instruction;
}

test("fractional slippage is retained in trade instruction bounds", async () => {
  const mint = new PublicKey(Uint8Array.from({ length: 32 }, (_, i) => i + 1));
  const user = new PublicKey(Uint8Array.from({ length: 32 }, (_, i) => 32 - i));
  const global = {
    feeRecipient: PublicKey.default,
    feeRecipients: [],
  };
  const bondingCurve = {
    creator: PublicKey.default,
    isCashbackCoin: false,
    quoteMint: PublicKey.default,
    isMayhemMode: false,
  };
  const amount = new BN(1_000_000);
  const quoteAmount = new BN(2_000_000);

  const v1Buy = programInstruction(
    await PUMP_SDK.buyInstructions({
      global,
      bondingCurveAccountInfo: {},
      bondingCurve,
      associatedUserAccountInfo: {},
      mint,
      user,
      amount,
      solAmount: quoteAmount,
      slippage: 1.25,
    }),
  );
  assert.equal(u64At(v1Buy, 8).toString(), "2025000");

  const v1Sell = programInstruction(
    await PUMP_SDK.sellInstructions({
      global,
      bondingCurveAccountInfo: {},
      bondingCurve,
      mint,
      user,
      amount,
      solAmount: quoteAmount,
      slippage: 1.25,
    }),
  );
  assert.equal(u64At(v1Sell, 8).toString(), "1975000");

  const v2Buy = programInstruction(
    await PUMP_SDK.buyV2Instructions({
      global,
      bondingCurveAccountInfo: {},
      bondingCurve,
      associatedUserAccountInfo: {},
      mint,
      user,
      amount,
      quoteAmount,
      slippage: 1.25,
    }),
  );
  assert.equal(u64At(v2Buy, 8).toString(), "2025000");

  const v2Sell = programInstruction(
    await PUMP_SDK.sellV2Instructions({
      global,
      bondingCurveAccountInfo: {},
      bondingCurve,
      mint,
      user,
      amount,
      quoteAmount,
      slippage: 1.25,
    }),
  );
  assert.equal(u64At(v2Sell, 8).toString(), "1975000");

  const exactBuy = programInstruction(
    await PUMP_SDK.buyExactQuoteInV3Instructions({
      bondingCurve,
      associatedUserAccountInfo: {},
      mint,
      user,
      amount,
      quoteAmount,
      slippage: 1.25,
    }),
  );
  assert.equal(u64At(exactBuy, 8).toString(), "987500");

  const sell = programInstruction(
    await PUMP_SDK.sellV3Instructions({
      bondingCurve,
      mint,
      user,
      amount,
      quoteAmount,
      slippage: 1.25,
    }),
  );
  assert.equal(u64At(sell, 8).toString(), "1975000");

  const buy = programInstruction(
    await PUMP_SDK.buyV3Instructions({
      bondingCurve,
      associatedUserAccountInfo: {},
      mint,
      user,
      amount,
      quoteAmount,
      slippage: 1.25,
    }),
  );
  assert.equal(u64At(buy, 8).toString(), "2025000");
});
