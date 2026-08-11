# Ginko single MCP endpoint stabilization — 2026-07-23

## Scope

- Ginko branch: `codex/better-convex-vnext-stabilization`
- Completion commit: `a062f25aa215b1291222eb9753fe9cdfaee69b8d`
- Stabilization task: `S5-004`

## Outcome

Ginko now has one optional MCP product boundary:

- `ginkoCms.mcp: false` plus the default `ginko-cms init` materializes no MCP
  route;
- `ginkoCms.mcp: true` plus `ginko-cms init --mcp` materializes only the
  Convex-native `/mcp` HTTP action;
- the endpoint advertises exactly `start-agent-run`, `get-entry`,
  `save-entry-draft`, `preview-publish`, and `complete-agent-run`;
- credential creation/list/revocation remains available while routing is
  disabled so existing credentials can still be revoked.

The hard cut deleted the Nitro MCP server, middleware, discovery tree,
`/mcp/code`, `/mcp-pilot`, signed assertion bridge, MCP doctor, toolkit/code
mode dependencies, public limiter protocol, and split check/record limiter
façades. It also removed the obsolete public credential-hash resolution query:
all bearer admission now passes through the one atomic
`admitAccessBySecretHash` mutation.

Tool callbacks receive only the admitted credential subject and allowlisted
application arguments. They do not receive bearer values, secret hashes,
Better Auth sessions, bridge proofs, or client-supplied roles. Canonical
component guards still re-read current credential, member, role, scope, tenant,
contract, agent-run, and optimistic-version state for effects.

## Executed proof

```text
./node_modules/.bin/vitest run \
  test/component/mcpCredentials.test.ts \
  test/component/contract-write-invariants.test.ts \
  test/runtime/mcp.test.ts \
  test/runtime/mcp-publish-impact-app.test.ts \
  test/module/ginko-cli.test.ts \
  test/module/module-bridge.test.ts \
  test/module/package-exports.test.ts \
  test/module/package-boundaries.test.ts \
  test/refactor/no-zombie-paths.test.ts

./node_modules/.bin/tsc \
  -p packages/convex/tsconfig.json --noEmit

npm --prefix packages/convex run build

./node_modules/.bin/nuxt-module-build build packages/cms
node packages/cms/scripts/build-extras.mjs
./node_modules/.bin/vite build \
  --config packages/cms/studio-app/vite.config.ts
```

Results:

- 9 files and 87 focused tests passed.
- The Convex component typecheck and clean local component build passed.
- The production Nuxt module and production Studio Vite builds passed.
- Enabled setup registered no Nuxt MCP handler; disabled setup generated no
  `/mcp`, `/mcp-pilot`, or `/mcp/code` route.
- The exact five-tool inventory, ordinary draft write, optimistic conflict,
  member revocation, tenant denial, credential revocation, atomic invalid
  admission, package exports, and legacy-path absence passed.
- The commit deleted 5,707 lines while adding 823, including tests and current
  documentation.

The root package-manager lifecycle attempted to install unpublished
`better-convex-nuxt@0.8.0-beta.4` and correctly failed with a registry 404.
Local source links therefore remain development evidence only. Exact isolated
Vue/Nuxt/MCP tarball installation, canonical host codegen, live HTTP
concurrency, and production consumer repetition remain assigned to `S6-003`
and `S6-004`; this task does not certify a release artifact.
