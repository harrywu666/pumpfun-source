import type { FastifyReply } from "fastify";

/**
 * The developer contract names two alternative credential headers, but does not
 * define precedence or duplicate-header semantics. Never select one credential
 * from an ambiguous request. This is a local compatibility boundary, not an
 * upstream authentication result or a credential-verification guarantee.
 */
export function hasAmbiguousApiCredentials(request: {
  headers: Record<string, string | string[] | undefined>;
  raw?: { rawHeaders: string[] };
}): boolean {
  const names = ["authorization", "x-api-key"];
  let sources = 0;
  for (const name of names) {
    const value = request.headers[name];
    if (Array.isArray(value)) return true;
    // Node can discard duplicate Authorization fields when normalizing headers.
    // Inspect raw field occurrences rather than relying on the chosen value.
    let occurrences = 0;
    const rawHeaders = request.raw?.rawHeaders ?? [];
    for (let index = 0; index < rawHeaders.length; index += 2) {
      if (rawHeaders[index].toLowerCase() === name) occurrences += 1;
    }
    if (occurrences > 1) return true;
    if (occurrences === 1 || value !== undefined) sources += 1;
  }
  return sources > 1;
}

// Documented developer API key shape (contracts/developer.openapi.json,
// components/securitySchemes/bearer): the prefix `pf_live_` followed by 43
// base62 characters and a 6-character base62 checksum. The checksum algorithm
// and the key store are not observable, so the gate validates the documented
// shape only; a well-formed key is accepted as presented, never as a verified
// credential. Scope, revocation and rate-limit outcomes need a key store and
// stay unmodeled.
const apiKeyPattern = /^pf_live_[0-9A-Za-z]{49}$/;

export async function apiKeyGate(
  request: {
    headers: Record<string, string | string[] | undefined>;
    url: string;
    raw?: { rawHeaders: string[] };
  },
  reply: FastifyReply,
) {
  if (hasAmbiguousApiCredentials(request)) {
    return reply.code(501).send({
      error: "COMPATIBILITY_NOT_IMPLEMENTED",
      reason: "API_CREDENTIAL_AMBIGUITY_UNQUALIFIED",
    });
  }
  const authorization = request.headers.authorization;
  const alias = request.headers["x-api-key"];
  let candidate: string | undefined;
  if (typeof authorization === "string") {
    const bearer = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (bearer) candidate = bearer[1];
  }
  if (candidate === undefined && typeof alias === "string") {
    candidate = alias;
  }
  if (candidate !== undefined && apiKeyPattern.test(candidate)) {
    // The documented response-header contract makes every keyed response
    // non-cacheable, including route errors after this gate accepts the key.
    reply.header("Cache-Control", "no-store");
    return;
  }
  // The observed 401 envelope (evidence/api-probes.json, object
  // 1837f7894abd389a) reports the path without the local /v1 prefix and names
  // both key headers; the specification's examples diverge on both points, so
  // the captured response wins. Only the timestamp is volatile.
  const separator = request.url.indexOf("?");
  const pathname =
    separator < 0 ? request.url : request.url.slice(0, separator);
  reply.code(401).send({
    statusCode: 401,
    timestamp: new Date().toISOString(),
    path: pathname.startsWith("/v1/") ? pathname.slice(3) : pathname,
    error: candidate === undefined ? "API_KEY_REQUIRED" : "API_KEY_INVALID",
    message:
      candidate === undefined
        ? "Send Authorization: Bearer <key> or x-api-key: <key>"
        : "The key is malformed (wrong prefix, length or checksum) or unknown.",
  });
}
