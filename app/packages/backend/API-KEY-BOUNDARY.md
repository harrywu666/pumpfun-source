# Developer API credential ambiguity boundary

## Evidence and scope

This is a **local compatibility boundary**, not reconstructed website login,
wallet authentication, credential verification, or a security guarantee.

- `contracts/developer.openapi.json`, OpenAPI `0.294.0`, declares the global
  `bearer` security scheme and names `Authorization: Bearer <key>` and
  `x-api-key: <key>` as alternative ways to present a developer API key.
- The security scheme defines the key's textual shape. It does **not** define
  duplicate-header handling, precedence when both headers are supplied, or
  how to verify a key against an issuer's key store.
- `evidence/api-probes.json` and its `1837f7894abd389a` response establish the
  pre-existing unauthenticated 401 envelope, not multi-credential behavior.
- The gate in base commit `2fc654a20e9c7be2b9529f585942bb82c4c83ab2`
  selected a Bearer candidate before the alias. On the local Node runtime,
  repeated Authorization fields can be discarded during header normalization;
  the first syntactically valid value therefore entered native handlers.

The new code does not infer upstream behavior from that local observation.
Unknown behavior remains `501 COMPATIBILITY_NOT_IMPLEMENTED`, as required by
`app/AGENTS.md`. No live endpoint, credential, wallet, or signing flow is used.

## Local policy

`src/api-key-gate.ts` checks credential ambiguity before the existing shape gate:

1. An array-valued credential header is unqualified, including a singleton or
   empty array. The adapter does not choose a value.
2. Repeated raw `Authorization` or `x-api-key` fields are unqualified, ignoring
   field-name case. Checking `request.raw.rawHeaders` prevents normalization
   from concealing a repeated field.
3. Supplying both credential header types is unqualified, including identical
   values, conflicting values, and a malformed/empty value beside a valid one.

These cases return only:

```json
{
  "error": "COMPATIBILITY_NOT_IMPLEMENTED",
  "reason": "API_CREDENTIAL_AMBIGUITY_UNQUALIFIED"
}
```

No credential, request URL, query, or source header value enters this response.
The gate adds no logging. Existing application logging remains disabled.

A single source retains the existing behavior: well-shaped keys proceed,
missing/unrecognized credentials receive `API_KEY_REQUIRED`, and malformed
key candidates receive `API_KEY_INVALID`. Case-insensitive Bearer parsing and
its existing whitespace handling are unchanged. Unknown routes and diagnostic
routes remain outside this specification-registered `/v1` gate.

The gate runs in Fastify's `onRequest` lifecycle. Therefore an unauthenticated
documented `POST` receives the same credential envelope even when its body is
empty, malformed JSON, or sent with an unsupported `Content-Type`. Body
parsing still runs normally for a request that presents a well-shaped key.

**A well-shaped key is still not a verified credential.** Key issuance,
checksum validation, ownership, scopes, revocation, rate limits, session
credentials, CORS, and live upstream parity remain unimplemented or unqualified.
This change does not qualify a native operation or advance authentication/wallet
completion milestones. Fixture replay and synthetic native data remain separate
from observed production behavior.

## Verification

On Node `24.22.1`, with the unchanged lockfile's backend dependencies installed
using pnpm `10.24.0`, `--frozen-lockfile`, and `--ignore-scripts`:

- `node --import tsx --test test/api-key-ambiguity.test.ts`: 4/4 pass.
- `node --import tsx --test --test-concurrency=1 test/*.test.ts`: 234/234 pass.
- Backend `tsc --noEmit -p tsconfig.json`: pass.
- Backend `tsc -p tsconfig.json`: pass.

The tests cover arrays; identical/conflicting/malformed dual sources; actual
loopback HTTP duplicate fields with mixed-case names; both native and fixture
route gates; automatic HEAD handling; unchanged single-source behavior; and
credential-free error responses. The two integration regression cases fail
against the pinned base handler with HTTP 200 instead of the explicit 501.
All credential strings are clearly synthetic format samples.

Full frontend/SDK build, browser, and complete archived-evidence checks were not
run for this backend-only patch. The local source hydration is intentionally
partial, and the full frontend dependency graph is separately held by a package
minimum-release-age gate. No dependency policy was relaxed, and no lockfile,
SDK, captured evidence, progress ledger, or frontend source was changed.
