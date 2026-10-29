# Original exported follow-list client

This bounded reconstruction selects the actual registered **500056.Q** export
inside the shared factory whose readable filename starts `350989`. It follows
that exported read client through **759257.j → 30181.K → 402030/898661** and
**503630.R** to four website operations:

- `GET /following/v3/followers/{userId}`
- `GET /following/v3/followers/search/{userId}`
- `GET /following/v3/following/{userId}`
- `GET /following/v3/following/search/{userId}`

The exact registered export is established; an importing UI caller is **not**
established in the retained captures. No reachable/rendered profile modal or
observed user interaction is claimed. The useful boundary is the exported
client's request plan, normalization, local display pagination and declared
data shapes.

`packages/frontend/src/lib/original-follow-list.mjs` independently reconstructs
those behaviors. Its planners send nothing; `followListQueryOptions` exposes
the executable query callback using a **required caller-owned transport**.
It installs no route, store, UI, identity resolver or follow mutation. The shared factory's mutation hook
**350989**, mutual-follower hook **366510**, and separate count hooks **633113**
are outside this unit.

## Use and reproduce

```js
import { planFollowList, followListQueryOptions, normalizeFollowList, initialFollowListPage,
  setFollowListPage, paginateFollowList } from
  './packages/frontend/src/lib/original-follow-list.mjs';

const plan = planFollowList('followers', 'public-profile-subject');
// plan.request is data. It sends nothing and establishes no ownership.
const rows = normalizeFollowList([]);
const initial = initialFollowListPage('public-profile-subject');
const selected = setFollowListPage('public-profile-subject', 2);
const page = paginateFollowList(rows, 'public-profile-subject', undefined, selected);

// Supply the website-client-shaped capability deliberately. This module
// installs no production origin, fetch implementation or authentication.
function queryOptionsFor(transport) {
  return followListQueryOptions(transport, 'followers', 'public-profile-subject');
}
// options.queryFn({signal}) awaits transport(operation,{params,query,signal})
// and normalizes its JSON. A caller may pass options to its query runtime.
```

From `app/`:

```sh
node scripts/original-contracts/follow-list.mjs --check
node --test tests/original_follow_list.test.mjs
node --test tests/original_follow_list_execution.test.mjs
```

`--write` authenticates the reviewed manifest/inventory and each captured source
length/hash/actual registration, then atomically replaces the generated
[artifact](original-follow-list.json). Its source fragments retain exact URL,
SHA-256, UTF-16 code-unit and UTF-8 byte ranges. It also binds the independent
implementation's SHA-256. Captured JavaScript is only parsed as inert AST.

The producer specifically selects the `e.s(…, 500056)` registration and its
`Q` export. Scope-aware lookup binds the mapper from factory scope, rather
than a same-named variable inside the adjacent mutation hook. It retains the
four selected route declarations and the reachable DTOs, without copying the
unrelated mutation declarations into the generated source fragments.
It structurally checks the selector's actual `j` call, `j`'s `K`/origin calls,
the `K` base-constructor extension order, the barrel's actual client getter,
and its `followingRoutes` catalog spread. Merely loading factories or finding
four route strings is not the import-edge proof.

The query callback snapshots option values at construction, builds fresh
request containers per invocation, forwards the exact AbortSignal, awaits
the supplied transport and applies the original row normalizer. It adds no
userId guard: `enabled` is a query-runtime option, and manually invoking the
callback still invokes transport. Transport errors retain identity; HTTP
error decoding and retries remain outside this callback.

## Source behaviors retained

| Boundary | Behavior in the retained code |
| --- | --- |
| Direction | `followers` selects followers; the other branch selects following. The observed API of the exported client uses those two direction values. |
| Search selection | Any searchTerm other than undefined selects search, including an empty string or null. No trimming occurs in this request selector. |
| Remote fetch size | Plain requests send limit 1000; search sends limit 100. No offset is sent and no remote continuation is implemented here. |
| Sort | Default is `followers` and is omitted from a plain request. Other values are forwarded on plain reads. Search ignores sort in the request while retaining it in cache identity. |
| Enablement | Truthy subject and enabled-by-default option. The request callback has no additional userId guard; the pure plan retains this distinction. |
| Cache tuple | `['follow-list', direction, userId, sort, searchTerm ?? '']`. No TanStack hashing/runtime claim follows from the tuple alone. |
| Query policy | staleTime 30,000 ms; refetchInterval 60,000 ms; background interval false; window focus true. This unit does not recreate scheduling. |
| Normalization | Non-array result becomes `[]`. Object rows are spread; address defaults to empty, `user_id ?? userId ?? null` selects identity, and kind defaults to person. Defaults are nullish-only. Null, arrays and primitive rows throw `TypeError` before defaults are applied. |
| Local display | Ten rows per page, using array.slice. totalCount is fetched-array length; totalPages is its length divided by ten and rounded up. These are not remote graph counts. |

**This is local pagination over one bounded fetch**, not a remote offset pager.
A 1,000-row returned array does not establish that the entire graph was fetched.
The original helper preserves incoming row order and does not re-rank results.
This module does not mount React or install TanStack. Memo-cache identity,
framework scheduling, refetch invocation and rendering remain the consumer's
responsibility.

The source's quirks are retained rather than silently corrected:

