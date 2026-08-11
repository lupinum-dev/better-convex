# vNext documentation and package-boundary evidence

Date: 2026-07-25

## Outcome

The active documentation now describes the implemented Better Convex package
family without promoting private release-candidate work or application policy
into shared product contracts.

- `better-convex-nuxt@0.8.0-beta.19` is the full-stack Nuxt source identity. It
  owns SSR and hydration, Nitro server calls, the auth proxy, route middleware,
  uploads, DevTools, and the maintained Better Auth integration.
- `better-convex-vue@0.8.0-beta.19` is the provider-neutral browser lifecycle
  used by plain Vue/Vite, embedded Vue roots, and Nuxt after hydration. It owns
  stable client attachment, identity retirement, queries, pagination,
  mutations, actions, connection state, and disposal. It has no Nuxt, Nitro,
  H3, or Better Auth dependency.
- `@better-convex/mcp@0.1.0-beta.7` remains an experimental,
  provider-neutral Convex-native MCP resource boundary on the locked
  `2026-07-28` release candidate and exact official SDK beta. It is not
  described as final-spec compliant.
- `better-convex-vue/mcp-app` remains an experimental optional entry. Its
  current official Apps SDK limits, credential-free iframe boundary, fallback,
  and missing real-host evidence are explicit.
- Tasks are not exported or documented as a shipped capability. Their
  activation remains gated by the RFC and `P8-001`.
- Ordinary writes remain ordinary application-authorized tools. High-impact
  interaction policy and canonical review/effect state remain
  application-owned. The private locked-RC interaction vocabulary is not
  exported as a final MCP contract.

The root README, choose-your-path page, installation guide, limitations,
package exports, MCP guide, MCP Apps guide, maintained MCP starter, and
changelog now agree on these boundaries. The new plain Vue guide uses the
actual synchronous composables, the single canonical `'skip'` query gate, the
provider-neutral auth adapter, and the frozen embedded attachment.

## Source identity correction

Decision `D-051` retired Vue/Nuxt beta.18 and MCP beta.6 after the dependency
graph changed, but the executable retirement guard had not yet named those
coordinates. Commit `91da3d57` closed that gap:

- the guard now rejects beta.18 and beta.6;
- Vue/Nuxt beta.19 and MCP beta.7 are the fresh source identities;
- all five maintained pnpm consumers use locks regenerated from temporary
  exact beta.19/beta.7 tarballs;
- the temporary tarballs were lock-generation inputs only and are not release
  candidates or evidence for `P9-014`; and
- internal historical laboratories remain on their recorded old coordinates
  until exact P9-014 artifacts intentionally replace them.

No beta.18 or beta.6 artifact was rebuilt, deleted, published, or relabeled.

## Executed evidence

```text
pnpm exec vitest run --project=unit \
  test/unit/package-artifact-coordinate-cli.test.ts \
  test/unit/package-artifact-coordinates.test.ts --reporter=verbose
  -> 2 files, 82 tests passed

pnpm exec vitest run --project=mcp \
  test/mcp/mcp-documentation.test.ts --reporter=verbose
  -> 1 file, 4 tests passed

pnpm run check:api-surface-docs
  -> generated API surface is current

pnpm run check:workspace-deps
  -> 21 manifests passed

pnpm --dir docs build
  -> production Nuxt documentation build passed
  -> 348 routes prerendered, including /docs/get-started/plain-vue
```

The focused checks do not certify package artifacts. Clean-commit source,
packed-byte, production consumer, SBOM, fingerprint, and candidate-set
evidence belongs exclusively to `P9-014`.
