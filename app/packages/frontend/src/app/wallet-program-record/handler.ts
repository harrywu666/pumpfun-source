import { PortfolioRpcError } from "../portfolio/rpc";
import { readLiveWalletRecord } from "./server";

export async function handleWalletRecord(
  request: Request,
  read = readLiveWalletRecord,
): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  const error = (status: number, code: string, retryable: boolean) =>
    Response.json(
      {
        ok: false,
        error: {
          code,
          retryable,
          message: "The public Pump record is unavailable or unsupported.",
        },
      },
      { status, headers },
    );
  const query = new URL(request.url).searchParams;
  if (request.method !== "GET" && request.method !== "HEAD")
    return error(405, "METHOD_NOT_ALLOWED", false);
  if (
    query.getAll("address").length !== 1 ||
    [...query.keys()].some((key) => key !== "address")
  )
    return error(400, "INVALID_ADDRESS", false);
  try {
    return Response.json(
      await read(query.get("address")!, { signal: request.signal }),
      { headers },
    );
  } catch (e) {
    if (!(e instanceof PortfolioRpcError))
      return error(502, "RPC_UNAVAILABLE", true);
    const status =
      e.code === "INVALID_ADDRESS"
        ? 400
        : e.code === "RPC_RATE_LIMITED"
          ? 429
          : e.code === "RPC_TIMEOUT"
            ? 504
            : [
                  "RPC_CONFIGURATION_INVALID",
                  "RPC_DNS_REJECTED",
                  "WRONG_CLUSTER",
                ].includes(e.code)
              ? 503
              : 502;
    return error(status, e.code, e.retryable);
  }
}
