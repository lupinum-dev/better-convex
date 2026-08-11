# Ginko Vue hard-cut evidence — 2026-07-22

## Outcome

Ginko CMS branch `codex/better-convex-vue-hard-cut` now consumes the exact
`better-convex-vue@0.8.0-beta.4` and `better-convex-nuxt@0.8.0-beta.4` candidate pair. The branch is
pushed at `332a540a`.

The implementation cut is commit `361b2ee6`:

- 45 files changed;
- 785 lines added and 1,652 deleted;
- net 867 lines deleted;
- Ginko's duplicated subscription, identity-generation, pagination, mutation, and action lifecycle
  paths were removed;
- Ginko retained contract preflight, CMS authorization/presentation policy, facets selection, uploads,
  and domain error mapping.

This is a hard cut. There is no compatibility engine or second client lifecycle.

## Exact package evidence

The Ginko candidate uses the immutable Better Convex beta.4 set produced from BCN commit
`1f74055692cf671bc26cfb50ce8bf48f80067b23`:

| Package                           | SHA-256                                                            |
| --------------------------------- | ------------------------------------------------------------------ |
| `better-convex-vue@0.8.0-beta.4`  | `d2b2b8a98fcd83beaddbcf32ddfb70628b96dd4cfb347746a8baec5e0ee0bf71` |
| `better-convex-nuxt@0.8.0-beta.4` | `dd039f0781ac005f3c209ab2ce493c51b022466cd2ac218d0735b8594dbcfa9c` |

The Ginko release tooling was changed in `d185bd0b` to certify the pair, verify installed versions and
lock references, and preserve both artifact attestations. Ginko Content was rebuilt from its pinned
clean commit `fd7e8fda6e60c61244424941c4811c09d626be6f` with pnpm `10.33.0`; the reproducible artifact hash
was recorded in `332a540a` before the candidate pack was accepted.

## Executed proof

The migrated branch passed:

- focused Studio lifecycle tests: 10 files, 37 tests;
- Studio typecheck;
- production Studio Vite build;
- full Vitest suite: 186 files passed, one skipped; 1,241 tests passed, one skipped;
- formatting across 1,195 files;
- exact candidate pack with the Nuxt/Vue beta.4 pair;
- pnpm exact-tarball production consumer, including Nuxt production build, package imports, content
  safety probes, and portability verification;
- npm exact-tarball production consumer with the same proof.

The portable workspace lock intentionally names the future registry versions. A fresh registry install
remains expected to fail with `404` until the separately protected publication step; the exact-tarball
consumer proof does not depend on publication.

## Product conclusion

No additional Better Convex API was required. The existing opaque attachment and shared Vue
composables were sufficient. This validates `D-017`: generic lifecycle belongs to Better Convex while
Ginko-specific authorization, contract, workflow, metadata, upload, and presentation behavior remains
application-owned.
