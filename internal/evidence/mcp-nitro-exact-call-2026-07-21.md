# Nitro exact-call proof — 2026-07-21

## Scope

This closes private laboratory task `P1-011`. It answers whether the Nitro-native MCP candidate can
terminate an MCP bearer at Nitro and invoke one explicit Convex operation with a separate, tightly bound
credential. It does not select Nitro, publish a Trusted Calls product, or grant application authority.

The proof is intentionally isolated under `internal/labs/mcp-topology/nitro/exact-call`. If the
Convex-native topology wins, this entire prototype is deletion evidence rather than retained product
code.

## Mechanism proved

- The signer and verifier use Web Crypto Ed25519 with a dedicated lab key pair. No Better Auth, OAuth,
  Convex session, or deployment key is reused.
- A compact signed proof has an exact versioned header and payload allowlist. It binds proof issuer,
  deployment audience, key ID, service ID, call ID, issuance/expiry, operation kind, exact generated
  Convex function name, canonical argument digest, and the delegated MCP issuer/subject/client/resource/
  scope context.
- Proof lifetime is at most 15 seconds with no renewal or clock-skew widening in the laboratory.
- Unknown header, payload, delegated-context, and authorization-reference fields fail closed.
- Convex's pinned `convexToJson`/`jsonToConvex` implementation is the sole Convex-value interpretation.
  The digest is SHA-256 over its recursively sorted wire representation. The internal HTTP hop also
  requires that exact canonical representation, rejecting alternative object order and `__proto__`
  encodings even when their semantic digest could otherwise match.
- Five fixed HTTP routes invoke five fixed generated references. No proof claim constructs or selects
  a function dynamically.
- Only `(MCP issuer, subject)` crosses into the application actor resolver. Client, scope, call, proof,
  and private authorization-reference data are absent from application results.
- Current membership is loaded inside the Convex operation. A valid proof created before member removal
  is denied after removal.

## Replay contract

The proof authenticates an invocation; it does not claim generic exactly-once execution.

| Wrapper  | Replay invariant                                                                                                                                                           |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Query    | Read-only; proof replay creates no effect.                                                                                                                                 |
| Mutation | Application `requestKey`, receipt, and note write commit in one Convex mutation.                                                                                           |
| Action   | The neutral report has no external side effect and reads current state. A real external API would require its own application intent, idempotency key, and reconciliation. |

Eight concurrent calls carrying the identical signed mutation proof produced one rename receipt and one
note revision. Repeated action calls produced no write or replay state.

## Executed evidence

The Node/unit matrix proved 37 cases, including:

- null, booleans, ordinary numbers, positive/negative zero, NaN, infinities, full int64 boundaries,
  Unicode strings, bytes, arrays, and recursively sorted objects;
- equivalent object ordering and omitted undefined object fields according to the pinned Convex client;
- static redacted rejection of unsupported `undefined`, Date, Map, Set, typed-array, and out-of-int64
  values;
- strict issuer, audience, service, operation, function, argument, delegated issuer/resource/scope,
  time, algorithm, key, header, claim, nested-field, and compact-encoding rejection;
- retained verification-key acceptance and absent retired-key rejection;
- mutation-after-signing rejection; and
- omission of the private authorization reference and compact proof from the verified result.

A fresh anonymous local Convex deployment then proved:

- the same 13 supported value vectors produce byte-identical canonical JSON and digests in Node and the
  deployed Convex action runtime;
- Ed25519 key import and verification execute in Convex without Node imports, a polyfill, or HMAC
  fallback;
- explicit search/resource queries, rename/delete mutations, and report action routes call current
  application functions;
- live member removal denies a still-cryptographically-valid call;
- concurrent replay produces one canonical application effect/receipt;
- issuer, audience, service, operation, function, arguments, delegated issuer/resource/scope, time,
  algorithm, unknown claim, retired key, alternative encoding, proof collision, and wrong-route inputs
  fail closed; and
- proof bytes, call IDs, OAuth authorization reference, client ID, MCP issuer/resource, and actor context
  are absent from response bodies.

The local backend helper gained one explicit test-only `requireAuthDeployment: false` mode. It waits for
deployed Convex functions and forwards only the fixture's reviewed deployment variables; it does not
inject Better Auth secrets or require a fabricated `/api/auth/get-session` route. Existing callers retain
the Better Auth readiness default.

## Reproduction

```sh
pnpm exec vitest run --project=unit test/unit/vnext-exact-call-proof.test.ts
pnpm exec vitest run --config internal/labs/mcp-topology/nitro/exact-call/vitest.config.ts
pnpm exec vitest run --config internal/labs/mcp-topology/convex/vitest.config.ts
pnpm exec vitest run --project=unit test/unit/local-convex-options.test.ts
pnpm exec eslint test/helpers/local-convex.ts internal/labs/mcp-topology/nitro/exact-call test/unit/vnext-exact-call-proof.test.ts
pnpm exec vue-tsc --noEmit --project tsconfig.json
```

Result on 2026-07-21: 37 unit cases, three deployed exact-call cases, and the existing deployed
Convex-native MCP regression passed. Focused lint and root type checking passed. The first deployed
attempt exposed that the shared helper assumed every local Convex fixture served Better Auth; the helper
was narrowed as described above, after which both the provider-neutral mode and the existing default
Better Auth readiness mode passed.

On 2026-07-22, `P1-020` hard-cut the deployed fixture to the complete neutral operation contract and
deleted the unnecessary report receipt. The same proof then passed through the production Nitro MCP
edge; see `internal/evidence/mcp-nitro-integrated-path-2026-07-22.md`.

## Decision input

Nitro remains technically viable, but its cost is now concrete: a dedicated signing key lifecycle, an
extra signed HTTP hop, strict canonical transport, and one explicit internal route/wrapper per operation.
Candidate A currently passes without any of this machinery. The topology decision remains open until the
final MCP specification/SDK, URL interaction, Apps, conformance, host, and operational evidence are
complete.