- Absent, empty and null search terms share the same last cache-tuple element,
  despite selecting different requests. A null/empty search can violate the
  declared search schema; this client does not parse it before sending.
- The local page-reset identity is `${userId}|${sort}|${searchTerm ?? ''}`.
  It omits direction. The page resets when that identity changes, and otherwise
  keeps its previous number—even if the returned array shrinks and the
  displayed slice becomes empty. No page clamp is added.
- The legacy `user_id` alias precedes `userId`, including when the alias is
  empty. This is the captured client normalization, even though the declaration
  calls the alias deprecated.

The row-type guard is a bounded reconstruction defense, not a claim that the
captured JavaScript parsed its declared response schema. Without it, object
spread and nullish defaults turn a primitive or nested-array row into a blank
"person" entry. The guard keeps the captured object-row fallbacks and preserves
the non-array-to-empty behavior.

Actual interaction outcomes still depend on missing callers and framework
runtime. The guard proves malformed-response handling, not that production
served such a row.

## Website transport and declarations

The four-way selector calls `j()` without credential, Content-Type or
Authorization overrides. **759257.j** defaults credentials to **same-origin**,
overriding the lower-level transport's include default. This differs from
the Home-feed caller's explicit include option in
[PR686](https://github.com/lalalune/pumpfun-source/pull/686). No browser cookies,
authenticated viewer or server authorization policy is inferred.

The origin is the captured literal `https://frontend-api-v3.pump.fun`. The
shared contract client handles path/query serialization and returns JSON
without whole-request/response schema parsing. This selector installs no
HTTP hooks; generic HTTP/error conversion is a separate source unit in
[PR691](https://github.com/lalalune/pumpfun-source/pull/691).

**972407.followingRoutes** declares params, queries and responses for all four
paths through `publicRead('graph.read', …)`. The plain schemas permit limits
up to 1000 and sort followers/recent; search permits limits up to 100 and a
1..50-code-point string. Offsets are nonnegative safe integers, but this
particular client does not send one. Prose about trimming, minimum effective
search length and server ranking is kept as description, not invented
schema refinements or implemented server behavior.

Plain responses use compact rows; search responses use **896727.userRow**.
Followers can also carry optional viewer-relative mutuals. The reachable
description/open-enum dependencies close through **890664** and **617159**.
The offline declaration checker accepts the declared predicate language; it
does not apply defaults, strip output fields or implement host-specific privacy.
The two plain declarations explicitly list an unstructured 503 error arm;
no production error response is captured or claimed.

The normalizer's unknown-field retention is **client** behavior. It must not
be reused as a privacy-safe backend projection. Viewer-relative field
descriptions and optional fields are not authority to expose private data.

## Ownership and limits

Live overlap checks read [PR662](https://github.com/lalalune/pumpfun-source/pull/662)
at `577dee4bbf7bc8f3ce310b566f40a3637c2d90a7` and
[PR689](https://github.com/lalalune/pumpfun-source/pull/689) at
`9534a06c32f6cabfc07db8d7e8a3e1ac6a2a5a45`. Those separate changes fix local
backend graph/profile boundaries and add a single-callout backend read model.
Their stores, routes, validators, behavior and novelty claims are untouched.
The search/auth workers confirmed no ownership overlap.

The shared authenticated source-reader prerequisite belongs to PR684; the
shared bounded schema extractor/validator was introduced with PR686. Neither
is counted as new follow-list recovery. PR693's profile-callout domain files
are not required or included. The maintained 5,947-variant index includes all
selected factories.
[`original-follow-list-index-compatibility.json`](original-follow-list-index-compatibility.json)
compares all 15 selected complete entries against the published 4,915 index at
PR693 head `d6e176c105840ae475eff07f629b96c883d4706a`: IDs, hashes, paths,
origin URLs and ranges are identical. Index expansion belongs to PR679, and
shared source/schema primitives belong to PR684/686; none is credited again.
No extra prerequisite commits are included.

This unit adds no documented operation to the existing 67-operation ledger.
The frontend profile contract milestone gains a pointer to bounded source
evidence; no milestone status, native implementation/compatibility count, or
feature-completion score changes. Generated progress tables remain equal.

## Executed checks and limits

Twenty-one focused tests cover source/implementation/range authentication,
actual-capture tampering, declarations, scalar-option capture, fresh request
containers, source cache/page quirks and execution through the query callback.
Four real loopback HTTP reads cover both directions and plain/search paths,
served-order normalization and ten-row local pages without extra requests.
Separate real loopback tests cover a controlled503 and pending-fetch
AbortSignal cancellation.

The loopback transport and JSON data are **local test design**. They are not
captured production responses, an implementation of Ky/cookies, an authentic
viewer session, or a reconstructed server. These tests do not certify TanStack
scheduling or every transport case. Captured JavaScript is never evaluated.

The coordinator owns the full Next build/browser aggregate to avoid parallel
caches on the disk-constrained shared workspace; this unit does not claim
those results. No TSX, CSS, route mount or browser UI changes, so no new
screenshot or visual-parity claim applies.

No live response, native API, real graph, authenticated workflow, backend
compatibility, feature qualification, persistence or security acceptance is
established. Original captures, prior packets, SDK sources, synthetic/historical
pages, paused work and all qualification counts remain unchanged.
