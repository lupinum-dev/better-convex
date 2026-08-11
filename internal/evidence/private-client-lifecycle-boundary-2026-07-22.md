# Private client lifecycle boundary — 2026-07-22

## Outcome

The future shared Vue lifecycle now has one enforced private source boundary:
`src/runtime/client-core/**`. It is source inside the root package, not a workspace package, package
export, or public `core` product.

The boundary admits only:

- other files in the same private island;
- the existing framework-neutral `src/runtime/errors/**` authority;
- `vue`;
- reviewed Convex entries `convex/browser`, `convex/server`, and `convex/values`.

Every edge is checked, including type-only imports and dynamic imports. All other bare imports and all
relative imports outside the island/error authority fail closed. This denies `#imports`, Nuxt, Nitro,
H3, Better Auth, Node built-ins, server runtime, MCP runtime, aliases, product diagnostics, runtime
configuration, and the general `utils` directory.

## Why the allowlist is narrow

The ownership inventory showed that allowing the existing `utils` or `auth` directories wholesale would
preserve the coupling Phase 3 is meant to remove. Required lifecycle helpers will move into the island
when their controller moves. Nuxt adapters can depend on the island, but the island cannot depend back on
Nuxt adapters.

The error implementation remains outside because it is already the single framework-neutral public
error authority. Copying or privately relocating it would create a second source of truth. Vue is allowed
because this is intentionally a Vue lifecycle proof; a framework-free public core package remains
rejected.

No empty marker module or placeholder package was added. The rule is executable before the first source
move through positive and adversarial rule fixtures; `P3-003` will create the directory by moving the
existing client owner and deleting its old path.

## Executed proof

```text
pnpm exec vitest run test/unit/convex-auth-boundaries.test.ts --reporter=dot
pnpm run check:boundaries
```

The focused suite proves permitted same-island/error/Vue/Convex edges and rejects framework, auth,
server, MCP, Node, alias, diagnostics, and computed-import edges. The repository scan applies the rule
with type-only exemptions disabled and preserves every existing architecture and workspace dependency
rule.

## Next hard cut

`P3-003` moves the replacement-safe client owner into this island. It must replace direct logger and
DevTools dependencies with a narrow adapter-owned event seam, move the identity-change error, and update
all imports atomically. No compatibility re-export should remain at the old private path.
