# Native /following operations

Seven of the 67 documented operations now answer from a native handler instead of
the compatibility stub:

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/v1/following/single/{id}` | `{ follow: { following_id, user_id, timestamp } \| null }` |
| GET | `/v1/following/v3/followers/count/{userId}` | `{ count }` |
| GET | `/v1/following/v3/following/count/{userId}` | `{ count }` |
| GET | `/v1/following/v3/followers/search/{userId}` | full user rows |
| GET | `/v1/following/v3/following/search/{userId}` | full user rows |
| GET | `/v1/following/v3/followers/{userId}` | compact follow rows |
| GET | `/v1/following/v3/following/{userId}` | compact follow rows |

Files: `src/following-store.ts`, `src/following-routes.ts`, `src/following-seed.json`,
`test/following.test.ts`. Registration is in `src/app.ts` — the seven paths are added
to `NATIVE_ROUTES` so the fixture replay loop steps aside, and the handlers are
registered inside the same `native` scope that carries the API-key gate.

## Two row shapes, deliberately

A page of followers and a search over followers do **not** return the same object
shape, and the contract says so:

- `GET /following/v3/followers/{userId}` and `.../following/{userId}` return a
  compact follow row, required:
  `username`, `profile_image`, `resolved_avatar_decoration`, `address`, `userId`,
  `user_id`, `kind`, `timestamp`, `followers`. There is no `bio` and no `following`
  count, and `additionalProperties: false` forbids passing a full user row through.
- `GET /following/v3/followers/search/{userId}` and `.../search/{userId}` return the
  full user row, the same shape served by `GET /v1/users`.

The store therefore projects the compact shape explicitly (`toFollowRow`) rather than
returning the shared `User` object, and the conformance test fails if the two are ever
confused.

## Assumptions the contract does not settle

1. **Synthetic data.** Rows come from `following-seed.json` and the existing user
   seed. Every response carries `X-Reconstruction-Data-Source: synthetic-seed-play`.
2. **No 404 on an unknown user.** The contract documents no 404 schema for these
   operations, so an unknown `userId` answers an empty page, and a count of `0`.
3. **Paging is rejected, not clamped.** The documented descriptions say out-of-range
   values are "rejected with 400, not clamped", which differs from the `/users` slice.
   `limit` outside 1..1000 (1..100 on search), a negative or non-integer `offset`, and
   an unknown `sort` all answer 400. The error codes `INVALID_LIMIT`,
   `INVALID_OFFSET`, `INVALID_SORT` and `INVALID_SEARCH_TERM` are ours; the contract
   lists no code for a malformed query parameter.
4. **Search term bounds.** `searchTerm` has `minLength: 1` and `maxLength: 50`, so an
   empty value and anything longer than 50 characters answer 400. A term that is
   shorter than two characters *after trimming* answers `[]` without searching, as the
   description states.
5. **`mutuals` is omitted.** The contract marks it viewer-relative and present only on
   a signed-in read of a page of at most 100 rows, never on the API host. Absent means
   "signal not computed", which is the honest state here.
6. **Counts are edge counts.** `count` is the number of seeded edges, which can disagree
   with the `followers`/`following` numbers on a user row. The seed is small and the
   two are independent by construction; the count route is defined by the graph.
7. **`timestamp` is the edge timestamp**, and `user_id` duplicates `userId` because the
   schema requires both.
8. **`kind` defaults to `person`** when the underlying user row omits it, matching the
   documented enum.
9. **Ordering.** `sort=followers` (default) orders by the row's follower count; `recent`
   orders by edge timestamp, newest first. Ties break on username then `userId`, so
   consecutive pages cannot duplicate or skip a row.
10. **Search ranking** is exact username, then prefix, then substring, then address
    substring; ties break on username then `userId`.
11. **Offset upper bound** is `9007199254740991`, the maximum explicitly declared
    by all four page/search operation schemas. Larger values return the existing
    `400 INVALID_OFFSET` error rather than silently accepting imprecise numbers.
12. **Duplicate query keys** fail closed with the compatibility harness's existing
    `501 DUPLICATE_QUERY_KEYS_UNIMPLEMENTED`, including percent-encoded aliases of
    the same key. This is a local unsupported boundary, not a claimed upstream
    status. No array is coerced into a scalar viewer, pagination or search term.
13. **API-host privacy**: full-profile search results omit `last_active_at` even
    when null. Its shared schema allows the property for signed-in website views
    but explicitly excludes it on the developer host. Compact list rows already
    omit it. Projection preserves stored users and does not invent a viewer.
14. **Subject aliases.** The captured v3 route schema describes `userId` as
    "Subject: cc user-id UUID or wallet", and the documented SDK example passes
    `user.address`. The store resolves both the requested subject and each edge
    endpoint through the shared `UserStore` address/userId indexes before
    comparison, so either spelling addresses the same follow graph.

These boundaries use the declared `https://api.pump.fun/v1` contract (OpenAPI
`0.294.0`), not a guessed website graph origin. The bindings in
`contracts/developer-bindings.json` resolve to the captured graph contract factory
`recovered/modules/972407-a77710a323d3.js`, SHA-256
`a77710a323d3fa83fc470b2e3837d2da42a97a6726c92ce96dd73e236c0a6365`.
This is inert source provenance only. The synthetic
`test/profile-graph-contract-boundaries.test.ts` checks these constraints and valid
query regressions; it does not add live traffic or compatibility qualifications.

## Verification

```
cd app/packages/backend
npx tsx --test test/*.test.ts   # 230 tests, 0 fail
../../node_modules/.bin/tsc --noEmit -p tsconfig.json
```

The seven operations were also probed live against a running server, with every 200
response validated against the published schema (including `$ref` and `anyOf`).
