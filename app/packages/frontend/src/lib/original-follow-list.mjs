// Independent pure reconstruction of captured module500056.Q, not a service,
// authenticated identity resolver, React hook or TanStack runtime replacement.
function settings(input = {}) {
  return { enabled: input.enabled, sort: input.sort === undefined ? 'followers' : input.sort,
    searchTerm: input.searchTerm };
}

export function planFollowList(direction, userId, input, signal) {
  const { enabled, sort, searchTerm } = settings(input);
  const search = searchTerm !== undefined;
  const resource = direction === 'followers' ? 'followers' : 'following';
  return {
    queryKey: ['follow-list', direction, userId, sort, searchTerm ?? ''],
    enabled: !!userId && (enabled === undefined || enabled),
    staleTime: 30000,
    refetchInterval: 60000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    request: { operation: `GET /following/v3/${resource}/${search ? 'search/' : ''}{userId}`,
      params: { userId },
      query: search ? { searchTerm, limit: 100 } : sort === 'followers' ? { limit: 1000 } : { limit: 1000, sort },
      signal },
  };
}

export function normalizeFollowList(value) {
  return Array.isArray(value) ? value.map((row) => {
    if (row === null || typeof row !== 'object' || Array.isArray(row))
      throw new TypeError('Follow-list rows must be objects.');
    return { ...row,
      address: row.address ?? '',
      userId: row.user_id ?? row.userId ?? null,
      kind: row.kind ?? 'person' };
  }) : [];
}

// The actual captured query callback calls the website client and normalizes
// its resolved JSON. Transport is required and deliberately not constructed
// here: origin, cookies, HTTP errors, retries and cancellation remain its job.
export function followListQueryOptions(transport, direction, userId, input) {
  const { enabled, sort, searchTerm } = settings(input);
  const captured = { enabled, sort, searchTerm };
  const { queryKey, enabled: queryEnabled, staleTime, refetchInterval,
    refetchIntervalInBackground, refetchOnWindowFocus } = planFollowList(direction, userId, captured);
  return { queryKey, enabled: queryEnabled,
    queryFn: async ({ signal }) => {
      // Each invocation creates fresh request containers, like the source.
      const { operation, params, query } = planFollowList(direction, userId, captured, signal).request;
      return normalizeFollowList(await transport(operation, { params, query, signal }));
    }, staleTime, refetchInterval, refetchIntervalInBackground, refetchOnWindowFocus };
}

export function followListIdentity(userId, input) {
  const { sort, searchTerm } = settings(input);
  return `${userId}|${sort}|${searchTerm ?? ''}`;
}

export function initialFollowListPage(userId, input) {
  return { listKey: followListIdentity(userId, input), page: 1 };
}

export function setFollowListPage(userId, page, input) {
  return { listKey: followListIdentity(userId, input), page };
}

export function paginateFollowList(rows, userId, input, state) {
  const key = followListIdentity(userId, input);
  const currentPage = state === undefined ? 1 : state.listKey === key ? state.page : 1;
  const all = rows ?? [];
  const start = (currentPage - 1) * 10;
  return { all, displayed: all.slice(start, start + 10), totalCount: all.length,
    currentPage, totalPages: Math.ceil(all.length / 10) };
}
