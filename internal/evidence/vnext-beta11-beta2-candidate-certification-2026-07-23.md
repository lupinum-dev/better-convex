# vNext beta.11 / beta.2 candidate certification

Date: 2026-07-23

## Authority

All three candidates were built once from the same clean source commit:

```text
59495d04c477da3acb6d3c834b770a20fbe769ce
```

No package was published and no tag or dist-tag moved.

## Immutable artifacts

| Package              | Version         | SHA-256                                                            | SRI                                                                                               |
| -------------------- | --------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `better-convex-vue`  | `0.8.0-beta.11` | `e2d1461220f3177fad022764605706983b7e368a0e31091b4a6e4cd1e8b5014a` | `sha512-KWmGzHUcqYCQJse4cpIc6iGr+LDfNRg6MR4DKkVtlO2WNscumJ7SL5dxMjgdO3JjxieojsSup75vKbDLd7OM1w==` |
| `better-convex-nuxt` | `0.8.0-beta.11` | `a01651f5a2aad0087786ec981d18673a61d26133ba2b2cd32e0fc4ce7fd9b5d3` | `sha512-9+zc/3yMHRr0ShZ4A5e9nmy9NIsDeUhWXci4Hogm09ILIJ/zkGrg14FNc/PXJVUgLqVqGXbBg0ETzLp7rYdGYA==` |
| `@better-convex/mcp` | `0.1.0-beta.2`  | `531ccb6a54f81d07b7200bd4c8781b8ec430a2be1b7d5b6249d0c3de7615af10` | `sha512-QgW6eliYqtQbobgFOVWwbzkrpqQ2VSDAIG/SD8PCzjgD2K8Grxo7s511qDJ1LNf+/Ih1jIoBs0wjYfX5rY6ZEw==` |

The Nuxt runtime fingerprint is:

```text
bcn-release-v1-87e1cd2fabca08b63545102c041456e78fbfc4b166c0df0f06b583f228c1b8df
```

Vue and MCP intentionally have no runtime fingerprint profile. Their artifact manifests, content
manifests, SBOMs, SHA-256 values, and SRI values bind their exact bytes.

Evidence files:

- `.release-artifacts/set/0.8.0-beta.11/artifact-set.json`
- `.release-artifacts/vue/0.8.0-beta.11/artifact.json`
- `.release-artifacts/nuxt/0.8.0-beta.11/artifact.json`
- `.release-artifacts/mcp/0.1.0-beta.2/artifact.json`

## Executed proof

`pnpm release:prepare:set` passed the closed Vue/Nuxt candidate-set pipeline:

- immutable artifact, content, SBOM, provenance, export, and fingerprint verification;
- the full repository check with 162 files and 1,861 tests;
- auth, OAuth, JWKS, mutation, quota, and concurrency suites;
- production SSR, hydration, browser, DAST, and exact-package lifecycle evidence;
- all maintained Vue and Nuxt npm/pnpm consumers and production builds.

`node scripts/release.mjs prepare --package mcp` passed the static MCP lane:

- exact packed export and content verification;
- exact-tarball contract consumer;
- Better Auth production consumer with live authorization and terminal revocation;
- locked `2026-07-28` RC stateless discovery/conformance proof;
- independent external-verifier Convex HTTP-action consumer;
- malformed-input, boundary, OAuth, and package evidence without repacking.

The earlier Vue/Nuxt beta.10 pair passed its candidate set, but it is superseded because MCP beta.1
failed its independent external Convex consumer by attempting legacy `initialize` negotiation against
the locked RC-only server. Those coordinates remain immutable and are not reused. Decision `D-034`
records the hard cut to beta.11/beta.2.

## Remaining gate

These artifacts are eligible only for exact Ginko integration and local security re-verification.
Publication remains blocked on the protected release authority and final MCP specification
reconciliation described by `EXT-002`, `EXT-003`, and `EXT-005`.
