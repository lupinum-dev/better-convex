# Vue MCP App boundary stabilization evidence — 2026-07-23

## Scope

This closes stabilization task `S4-004` against exact
`@modelcontextprotocol/ext-apps@1.7.4`.

## Enforced boundary

- `useMcpApp()` no longer returns the mutable SDK `App`.
- The only exposed host operations are the two required by the neutral and
  Ginko proving consumers: `callServerTool()` and `openLink()`.
- Operation inputs and results are structured-cloned. Calls reject before the
  initialized phase, and a result cannot be returned after scope retirement.
- The public `autoResize` option is deleted and the exact SDK is always
  constructed with `autoResize: false`. The SDK currently discards the
  observer cleanup returned by `setupSizeChangedNotifications()`.
- Mount owns one connection; scope disposal removes all BCN listeners, clears
  projections, retires late events and closes once. A remount constructs a
  fresh lifecycle.

## Executed proof

```text
pnpm --dir packages/vue typecheck
pnpm --dir packages/vue build
pnpm exec vitest run --project=unit test/unit/package-entry-manifest.test.ts
pnpm exec vitest run --project=unit test/unit/vnext-mcp-apps-probe.test.ts
pnpm exec eslint packages/vue/src/mcp-app.ts \
  internal/labs/mcp-topology/apps/notes-dashboard/NotesDashboard.vue \
  test/unit/vnext-mcp-apps-probe.test.ts
```

Results:

- Vue typecheck and production package build passed.
- The package-entry contract passed.
- The production-browser App proof passed with a fresh second mount,
  exact-one graceful teardown per mount, wrong-source rejection, hostile and
  cross-tenant results, capability-gated navigation, CSP/sandbox restrictions,
  and credential sentinels checked across bundles, DOM, bridge bytes, request
  bodies, console messages and page errors.
- Focused lint passed.

The browser proof requires local Chromium permissions. One sandboxed launch
failed at macOS Mach-port registration; the same command passed with the
approved browser execution permission.

## Remaining upstream limit

The exact SDK logs parsed and sent bridge messages to the browser console and
offers no logger control. Better Convex does not attempt a global console shim
or a private protocol transport. Credential absence from every bridge payload
and captured console surface is enforced, but ordinary protocol values can
still be logged by the SDK.

Therefore `better-convex-vue/mcp-app` remains experimental. Stable admission
still requires upstream logger suppression/control plus different-origin and
real-host evidence. This limitation does not block stabilization re-entry
because the surface is neither stable nor enabled by the base Vue entry.
