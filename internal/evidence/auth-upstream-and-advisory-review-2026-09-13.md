# Authentication upstream and advisory review — 2026-09-13

This review refreshes the two time-bounded authentication release gates. It does not change imported runtime code, widen the supported Better Auth tuple, or authorize a release.

## Imported Convex Better Auth source

The repository-owned upstream monitor queried `get-convex/better-auth` on 2026-09-13 and returned the same normalized observation recorded in the provenance ledger:

- default branch `main` remains at `2f9fcf6c3966bb27d38b2b83e80a1e914ab2a3ee`;
- the comparison from imported commit `c628916b451a6b4cff0f5464f134475464b1a6da` remains `ahead` with no changes in an authorized source seam;
- the repository still has no GitHub releases or published repository security advisories;
- issue #395 remains open and unchanged at `2026-07-04T00:16:27Z`;
- PR #380 remains open, unmerged, and unchanged at head `1e89632a581df7fac57997b3beb6a17acea0dc31` and base `be73010d45299b907d80498abb5e3ea2cc0d2967`.

The only upstream commit after the imported baseline changes `e2e/backendHarness.js` from `provision.convex.dev` to `api.convex.dev`. It is outside the authorized source seams. No imported authentication patch is required.

## Supported Better Auth tuple

The exact `better-auth`, `@better-auth/core`, and `@better-auth/oauth-provider` versions remain `1.7.2`. The known account-schema and two-factor behavior changes in later versions still require a separate migration and compatibility review. This maintenance change intentionally keeps the supported tuple fixed.

## Advisory evidence

`pnpm audit --json` against the current lockfile reported zero findings across 1,203 dependencies. The repository gate also queries GitHub advisories for every exact Better Auth package and the imported upstream repository.

The clean Nuxt consumer retains one narrowly scoped finding: `GHSA-mh99-v99m-4gvg` for `brace-expansion@2.1.3`. On 2026-09-13, npm still reports Nitro `2.13.4` as current and declares `archiver: ^7.0.1`. Archiver 7 uses the affected archive-build graph; Archiver 8 is the first compatible line with the patched dependency family.

The finding remains confined to Nitro's Azure deployment archive builder. Better Convex accepts no glob input, Nitro supplies the constant `**/*` over generated output, and the package is absent from the generated server runtime. A consumer-only override would make clean npm certification inaccurate. The owned exception is therefore renewed for no more than 30 days, through 2026-10-13, and must be removed earlier if Nitro publishes a compatible graph.

## Required verification

Before merging, run the repository upstream and advisory checks plus the exact package/clean-consumer release gate. A stale exception must fail when it no longer matches the installed finding.
