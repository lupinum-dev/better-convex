# Ginko publish-review interaction RC proof — 2026-07-24

## Outcome

Ginko branch `codex/better-convex-vnext-stabilization` projects the private locked-RC interaction onto
Ginko's existing canonical publish-review workflow:

- `86bde379` implements the projection;
- `185ae0ec` resolves newly published production advisories and is the source commit of the exact
  local candidate;
- `2b66ca4f` adds the final application-policy and concurrent-decision proof without changing shipped
  package source.

No Better Convex package gained an interaction export. No second approval, handoff, command, receipt,
or workflow table was added.

## Canonical application ownership

Ginko's existing `reviewRequests` table remains the only review state. The implementation adds one
optional `mcpOperationKey` and an indexed lookup for new MCP-created reviews. Existing records need no
backfill: absence means that the record was not created through the operation-key recovery path.

The application mutation:

1. resolves the current MCP credential, delegated member, permission ceiling, and active owned agent
   run;
2. canonicalizes locales and binds the operation key to the exact review request;
3. returns the same canonical record for an identical lost-response retry, including current stale
   state;
4. rejects operation-key reuse with different arguments;
5. rejects a retry after current role or credential authority no longer permits the operation;
6. inserts the review and operation key in one Convex mutation.

Concurrent identical requests contend on the indexed operation-key range. Executed `Promise.all`
evidence produces one canonical review row. The review request itself changes no public content.

Review authority remains Ginko-owned:

- the fixed locator grants no review or publication authority;
- the initiating MCP subject can recover only its own canonical request;
- current publishers may approve or reject under the existing application policy;
- the application intentionally permits both the requesting publisher and a different publisher;
- Better Convex does not impose a distinct-human/four-eyes rule;
- synchronized competing approvals commit exactly one publication, revision, audit receipt, and
  decision.

Approval still recomputes stale state and executes Ginko's canonical publish transaction. Role
downgrade, viewer access, changed draft/version hash, wrong credential, and already-decided state fail
closed.

## Locked-RC protocol projection

Ginko registers two explicit tools against exact
`@modelcontextprotocol/server@2.0.0-beta.5` bytes:

- `request-publish-review`;
- `get-review-status`.

The interaction mapping is deliberately narrow:

- URL interaction is emitted only when the client advertises `elicitation.url`;
- `requestState` must equal the explicit operation key;
- host-reported acceptance never approves or publishes anything;
- the tool re-reads the canonical application record after host input;
- unsupported clients receive a truthful structured result and still retain the ordinary review
  request/status workflow;
- public tool results expose only the allowlisted `{ id, status, isStale }` projection;
- provider identifiers, requester identity, title, summary, preview, credential, operation key, and
  raw errors do not cross the MCP result boundary.

This is application integration against the locked RC, not a public Better Convex interaction API.
Final terminology and wire mapping remain subject to the final-spec reconciliation gate.

## Inert application locator

When MCP is enabled, Ginko owns one fixed route:

```text
/api/_ginko/reviews/<opaque-review-id>
```

`GET` validates the opaque identifier, performs no Convex call, and redirects only to the existing
configured Studio route with the review identifier. It sets private/no-store, no-referrer, and
noindex/nofollow policy. Opening, prefetching, forwarding, or crawling the link cannot approve,
reject, or publish.

Studio consumes the identifier by selecting the matching pending canonical record once. Login,
current membership, current publisher authority, exact impact presentation, and the explicit
approve/reject mutation remain the application's existing workflow.

## Executed source evidence

Implementation commit `185ae0ec` passed:

- full `pnpm --config.verify-deps-before-run=false run check`;
- 182 passing test files and one skipped;
- 1,208 passing tests and one skipped;
- formatting, ESLint, boundary checks, all package typechecks, Nuxt module build, and Studio
  production Vite build;
- Convex code generation/deployment upload;
- template synchronization, module bridge, and generated-diff checks;
- focused MCP, route, Studio, component, and packed-consumer tests.

Policy-proof commit `2b66ca4f` passed:

```text
pnpm --config.verify-deps-before-run=false exec vitest run \
  test/component/reviewRequests.test.ts
```

Result: one file and nine tests passed. The added test executes:

- approval by the requesting publisher;
- approval by a different current publisher;
- two synchronized current-publisher approvals;
- exactly one committed revision, public projection, audit receipt, and canonical decision.

Formatting, Convex surface validation, and `@lupinum/ginko-cms-convex` source/type-test typechecks also
passed after the proof.

## Exact local candidate evidence

The clean candidate manifest was generated twice from `185ae0ec` and both npm and pnpm packed
production consumers passed. The test-only `2b66ca4f` commit changes no package source; a fresh
candidate remains required by `P6-014` after the shared Phase 6 matrix is complete.

| Package                       | Version         | Source commit                              | SHA-256                                                            |
| ----------------------------- | --------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| `better-convex-vue`           | `0.8.0-beta.15` | `db5127cdfeb294d003c9ec3d4b712b89d4589319` | `dd96a27fe097b6537fd28cc56a2e77580c0fe2c9086633ae77f0bfac3560b835` |
| `better-convex-nuxt`          | `0.8.0-beta.15` | `db5127cdfeb294d003c9ec3d4b712b89d4589319` | `4855b990e3f016ee88b4f283e685480caa659fb983578c5568296ad28e6f80e3` |
| `@better-convex/mcp`          | `0.1.0-beta.5`  | `f4fd5d02b814ce8ee46bbaec8c38c40ec1a80d12` | `cc45a4c9848bb17212f6c1795752bb725fa4ceec3fd15e59b0d42b03e83a2783` |
| `@lupinum/ginko-cms-contract` | `0.2.0-rc.1`    | `185ae0ec961656f834d53221c9b120e7690bd1b4` | `d3ff52d533b6fffbf744515995185385884347a91dcac6352d166bf5c5dbc158` |
| `@lupinum/ginko-cms-convex`   | `0.2.0-rc.1`    | `185ae0ec961656f834d53221c9b120e7690bd1b4` | `61e29bfe7c73d124ca29042019b184ecffd80e4c1123141b0d308b442b393588` |
| `@lupinum/ginko-cms`          | `0.2.0-rc.1`    | `185ae0ec961656f834d53221c9b120e7690bd1b4` | `25521a209f7d40e1ef3d806a18615743c7d90c6b2334d939c1404fe61dd356e4` |

The Nuxt runtime fingerprint is:

```text
bcn-release-v1-53f22482645ee2593d415fee01735197250780fec2f50f7d91b088f107a99d6a
```

The candidate reused the already certified, byte-identical Ginko Content artifact at commit
`fd7e8fda6e60c61244424941c4811c09d626be6f`; it did not rebuild or claim authority over the unrelated
current sibling worktree.

`pnpm audit --prod --audit-level low` reported no known vulnerabilities after exact overrides moved
`shell-quote`, `linkify-it`, `svgo`, and `postcss` to patched published versions. Frozen/offline
lockfile validation and the supply-chain policy passed.

## Remaining limits

- Ginko protected deployment and production cutover remain `EXT-004`.
- The current URL-elicitation vocabulary is locked-RC application code, not a stable Better Convex
  contract.
- `P6-012`/`P6-013` must converge the neutral and Ginko adversarial/disclosure matrices.
- `P6-014` must create a fresh exact candidate from the final Phase 6 source commit and execute the
  complete production interaction lifecycle.
- Final MCP specification, SDK, changelog, and official conformance reconciliation remain mandatory
  before any stable support claim.
