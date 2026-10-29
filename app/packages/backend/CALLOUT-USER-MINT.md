# Opt-in user and mint callout lookup

`GET /v1/callout/user/:userId/mint/:coinMint` now reads the existing optional
`CalloutsStore` for an unambiguous live legacy callout. Without a configured
store, explicit fixture replay and the unimplemented fallback are unchanged.

## Contract evidence

OpenAPI 0.294.0 operation `get_callout_user_by_userId_mint_by_coinMint` declares
`content.read` and bearer security. `quotesLimit` is an optional integer from 0
to 20; absent or zero means callout only, with a required empty `quotes` array.
Its callout DTO matches the single-ID legacy DTO except for the seven flat author
summary fields, which are absent. Embedded `quotedCallout` is a separate field
and is preserved, including its unavailable-target/null behavior.

Captured contract factory **957263** is documented and hashed in `CALLOUTS.md`.
The operation literal spans UTF-16 `[76866,76942)` in
`evidence/web/objects/2b47dd0b38a1608f.js` (SHA-256
`e78d2f38b06f971847c18dd05457c75afc85208135f50d6e4022a5f197e8839d`).
Client factory **735821** calls the route at `[5127,5171)` in
`evidence/web/objects/3740fc4e7a24596d.js`, with an empty query on its legacy lane.
These are read-only captures, not executed source or a live server observation.
The captured contract mentions more chain variants than the OpenAPI snapshot;
this local implementation does not claim any of those chain behaviors.

## Local boundary

- Resolve only explicit canonical `authors[].authorId`, never a posting-wallet
  alias. Match `facts.coinMint` exactly among the author's visible, nondeleted
  rows. Groups use their own canonical author, not member/admin identity.
- One matching row reuses the existing single-ID projection and removes only the
  flat author fields. Updates, counters, optional unknown-vs-zero fields and
  one-level quoted callouts retain existing behavior and return-value isolation.
- Known authors with no matching live row return `{callout:null,quotes:[]}`.
  This means absence in this supplied local materialization only, not production
  absence. Hidden/deleted rows do not become results or disclose their contents.
- Unknown authors, visible unmapped rows (whose mint cannot be established),
  multiple matching rows, and a selected row with a nonnull explicit chain
  return local 501 errors. No active-slot selection or chain resolution is guessed.
- Omitted `quotesLimit` and `0` succeed. With no callout, a nonzero limit also
  succeeds with the contract-required empty `quotes`; an existing callout with a
  nonzero limit returns 501 because complete reply-quote carousel facts are not
  available here. Any `chain` and unknown query keys return 501: chain admission
  is likewise unavailable. Repeated keys and malformed/out-of-range limits return
  local 400. Canonical decimal syntax is local policy, not captured coercion parity.
- Preserve the developer-key shape gate and successful-read provenance headers.
  Errors do not receive success provenance. Key verification, scope authorization
  and original error payloads remain unqualified.

The regression suite covers exact schema/field projection, embedded quotes,
zero/absent optional data, canonical identity, group and mint isolation,
visibility, ambiguous/unmapped/chain boundaries, query handling, key gating,
return-value isolation and fixture precedence. The existing callout suites and
source-range checks remain applicable. Coverage records only this opt-in local
slice; complete native API and feature-family qualification remain unchanged.
