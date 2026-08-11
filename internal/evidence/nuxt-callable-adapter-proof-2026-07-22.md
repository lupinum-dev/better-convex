# Nuxt callable adapter proof — 2026-07-22

## Outcome

`useConvexMutation` and `useConvexAction` now adapt the same private callable
controller. Both retain only operation-specific concerns:

- the exact Convex function reference and transport method;
- auth-settlement callback;
- mutation-only optimistic update;
- public generic options and callable return shape;
- operation-specific logger projection;
- scope ownership of identity observation and controller disposal.

The previously duplicated DevTools start/success/error mapping is now one
private Nuxt-side adapter in `utils/callable-devtools.ts`. This keeps the
framework-neutral controller free of DevTools imports while ensuring mutation
and action diagnostics use the same sink instance from start through settle.

There is one call state and one run/safe/reset/dispose algorithm. No second
operation lifecycle, compatibility export, cache, or registry remains.

## Preserved behavior

- mutations use `owner.handle.mutation` and actions use `owner.handle.action`;
- auth settles exactly once before each dispatch;
- argless operations send `{}`;
- mutation optimistic callbacks reach only the mutation transport;
- public pending/status/data/error/reset and `.safe()` shapes are unchanged;
- structured `ConvexError` data remains preserved;
- expected domain-result values are not flattened into transport errors;
- superseded calls cannot fire success or error callbacks;
- callback throws are contained;
- DevTools arguments/results pass through the existing redaction sink;
- optimistic mutations start as `optimistic`; actions start as `pending`.

## Executed proof

The focused adapter matrix passed 5 files / 34 tests:

```text
test/unit/call-state.test.ts
test/unit/callable-lifecycle.test.ts
test/unit/callable-devtools.test.ts
test/nuxt/useConvexMutation.nuxt.test.ts
test/nuxt/useConvexAction.nuxt.test.ts
```

The new tests prove the optimistic update is passed in the mutation transport
options, mutation/action DevTools state mapping, sink absence, and diagnostic
redaction. The complete repository gate passed formatting, lint, all
typechecks, 12 architecture rules across 244 source files, and 161 test files /
1,822 tests.

## Public API admission

No public API was added or changed. The DevTools adapter and callable controller
remain private implementation seams.
