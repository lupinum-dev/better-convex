# vNext beta.19 clean-consumer failure

Date: 2026-07-25

> Follow-up: beta.20 proved that the `@nuxt/kit` drift recorded here was real
> but not the complete advisory path. The corrected dependency diagnosis and
> bounded decision are recorded in
> [`vnext-beta20-nitro-advisory-boundary-2026-07-25.md`](./vnext-beta20-nitro-advisory-boundary-2026-07-25.md).

## Outcome

The immutable Vue/Nuxt `0.8.0-beta.19` and MCP `0.1.0-beta.7` artifacts are
retired and must never be rebuilt or published.

The package-specific Vue and MCP lanes passed, as did the Nuxt source,
security, authentication, OAuth, concurrency, browser, and production build
gates. The Nuxt lane then failed closed in its isolated npm consumer. The
packed Nuxt manifest allowed package-owned `@nuxt/kit` to drift from the
certified `4.4.8` runtime to `4.5.0`. That clean resolution introduced
`brace-expansion@2.1.2`, which is affected by
`GHSA-mh99-v99m-4gvg`. The existing exception applies only to the separately
bounded `brace-expansion@1.1.16` build-tool graph and cannot cover this
production clean-consumer dependency.

This was a release-contract defect, not evidence for broadening the advisory
exception. The direct correction is to pin the package-owned `@nuxt/kit`
dependency to the exact supported Nuxt peer and enforce that equality in the
canonical dependency tuple.

## Immutable failed artifacts

All three artifacts bind source commit
`6e26f8e15741eb2f455d8a9f3d1960124d6ab08c`.

| Package              | Version         | SHA-256                                                            |
| -------------------- | --------------- | ------------------------------------------------------------------ |
| `better-convex-vue`  | `0.8.0-beta.19` | `0b93ff6c9f965e9e823bf0426a3c52c0e2214c20a8ceae45359fc39031c54f69` |
| `better-convex-nuxt` | `0.8.0-beta.19` | `c4645e9a0dacd3c9fde8525666c02506ff2399ab41f6da905fa02cf54a02dce7` |
| `@better-convex/mcp` | `0.1.0-beta.7`  | `86b4d01b46b2dd0de0d69969cae54199a46dd447fa55d5cb6e7ac3da6c24c43a` |

The Nuxt runtime fingerprint is
`bcn-release-v1-62d96ab7473e050618f61faca5b9498e71adde4f6e48e07f10a85f66b79276ea`.
The ignored artifact directories remain historical local evidence.

## Successor rule

- Vue and Nuxt advance together to `0.8.0-beta.20`.
- MCP advances to `0.1.0-beta.8` so every public candidate binds the same
  corrected source commit.
- Maintained locks are regenerated from temporary exact tarballs only for
  source preparation. Those temporary tarballs are not release candidates.
- Official immutable candidates may be created only after the corrected tree
  is committed and clean.
- Build and certify the MCP lane before the Vue/Nuxt candidate-set lane so the
  Nuxt maintained-consumer matrix can consume the already immutable MCP
  companion.
