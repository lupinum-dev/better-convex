# ASVS client lifecycle cutover evidence

- Date: 2026-07-22
- Task: `P2-017`
- Standard: OWASP ASVS 5.0.0 Level 2

## Outcome

The Nuxt-owned client engine and its aggregate regression test were deleted by the proven Vue/Nuxt
lifecycle hard cut. Three ASVS controls still referenced those deleted paths, so the canonical ASVS
gate could no longer establish that its evidence existed.

The controls now point to this cutover record, which binds them to the single shipped lifecycle owner
in `packages/vue` and to current behavioral tests. No runtime path, control interpretation, or public
API changed.

## Control mapping

| Control         | Current invariant                                                                                                                                              | Executed evidence                                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `v5.0.0-14.3.1` | An identity transition clears authenticated query, pagination, mutation, and action state and retires stale callbacks.                                         | Exact-package cross-adapter lifecycle proof; query-controller identity-boundary test; auth adapter Alice-to-Bob/revocation tests. |
| `v5.0.0-16.5.2` | Provider, Convex-authentication, settlement, and external-call failures retain no stale authority and do not dispatch an effect before authentication settles. | Auth adapter fail-closed tests; callable settlement-failure test; packed authenticated Vue consumer.                              |
| `v5.0.0-16.5.3` | Exceptions are normalized or contained; failed settlement, stale identity, callbacks, and observers cannot fail open or commit a retired result.               | Auth adapter throwing-listener test; callable failure/identity/disposal matrix; query stale-error rejection tests.                |

The exact-package lifecycle evidence is
[`exact-package-cross-adapter-lifecycle-2026-07-22.md`](./exact-package-cross-adapter-lifecycle-2026-07-22.md).
The enforcing production owners are:

- `packages/vue/src/internal/auth-adapter.ts`;
- `packages/vue/src/internal/client-owner.ts`;
- `packages/vue/src/internal/query-controller.ts`;
- `packages/vue/src/internal/callable-controller.ts`;
- `packages/vue/src/internal/pagination-controller.ts`.

## Verification

The focused proof must include:

```text
pnpm exec vitest run --project=unit \
  test/unit/auth-adapter-port.test.ts \
  test/unit/query-controller.test.ts \
  test/unit/callable-lifecycle.test.ts
```

The certification proof is:

```text
pnpm check:asvs
pnpm verify
```

`generate-asvs-evidence.mjs --check` independently rejects any verified ASVS record whose evidence
path no longer exists, preventing a future ownership move from silently retaining stale evidence.

Results:

- focused lifecycle proof: 3 files, 30 tests passed;
- ASVS: 253 controls, 253 unique controls, and 33 authentication invariants passed;
- full repository gate: formatting, lint, all typechecks, 12 architecture rules across 259 files, and
  156 files / 1,797 tests passed;
- SBOM: 244 production components passed;
- contracts: old engines absent, generated API and 23 manifests current, source fixtures and
  auth-disabled production build passed, and all 9 packed Nuxt entries passed against the reviewed
  local Vue companion.
