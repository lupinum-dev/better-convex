# MCP topology runtime and bundle purity — 2026-07-20

## Scope

This closes private-lab task `P1-007`. It asks only whether each independently implemented candidate can
build and execute with the exact official SDK without a patch, unsupported polyfill, or accidental client
bundle. It does not choose the topology.

## Nitro candidate

The disposable Nuxt fixture at `internal/labs/mcp-topology/nitro/fixture` was built with the production
`node-server` Nitro preset into a temporary output directory, started with Node `24.18.0`, and exercised
by the exact official MCP client over a real loopback socket.

The emitted server manifest contains:

```json
{
  "@modelcontextprotocol/core": "2.0.0-beta.4",
  "@modelcontextprotocol/server": "2.0.0-beta.4",
  "zod": "4.3.6"
}
```

It contains no `@modelcontextprotocol/client` dependency or installed client-package path. Browser/public
assets contain no MCP server/client package marker or server implementation marker. The application
runtime contains the explicit server implementation but no client import, old `parseMcpRequest` symbol,
or Convex candidate token. The official production client completed initialize, `tools/list`, and
`search_notes`; its bearer sentinel was absent from all captured responses.

Bounded artifact summary from the passing verbose run:

```text
files=208
applicationTextFiles=15
serverTextFiles=185
serverTextBytes=3142825
publicMcpBytes=0
```

The 3.14 MB figure is the aggregate size of textual server output, including Nitro, Vue SSR, the SDK,
Zod, and package metadata; it is not an MCP-only bundle-size claim. It is retained as an operational
comparison input rather than normalized away.

Reproduction:

```sh
pnpm exec vitest run --config internal/labs/mcp-topology/nitro/vitest.config.ts --reporter=verbose
```

Result: one production build/runtime/artifact test passed in two independent permitted runs. The first
scan correctly failed because its assertion searched dependency documentation as executable code; the
replacement invariant checks the emitted dependency manifest, installed paths, public assets, and
application runtime separately.

## Convex candidate

The Convex fixture manifest has only the exact SDK server, Convex, and Zod dependencies. Its Convex
source imports no `node:` module, MCP client, patch, or polyfill. The reviewed Convex CLI bundled and
deployed those bytes to `precompiled-2026-07-06-44f7aa7`, and the official client completed the full
tool/resource proof over the deployed HTTP action.

That executed deployment is the bundle/runtime gate: an unresolved Node-only import or unsupported SDK
shim would have failed Convex analysis/deployment or action execution. Generated code and deployment
state exist only in the disposable copy. The repository declares no `patchedDependencies` or
`patch-package` path.

Reproduction:

```sh
node scripts/check-auth-backend.mjs
pnpm exec vitest run --config internal/labs/mcp-topology/convex/vitest.config.ts --reporter=verbose
```

Result: the reviewed backend hash passed; one exact dependency/source/deployment/runtime test passed.

## Unsupported dependency report

| Candidate          | Unsupported runtime import/polyfill found | SDK client shipped in server/browser artifact | Patch required | Status |
| ------------------ | ----------------------------------------- | --------------------------------------------- | -------------- | ------ |
| Nitro Node server  | None                                      | No client package; no browser MCP bytes       | No             | viable |
| Convex HTTP action | None                                      | Client is test-process only                   | No             | viable |

Both remain private probes. SDK v2 is prerelease, so runtime viability does not admit a public package or
final wire claim. Subsequent tasks must compare identical conformance, adversarial HTTP/OAuth behavior,
exact-call cost, deployment operations, and latency before the loser is deleted.
