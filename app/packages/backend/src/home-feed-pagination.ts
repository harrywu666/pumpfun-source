export const HOME_FEED_MAX_PAGE = Number.MAX_SAFE_INTEGER;
export const HOME_FEED_RANKED_PAGE_SIZE_MAX = 200;
export const HOME_FEED_RANKED_PAGE_SIZE_DEFAULT = 150;
export const HOME_FEED_NEWEST_PAGE_SIZE_MAX = 50;
export const HOME_FEED_NEWEST_PAGE_SIZE_DEFAULT = 25;

export function homeFeedInteger(
  value: unknown,
  field: "page" | "pageSize",
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new RangeError(`Invalid Home Feed pagination: ${field}`);
  }
  return value;
}

export function homeFeedPageStart(
  page: number,
  pageSize: number,
  total: number,
): number {
  return page > Math.floor(Number.MAX_SAFE_INTEGER / pageSize)
    ? total
    : page * pageSize;
}
