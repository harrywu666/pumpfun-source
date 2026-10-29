import { createHash } from "node:crypto";

/** Local API failures, not reconstructed production error payloads. */
export class CalloutListError extends Error {
  constructor(
    readonly status: 400 | 501,
    readonly reason: string,
  ) {
    super(reason);
  }
}
export const fingerprint = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function parseCalloutListQuery(query: URLSearchParams) {
  const allowed = new Set([
    "limit",
    "sortBy",
    "sortOrder",
    "pageToken",
    "window",
    "includeMembers",
  ]);
  for (const key of query.keys()) {
    if (!allowed.has(key))
      throw new CalloutListError(501, "CALLOUT_LIST_QUERY_UNSUPPORTED");
    if (query.getAll(key).length !== 1)
      throw new CalloutListError(400, "CALLOUT_LIST_QUERY_INVALID");
  }
  // These are local defaults aligned with the captured client, not proven server defaults.
  const limitText = query.get("limit") ?? "30";
  const limit = Number(limitText);
  const sortBy = query.get("sortBy") ?? "TIMESTAMP";
  const sortOrder = query.get("sortOrder") ?? "DESC";
  const members = query.get("includeMembers") ?? "false";
  const window = query.get("window")?.trim().toUpperCase() || "ALLTIME";
  if (
    !/^[1-9]\d*$/.test(limitText) ||
    !Number.isSafeInteger(limit) ||
    !["TIMESTAMP", "MULTIPLE"].includes(sortBy) ||
    !["ASC", "DESC"].includes(sortOrder) ||
    !["true", "false"].includes(members) ||
    !["DAILY", "WEEKLY", "MONTHLY", "ALLTIME", "LAST_ROUND"].includes(window)
  )
    throw new CalloutListError(400, "CALLOUT_LIST_QUERY_INVALID");
  const includeMembers = members === "true";
  if (sortBy === "MULTIPLE" && includeMembers)
    throw new CalloutListError(
      400,
      "CALLOUT_LIST_MEMBERS_MULTIPLE_UNSUPPORTED",
    );
  if (window !== "ALLTIME")
    throw new CalloutListError(501, "CALLOUT_LIST_WINDOW_UNAVAILABLE");
  const pageToken = query.get("pageToken");
  // Omission selects the first page; an explicitly supplied empty cursor is malformed.
  if (pageToken === "")
    throw new CalloutListError(400, "CALLOUT_LIST_PAGE_TOKEN_INVALID");
  return {
    limit,
    sortBy: sortBy as "TIMESTAMP" | "MULTIPLE",
    sortOrder: sortOrder as "ASC" | "DESC",
    includeMembers,
    pageToken: pageToken ?? "",
  };
}

/** Opaque local continuation, bound to the immutable dataset and normalized query.
 * This is not an upstream cursor, a secret, a signature or an authorization token.
 */
export function encodeCalloutPage(
  snapshot: string,
  query: string,
  offset: number,
): string {
  return Buffer.from(JSON.stringify([1, snapshot, query, offset])).toString(
    "base64url",
  );
}
export function decodeCalloutPage(
  token: string,
  snapshot: string,
  query: string,
  limit: number,
  length: number,
): number {
  if (!token) return 0;
  const invalid = () =>
    new CalloutListError(400, "CALLOUT_LIST_PAGE_TOKEN_INVALID");
  if (token.length > 256 || !/^[A-Za-z0-9_-]+$/.test(token)) throw invalid();
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  } catch {
    throw invalid();
  }
  if (!Array.isArray(decoded) || decoded.length !== 4) throw invalid();
  const [version, source, scope, offset] = decoded;
  if (
    version !== 1 ||
    source !== snapshot ||
    scope !== query ||
    !Number.isSafeInteger(offset) ||
    offset <= 0 ||
    offset >= length ||
    offset % limit !== 0 ||
    encodeCalloutPage(source, scope, offset) !== token
  )
    throw invalid();
  return offset;
}
