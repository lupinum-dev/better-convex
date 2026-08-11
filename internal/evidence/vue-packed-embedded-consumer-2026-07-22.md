# Packed cross-Vue-copy embedded consumer proof

Date: 2026-07-22

Task: `P4-007`

## Outcome

Two isolated Vite consumers independently install the exact locally packed
`better-convex-vue@0.8.0-beta.0` tarball and their own `vue@3.5.39`. The host constructs the public
`better-convex-vue/embedded` attachment. The separately built embedded application installs the main
Vue plugin with that opaque attachment and consumes the normal public query composable.

No client injection seam, polling bridge, token callback, cross-copy Vue ref, raw replaceable Convex
client, or compatibility path was added. The host is the only identity source of truth; the embedded
plugin owns one disposable local projection.

## Executed proof

```text
pnpm check:vue-embedded-consumer
```

The runner:

- builds and packs Vue once;
- creates two fresh isolated package roots;
- installs the same tarball and pinned dependencies in both roots;
- typechecks both installed-package consumers;
- creates separate production Vite bundles (19 host modules and 75 embedded modules);
- serves both bundles to a real headless browser; and
- compares the two bundled Vue identities before exercising the boundary.

The browser proof establishes:

- the bundles contain distinct Vue copies;
- the attachment exposes only `client`, `anonymousClient`, `identity`, and optional `connection`;
- the stable client exposes only `query`, `mutation`, `action`, and `onUpdate`;
- the identity projection exposes only its six allowlisted state fields;
- a host-only credential sentinel in a raw client field and error cause is absent from projected
  errors, serialized attachment state, DOM, snapshots, and both bundles;
- an initial authentication error prevents a protected query subscription;
- authentication starts exactly one subscription through the embedded package;
- Alice-to-Bob identity replacement retires the old subscription and creates exactly one new one;
- unmount retires the query and the single host identity observer; and
- a later host identity change cannot revive disposed embedded state.

Both the host attachment and embedded plugin paths use only public installed-package exports.

## Deletion

The private `vue-copy-proof` fixture, its source-importing Vite unit wrapper, and the fixture-only
expected report were deleted. Their useful assertions now run through exact public tarball bytes in a
production browser consumer.
