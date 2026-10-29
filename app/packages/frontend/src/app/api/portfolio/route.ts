import "server-only";

import { PortfolioRpcError, readLivePortfolio } from "../../portfolio/rpc";
import type { PortfolioFailure } from "../../portfolio/types";

export const dynamic = "force-dynamic";

function failure(
  status: number,
  code: string,
  message: string,
  retryable: boolean,
) {
  const payload: PortfolioFailure = {
    ok: false,
    error: { code, message, retryable },
  };
  return Response.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function statusFor(error: PortfolioRpcError): number {
  if (error.code === "INVALID_ADDRESS") return 400;
  if (error.code === "RPC_RATE_LIMITED") return 429;
  if (error.code === "RPC_TIMEOUT") return 504;
  if (
    error.code === "RPC_CONFIGURATION_INVALID" ||
    error.code === "RPC_DNS_REJECTED" ||
    error.code === "WRONG_CLUSTER"
  ) {
    return 503;
  }
  return 502;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const addresses = url.searchParams.getAll("address");
  if (
    addresses.length !== 1 ||
    [...url.searchParams.keys()].some((key) => key !== "address")
  ) {
    return failure(
      400,
      "INVALID_ADDRESS",
      "Provide exactly one Solana public-key address.",
      false,
    );
  }
  try {
    const portfolio = await readLivePortfolio(addresses[0], {
      signal: request.signal,
    });
    return Response.json(portfolio, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof PortfolioRpcError) {
      return failure(
        statusFor(error),
        error.code,
        error.message,
        error.retryable,
      );
    }
    return failure(
      502,
      "RPC_UNAVAILABLE",
      "The live Solana portfolio request failed.",
      true,
    );
  }
}
