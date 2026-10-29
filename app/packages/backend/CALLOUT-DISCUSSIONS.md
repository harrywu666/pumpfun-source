# Opt-in live callout discussion graphs

This separate read model implements a bounded public ordinary-reply graph for
`GET /v1/callout/:calloutId/replies` and
`GET /v1/callout/replies/:replyId/chain`. It is not original backend source,
persistence, a production adapter or complete API compatibility. It has no
default dataset. Financial ranking remains an explicit 501 boundary. Bounded
tombstones preserve required list/chain paths without exposing dead-row facts.
No coin page/UI, quote/repost graph, write endpoint, wallet, production request,
authentication service or financial computation is added. The existing
single-callout and separately proposed author-list models are not republished or
replaced.

## Evidence

Developer OpenAPI **0.294.0** declares both operations as in-scope `content.read`.
The binding ledger still marks website origin unresolved; this runtime adds no
website transport. Exact retained-source UTF-16 half-open bindings:

- `2b47dd0b38a1608f.js`, factory **957263** `[53841,88580)`: replies literal
  `[83087,83153)`, chain literal `[80661,80731)`.
- Same object, factory **421504** `[434218,446195)`: recursive reply DTO, public
  author identity, linkage/counts, nullable financial/viewer knowledge, previews
  and tombstone descriptions.
- `84bc29ea82bc5a21.js`, factory **408750** `[24052,26508)`: GET literal
  `[24917,24951)`, explicit limit 200, author/all filter, parent ID forwarding and
  optional client tombstone filtering. This client also serves excluded coin
  community UI and mutations; none of those surfaces are implemented here.
  An explicit client limit does not establish a server default.

Full objects under `evidence/web/objects/`, capture timestamp
`2026-10-28T10:48:45.546100+00:00`:

- `2b47dd0b38a1608f.js`: 507700 bytes, SHA-256
  `e78d2f38b06f971847c18dd05457c75afc85208135f50d6e4022a5f197e8839d`.
- `84bc29ea82bc5a21.js`: 30850 bytes, SHA-256
  `e43cd74332acc827da95e824c3d2c1cf01392c42a17d8ae19ebfe41c3bd7d163`, URL
  `https://pump.fun/_next/static/immutable/chunks/39qv0xx4r245r.js`.

Factory hashes respectively:
`9bf6001fe60fa67d0d941c7cac3f6d8b1b5eda390213e998bb00867c3ea0ba93`,
`9e63d9f98b410e0c7334bd1c07e7ea72f9bd1b95710ea69dae45e4c253b0368a`,
`c59bcb8e29907440b02c9f1e0f99d041a685fc9c97a40219bd8eae802615fd64`.
Tests check full bytes, factories, literals and manifest. JavaScript is only
read/decoded/sliced/hashed, never executed. No native response body or exact
server tombstone-default mapping was captured.

## Local materialization

`CalloutDiscussionsDataset` supplies flat public authors/reply facts and parent
references. The store validates topology and assembles response trees, rather
than replaying complete fixture responses.

- `schemaVersion: 1`, **`complete: true`**, source and observation are mandatory.
  Source/observation must match the associated callout store. This is an operator
  assertion of completeness for ordinary replies in listed **local** scopes,
  not proof of upstream completeness or that independent files describe the
  same world. `calloutIds` declares known scopes, including known-empty ones;
  every root must exist in the supplied callout store.
- Authors carry canonical ID/name/profile/account kind and nullable public
  wallet. Group reply authors must be walletless, never an acting admin wallet.
- Rows have explicit ID/callout/parent, `kind: "reply"`, hidden/deleted flags and
  author reference. Live rows supply scalar DTO facts, including required
  financial values. Null remains unknown; PnL may be negative. Dead rows must
  have **null authorId and null facts**: topology only, no retained private body.
- Duplicate/dangling/cross-callout links, cycles, unknown roots/live authors,
  unsafe counters, nonfinite or negative spot amount/value facts, invalid UTC
  dates, getters/prototype fields, viewer state and prebuilt trees fail admission.
  Ancestry validation is iterative, avoiding stack exhaustion on deep graphs.
