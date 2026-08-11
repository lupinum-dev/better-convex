# Exact Vue MCP App consumer checkpoint — 2026-07-23

## Outcome

The neutral production MCP App consumer now passes against the immutable local
Vue `0.8.0-beta.15` and MCP `0.1.0-beta.5` tarballs. The consumer:

- installs both exact tarballs in a temporary application;
- proves the lockfile references both tarballs;
- compares installed package bytes with candidate manifests;
- production-bundles the App from `better-convex-vue/mcp-app`;
- rejects any fallback to `packages/vue/src`;
- negotiates the locked RC through the installed `@better-convex/mcp`;
- proves useful structured/text fallback;
- runs the capable-host browser boundary matrix; and
- scans the App, fallback, and bridge boundary for the bearer sentinel.

## Proof correction

The first run failed closed with HTTP 500 because the consumer proof still
constructed its own SDK `McpServer` through the removed `createServer()` option.
That API was intentionally hard-cut during stabilization. The immutable MCP
candidate already exposes the corrected package-owned lifecycle:

```text
handleMcpRequest(request, { configureServer(..., server) })
```

The proof was corrected to register its tool on the package-owned server. No
candidate bytes changed and no compatibility path was added.

## Executed command

```text
node scripts/check-vue-mcp-app-consumer.mjs \
  --vue-tarball .release-artifacts/vue/0.8.0-beta.15/better-convex-vue-0.8.0-beta.15.tgz \
  --mcp-tarball .release-artifacts/mcp/0.1.0-beta.5/better-convex-mcp-0.1.0-beta.5.tgz
```

Result:

```text
Packed MCP App consumer passed Vue 0.8.0-beta.15 with MCP 0.1.0-beta.5.
```

Focused formatting and ESLint checks for the corrected runner also pass.

## Ginko installed-package proof

Ginko commit `f32e28b7` removes the last adjacent-source alias from its
publish-impact App fixture. The fixture now:

- resolves `better-convex-vue/mcp-app` from the installed package;
- resolves the exact `@modelcontextprotocol/ext-apps@1.7.4` peer explicitly;
- rejects any module path under `packages/vue/src`;
- no longer passes the removed `autoResize` option; and
- production-bundles the App through the same narrow lifecycle used by the
  neutral fixture.

The focused Ginko proof passed 27 tests across the candidate contract, package
boundaries, and production Chromium App lifecycle. Its frozen lockfile also
passed a lock-only install check. The committed package resolution remains
registry-clean; temporary local tarball overrides were used only to materialize
the unpublished immutable candidates and were removed before commit.

## Scope conclusion

`P7-013` is complete for local exact-package certification: two materially
different consumers build and exercise the installed Vue/MCP candidate bytes
without workspace or source fallback. Different-origin and compatible real-host
evidence remains `P9-006` and a protected experimental-to-stable gate; it is not
fabricated by either local harness.
