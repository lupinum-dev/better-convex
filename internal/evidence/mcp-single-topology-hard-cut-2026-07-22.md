# MCP single-topology hard cut — 2026-07-22

## Outcome

The active repository now contains one MCP protocol implementation: the official
`@modelcontextprotocol/server@2.0.0-beta.5` stack in `@better-convex/mcp`, mounted
directly as a deployment-owned Convex HTTP Action.

Deleted active paths:

- the Nuxt `/mcp` relay, protected-resource projection, and public `auth.mcp` option;
- the delegated OAuth starter's hand-written protocol and token-security parser;
- the private `starters/mcp-agent` bearer/secret bridge and approval workflow;
- the losing Nitro topology lab and its exact-call proof (completed in `beeb392c`);
- source tests and parity runners whose only purpose was comparing the two topologies.

The former implementations remain recoverable from Git history. The complete
Nitro candidate is additionally frozen at branch `codex/archive-mcp-nitro-beta5`,
commit `988b40f1`; it is not a supported runtime or compatibility path.

## Replacement proof

- `starters/mcp-oauth-agent/convex/mcp.ts` uses the official SDK and
  request-scoped `handleMcpRequest` for five explicit tools.
- Better Auth OAuth remains the authorization server at the Nuxt application
  origin; the protected resource and its metadata live at `CONVEX_SITE_URL`.
- The bearer terminates in the verifier. Only an allowlisted access context and
  the starter's request-local provider reference reach application composition.
- Every effect still runs through the existing tool-specific internal mutation
  and rechecks canonical session, client, consent, membership, delegation,
  resource, scope, and approval state.
- The provider-neutral service-credential case is proven by the exact packed
  Ginko consumer at commit `4dc7727b`, not by a second shipped starter.

## Executed evidence

```text
pnpm exec vitest run --project=mcp --reporter=dot
  7 files, 55 tests passed

pnpm exec vitest run --project=unit \
  test/unit/auth-config.test.ts \
  test/unit/runtime-config.test.ts \
  test/unit/maintained-candidate-apps.test.ts \
  test/unit/shipped-auth-factories.test.ts \
  test/unit/starter-organization-ownership.test.ts \
  test/unit/convex-cli-authority.test.ts --reporter=dot
  6 files, 115 tests passed

pnpm typecheck:module
pnpm typecheck:server
pnpm exec tsc --noEmit -p starters/mcp-oauth-agent/convex/tsconfig.json
pnpm check:boundaries
  13 rules, 4 packages, 261 files passed
pnpm check:no-starter-generated-artifacts
git diff --check

pnpm check
  formatting, lint, all module/server/fixture typechecks, boundary scan,
  161 files and 1,817 tests passed
```

Search sentinels found no active reference to `starters/mcp-agent`, the deleted
Nuxt MCP runtime, `auth.mcp`, or the deleted starter parser/security modules in
runtime, tests, scripts, maintained starters, or product documentation.

The maintained consumer lockfiles remain intentionally owned by the immutable
candidate-set workflow. The unpublished MCP companion must be injected as an
exact tarball by `P5-023`; no permanent workspace-link exception was added.
