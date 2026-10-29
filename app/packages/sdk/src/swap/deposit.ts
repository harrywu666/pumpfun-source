import BN from "bn.js";

import { grossForTransferFee, QuoteTransferFee } from "./transferFee";
import { DepositLpTokenResult, DepositResult } from "./types";

export function depositToken0(
  token0: BN,
  slippage: number,
  token0Reserve: BN,
  token1Reserve: BN,
  totalLpTokens: BN,
): DepositResult {
  if (slippage < 0 || slippage > 100) {
    throw new Error("Slippage must be between 0 and 100 (0% to 100%)");
  }

  // The program first determines the LP tokens minted from the input side,
  // then requires ceil(token1Reserve * lpToken / totalLpTokens) for the
  // counterpart. Deriving that amount from token0 alone rounds it down too
  // early and can underquote the required deposit.
  const lpToken = token0.mul(totalLpTokens).div(token0Reserve);
  const token1 = ceilDiv(token1Reserve.mul(lpToken), totalLpTokens);

  // Apply slippage tolerance
  const slippageFactor = new BN((1 + slippage / 100) * 1_000_000_000);
  const maxToken0 = token0.mul(slippageFactor).div(new BN(1_000_000_000));
  const maxToken1 = token1.mul(slippageFactor).div(new BN(1_000_000_000));

  return {
    token1,
    lpToken,
    maxToken0,
    maxToken1,
  };
}

function ceilDiv(numerator: BN, denominator: BN): BN {
  return numerator.add(denominator).sub(new BN(1)).div(denominator);
}

export function depositLpToken(
  lpToken: BN,
  slippage: number,
  baseReserve: BN,
  quoteReserve: BN,
  totalLpTokens: BN,
  /**
   * The quote mint's Token-2022 transfer fee (`LiquiditySolanaState.quoteTransferFee`): the
   * deposit is grossed up so the pool receives its share, and `maxQuote` caps that debit.
   */
  quoteTransferFee?: QuoteTransferFee | null,
): DepositLpTokenResult {
  if (totalLpTokens.isZero()) {
    throw new Error("Division by zero: totalLpTokens cannot be zero");
  }

  const baseAmountIn = ceilDiv(baseReserve.mul(lpToken), totalLpTokens);
  const quoteAmountIn = grossForTransferFee(
    quoteTransferFee,
    ceilDiv(quoteReserve.mul(lpToken), totalLpTokens),
  );

  const slippageFactor = new BN((1 + slippage / 100) * 1_000_000_000);
  const slippageDenominator = new BN(1_000_000_000);

  const maxBase = baseAmountIn.mul(slippageFactor).div(slippageDenominator);
  const maxQuote = quoteAmountIn.mul(slippageFactor).div(slippageDenominator);

  return {
    maxBase,
    maxQuote,
  };
}