- Direct counts include live direct children; top-level thread counts include
  live descendants at all depths, even behind dead bridges. These are counts
  of the declared **local graph**, not upstream totals. Independently supplied
  callout social counters are not rewritten. Materializers own public-data
  classification, identities, financial accuracy and snapshot coherence.
  Inputs and returned nested objects are cloned.

## Supported reads and local policies

Lists return one direct-child level, or top-level ordinary replies without a
parent. `ALL` serves live rows plus a dead bridge whose subtree still has live
rows; `AUTHOR_ONLY` and `EXCLUDE_AUTHOR` filter live rows using the visible
callout's canonical author. Quote threads are outside this dataset contract.
`beforeId` must identify an eligible row, including an included bridge tombstone,
in that level/filter; locally it resumes after that row in the immutable sorted
array. It is not a signed/opaque cursor or upstream pagination proof.
Unknown/cross-level/filtered IDs return local 400.

Local defaults are **limit 30 / ALL / RECENCY / nestedLimit 0**; original server
defaults are unknown. Canonical positive decimal safe-integer limits are accepted.
Rows sort newest first; unknown timestamps sort last, with descending code-unit
ID ties. `nestedLimit` is nonnegative and caps at 10 as described by the captured
contract. Previews are newest live direct children, deduped against the callout
author's earliest live child (`authorReply`). Earliest-child unknown times sort
last, ties by ascending ID. Preview hydration is one level deep; nested preview
rows carry empty previews/null authorReply rather than recursively expanding.
These null/tie/depth choices are local, not recovered backend behavior.

`POSITION`, `PNL` and any `page` parameter return 501; no financial ranking is
invented. Unknown keys return 501; duplicates/malformed supported values return 400.
These error payloads are local, not production-qualified. List completion uses
the declared short-page convention. No chain query parameters are supported.

Chains return ancestors top-first, immediate-parent last, with linkage derived
from validated topology. Visible root context uses the existing separately
supplied one-level public quote projection. Missing projection returns 501, not
false hidden/null context. Unavailable quoted-target IDs remain intact without
recursive expansion. An explicitly hidden/deleted callout has null body while a
fully live public chain still serves, as declared. Its hidden author identity is
neither returned nor used for authorReply hints. Unknown/unmappable contexts,
replies or scopes return 501, not a claim of production absence/REPLY_NOT_FOUND.

### Bounded tombstone placeholders

The source requires dead placeholders but does not establish the exact required
empty identity and financial primitives. For an `ALL` list row or chain ancestor
that must preserve a path to live descendants, this implementation projects the
captured DTO shape with the real ID/linkage/live counts, blank required strings,
`accountKind: "person"` as a schema-required neutral wire value, zero nonnegative
counter/cost-basis fields, null optional knowledge and `tombstone: true`. Clients
must branch on `tombstone` before reading those placeholder fields. This mapping
is local, not recovered native server behavior.

Dead leaves are absent; non-ALL filters omit dead rows because the declared
tombstone-page rule applies to ALL. A dead target chain or a request whose
`parentReplyId` is dead still returns 501
`CALLOUT_DISCUSSION_TOMBSTONES_UNAVAILABLE`; no dead content, author identity or
private fact is retained or returned.

## Runtime and checks

```sh
CALLOUTS_FILE=/absolute/operator-owned/callouts.json \
CALLOUT_DISCUSSIONS_FILE=/absolute/operator-owned/discussions.json \
  node packages/backend/dist/server.js
```

The discussion file requires the callout file. Both validate before media
acquisition or server listen. The loader accepts regular UTF-8 JSON up to 8 MiB,
never URLs. Atomic replacement and restart is the update model; no writer,
database or concurrent in-place-write support is added. Programmatic callers
can supply `calloutDiscussionsStore` to `buildApp`.

Without the store, fixtures/501 are unchanged. With it, these routes take
precedence over fixtures inside the existing developer-key **shape** gate, not
credential/session/scope verification. Success labels source, observation and
unqualified compatibility. Tests cover schemas/provenance, topology/long chains,
chronology/cursors, previews/identities, privacy/unknowns, immutable reads, file
loading, real startup failures before media acquisition, and combined callout,
positions/media gates and cleanup. They are synthetic local checks. Full
frontend/browser/workspace, production or native-response compatibility is not
claimed. The ledger adds only a partial local model; native-qualified/full-
operation and feature-completion totals remain unchanged. Peer/aggregate checks
are reported with the PR.
