import type { FastifyInstance } from "fastify";
import { CalloutListError } from "./callout-list-query.js";
import { CalloutLookupError, type CalloutsStore } from "./callouts-store.js";

export const CALLOUTS_NATIVE_ROUTES = new Set([
  "GET /callout/{calloutId}",
  "GET /callout/list/{userId}",
  "GET /callout/user/{userId}/mint/{coinMint}",
]);
export function registerCalloutRoutes(
  app: FastifyInstance,
  store: CalloutsStore,
): void {
  app.get("/v1/callout/user/:userId/mint/:coinMint", async (request, reply) => {
    const start = request.url.indexOf("?");
    const query = new URLSearchParams(
      start < 0 ? "" : request.url.slice(start + 1),
    );
    for (const key of query.keys()) {
      if (query.getAll(key).length !== 1)
        return reply
          .code(400)
          .send({
            error: "BAD_REQUEST",
            reason: "CALLOUT_LOOKUP_QUERY_INVALID",
          });
      if (key !== "quotesLimit" && key !== "chain")
        return reply
          .code(501)
          .send({
            error: "COMPATIBILITY_NOT_IMPLEMENTED",
            reason: "CALLOUT_LOOKUP_QUERY_UNSUPPORTED",
          });
    }
    const limit = query.get("quotesLimit") ?? "0";
    if (!/^(0|[1-9]\d*)$/.test(limit) || Number(limit) > 20)
      return reply
        .code(400)
        .send({ error: "BAD_REQUEST", reason: "CALLOUT_LOOKUP_QUERY_INVALID" });
    // The materialization has no cross-chain resolver.
    if (query.has("chain"))
      return reply
        .code(501)
        .send({
          error: "COMPATIBILITY_NOT_IMPLEMENTED",
          reason: "CALLOUT_LOOKUP_QUERY_UNSUPPORTED",
        });
    const { userId, coinMint } = request.params as {
      userId: string;
      coinMint: string;
    };
    try {
      const response = store.getByUserMint(userId, coinMint);
      // Without a callout the contract requires empty quotes, so no carousel is needed.
      if (Number(limit) !== 0 && response.callout !== null)
        return reply
          .code(501)
          .send({
            error: "COMPATIBILITY_NOT_IMPLEMENTED",
            reason: "CALLOUT_LOOKUP_QUERY_UNSUPPORTED",
          });
      return reply
        .header("X-Reconstruction-Data-Source", store.dataSource)
        .header("X-Reconstruction-Observed-At", store.observedAt)
        .header("X-Reconstruction-Compatibility", "unqualified")
        .send(response);
    } catch (error) {
      if (!(error instanceof CalloutLookupError)) throw error;
      return reply
        .code(501)
        .send({
          error: "COMPATIBILITY_NOT_IMPLEMENTED",
          reason: error.message,
        });
    }
  });
  app.get("/v1/callout/list/:userId", async (request, reply) => {
    const { userId } = request.params as { userId: string };
    try {
      const queryStart = request.url.indexOf("?");
      const response = store.list(
        userId,
        new URLSearchParams(
          queryStart < 0 ? "" : request.url.slice(queryStart + 1),
        ),
      );
      return reply
        .header("X-Reconstruction-Data-Source", store.dataSource)
        .header("X-Reconstruction-Observed-At", store.observedAt)
        .header("X-Reconstruction-Compatibility", "unqualified")
        .send(response);
    } catch (error) {
      if (!(error instanceof CalloutListError)) throw error;
      return reply.code(error.status).send({
        error:
          error.status === 501
            ? "COMPATIBILITY_NOT_IMPLEMENTED"
            : "BAD_REQUEST",
        reason: error.reason,
      });
    }
  });
  app.get("/v1/callout/:calloutId", async (request, reply) => {
    // No query behavior is documented for this operation. Do not pretend viewer/filter hints work.
    const queryStart = request.url.indexOf("?");
    if (
      queryStart !== -1 &&
      new URLSearchParams(request.url.slice(queryStart + 1)).size !== 0
    ) {
      return reply
        .code(501)
        .send({
          error: "COMPATIBILITY_NOT_IMPLEMENTED",
          reason: "CALLOUT_QUERY_UNSUPPORTED",
        });
    }
    const { calloutId } = request.params as { calloutId: string };
    return reply
      .header("X-Reconstruction-Data-Source", store.dataSource)
      .header("X-Reconstruction-Observed-At", store.observedAt)
      .header("X-Reconstruction-Compatibility", "unqualified")
      .send(store.get(calloutId));
  });
}
