# Experimental MCP package boundary — 2026-07-22

## Outcome

`packages/mcp` is admitted as the third reviewed workspace and certification package. The initial
`@better-convex/mcp@0.1.0-beta.0` artifact deliberately contains only the provider-neutral access
contracts approved by `D-022`; it does not yet claim a working MCP handler or final `2026-07-28`
compliance.

The package has one exact runtime dependency:
`@modelcontextprotocol/server@2.0.0-beta.5`. It has no Nuxt, Nitro, H3, Vue, Better Auth, or sibling
workspace dependency. A new architecture rule permits only the official MCP server SDK within the MCP
source island.

## Closed certification profiles

The reviewed descriptor binds all release-relevant choices without caller-selected paths:

- package: `@better-convex/mcp` in `packages/mcp`;
- build: ESM-only `unbuild` output;
- exports: one exact root entry;
- packed files: `LICENSE`, `package.json`, `dist/index.mjs`, and `dist/index.d.mts` only;
- production manifest: exact official SDK dependency and no peer/optional dependencies;
- SBOM: direct official SDK plus its resolved production closure;
- candidate: one exact-tarball type/runtime consumer;
- runtime fingerprint: forbidden for this library-only package.

The current JavaScript entry has no runtime exports. That is intentional: the verifier and handler
runtime will be admitted only after their behavior is implemented and proved, rather than publishing
illustrative wrappers ahead of evidence.

## Executed evidence

From the frozen workspace on 2026-07-22:

```text
pnpm exec vitest run --project=unit test/unit/package-*.test.ts \
  test/unit/maintained-candidate-apps.test.ts
  14 files, 211 tests passed

pnpm check:boundaries
  13 rules, 4 packages, 261 source files passed

pnpm --dir packages/mcp typecheck
pnpm --dir packages/mcp build
node scripts/check-package-exports.mjs --package mcp
  typecheck, build, source scan, and packed entry passed

node scripts/check-candidate-apps.mjs --package mcp
  one exact tarball installed in a clean consumer;
  declaration typecheck, installed-byte equality, zero runtime exports,
  and exact official SDK dependency passed

pnpm format:check
  1,142 files passed
```

The generated MCP SBOM contains the exact production closure observed in the frozen graph:

- `@modelcontextprotocol/server@2.0.0-beta.5` (direct runtime dependency);
- `@modelcontextprotocol/core@2.0.0-beta.5`;
- `zod@4.3.6`.

## Security and product conclusions

- This package boundary does not make Better Auth mandatory.
- It does not create another MCP tool registry, parser, authorization DSL, principal union, or result
  framework.
- The official SDK remains the sole protocol owner.
- `McpAccessContext` contains identity provenance and token ceilings, not application authority.
- Runtime token termination, private provider-reference handling, and safe-context construction remain
  unclaimed until `P5-003`/`P5-005` pass their sentinels.
- Final-spec compliance, publication, tagging, and deployment remain separately gated.
