# Packed anonymous Vue consumer proof

Date: 2026-07-22

Task: `P4-004`

## Outcome

A standalone Vue/Vite application now installs the exact locally packed
`better-convex-vue@0.8.0-beta.0` tarball and consumes the plugin, query, pagination, mutation, action,
and connection-state APIs without any authentication adapter.

The fixture is an isolated package-manager root. It does not resolve a workspace link, import package
source, or depend on Nuxt. Its production dependency graph contains no Better Auth, OAuth Provider,
Nuxt, Nitro, or H3 package, and its emitted browser bundle contains none of those package markers.

## Executed proof

```text
pnpm check:vue-anonymous-consumer
pnpm exec eslint scripts/check-vue-anonymous-consumer.mjs \
  test/fixtures/vue-anonymous/src/main.ts
```

The runner performed the following operations in a fresh temporary directory:

1. built `packages/vue`;
2. packed it once with lifecycle scripts disabled;
3. installed that tarball with pinned pnpm, Convex, Vue, TypeScript, and Vite versions;
4. typechecked the consumer against installed declarations;
5. built a production Vite bundle;
6. inspected the complete production dependency graph and browser output; and
7. removed the temporary consumer and tarball.

Result: 77 production modules built successfully. The local proof tarball SHA-256 was
`3854e2f3132ca6106de27e561bf4ef6984934fac97154edf7510c3e4b8ca31ac`. This hash is evidence for
this working-tree proof only, not a release artifact identity; `P4-013` owns immutable candidate-set
hashes.

Anonymous lifecycle behavior remains covered by the shared runtime/controller tests and the clean
`P4-003` matrix. This task adds installed-byte production build and dependency-absence evidence; it
does not introduce an auth provider or a second lifecycle implementation.
