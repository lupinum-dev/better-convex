# Vue MCP App lifecycle proof — 2026-07-22

## Outcome

`better-convex-vue/mcp-app` now exposes one optional `useMcpApp()` lifecycle
composable over the exact official `@modelcontextprotocol/ext-apps@1.7.4`
`App`. The ordinary Vue entry remains independent of the Apps SDK.

The composable owns only:

- construction with `allowUnsafeEval: false` and `strict: true` pinned;
- optional official `autoResize` behavior;
- listener registration before initialization;
- one connect attempt per Vue mount;
- readonly shallow projections of official host and tool notifications;
- structured cloning before values enter Vue state;
- listener retirement and exact-once close on scope disposal.

All host operations remain methods on the raw, non-reactive official `App`.
There is no plugin, global registry, host implementation, Convex client, token,
authentication adapter, server SDK, or second protocol API in this entry.

## Dependency and package boundary

The exact Apps SDK is an optional peer used only by `./mcp-app`. The production
manifest contract permits only this exact optional peer. The architecture gate
rejects the SDK from every other `packages/vue/src/**` file. The normal anonymous
consumer installed the exact packed Vue candidate without the optional peer and
its production dependency graph and Vite bundle contained no Apps SDK marker.

The emitted ordinary `dist/index.mjs` and `dist/index.d.mts` contain no
`@modelcontextprotocol/ext-apps` reference. Only the isolated `mcp-app` runtime
and declaration entries reference it.

## Executed lifecycle evidence

The neutral notes dashboard deleted its direct `App` construction, listener,
connect, and teardown lifecycle and now consumes `useMcpApp()`. The existing
official `AppBridge` production-browser proof exercised:

- initialization exactly once per mount and a clean second mount;
- host capabilities, host context, and a live theme change;
- partial input, complete input, repeated results, and cancellation;
- host-mediated allowed and denied server tool calls;
- missing and present `openLinks` capability plus host-denied navigation;
- graceful teardown followed by Vue scope disposal;
- wrong-window message rejection by the official transport;
- malicious structured result rendering without DOM/script execution;
- absence of cookies, bearer tokens, Convex JWTs, service proofs, provider
  references, raw causes, and raw Convex clients from HTML, messages, tool
  requests, DOM, logs, and errors.

A fresh mount is the reconnect model. The composable does not try to reconnect a
closed protocol instance or retain host state across iframe lifetimes.

## Commands and results

```text
pnpm --filter better-convex-vue typecheck
  passed

pnpm --filter better-convex-vue build
  passed

pnpm exec vitest run \
  test/unit/production-manifest-contract.test.ts \
  test/unit/package-entry-manifest.test.ts
  2 files, 67 tests passed

pnpm check:boundaries
  13 rules, 4 packages, 262 files passed

pnpm check:vue-package-exports
  packed-entry gate passed; 24 source files and 4 entries deep-checked

node scripts/check-vue-anonymous-consumer.mjs
  exact packed production install, typecheck, and Vite build passed
  Apps SDK absent from the production graph and bundle

pnpm exec vitest run test/unit/vnext-mcp-apps-probe.test.ts
  official App/AppBridge production-browser proof passed
```

The packed two-consumer Apps certification remains `P7-013`; this proof admits
the experimental lifecycle entry and closes its source/package/lifecycle gates.
