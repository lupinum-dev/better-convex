# Client disposal ownership — 2026-07-22

## Outcome

Each framework-neutral controller remains the single owner of its resources and exposes one idempotent
`dispose()` operation. No generic disposal registry or second cleanup state machine was added.

The only duplicated ownership was in mutation and action adapters: each adapter subscribed directly to
identity changes and separately stopped that listener beside controller disposal. The callable
controller now accepts the token-free identity subscription function, owns it, and releases it exactly
once. Each Vue adapter retains only `onScopeDispose(controller.dispose)`.

Query subscriptions, pagination subscriptions and internal watch, stable client-owner resources, and
attached-runtime observers were already controller-owned and idempotent. They were retained rather than
wrapped in another abstraction.

## Invariants proved

- Repeated disposal closes each listener at most once.
- Scope unmount makes both mutation and action controllers inert.
- Identity notifications after component unmount cannot retain or repopulate callable state.
- Query first-value waiters settle and retired callbacks cannot commit.
- Pagination subscriptions and queued refresh results cannot repopulate state after retirement.
- Client-owner disposal rejects in-flight work and leaves returned unsubscribe handles inert.

## Verification

```text
pnpm exec vitest run --project=unit \
  test/unit/callable-lifecycle.test.ts \
  test/unit/query-controller.test.ts \
  test/unit/pagination-controller.test.ts \
  test/unit/client-owner.test.ts
# 4 files, 51 tests passed

pnpm exec vitest run --project=nuxt \
  test/nuxt/useConvexMutation.nuxt.test.ts \
  test/nuxt/useConvexAction.nuxt.test.ts
# 2 files, 17 tests passed
```

No token, provider, server, Nuxt, or MCP dependency entered the callable controller.
