# Browser runtime construction proof

Date: 2026-07-22

Task: `P4-003` (in progress)

## Outcome

One private constructor now owns the lifecycle wiring that the Vue package will move intact:

- primary and lazy anonymous client allocation;
- stable handle;
- provider-neutral auth port;
- initial loading/authenticated/anonymous settlement;
- server-confirmed authenticated publication;
- identity-driven replacement;
- token-free embedded attachment;
- connection observation; and
- exactly-once disposal.

The constructor exposes no raw client and no auth mutation controls. The provider adapter never receives
a client. The attachment retains only the four-method stable handle and token-free identity observer.

This is deliberately still private. It does not create a workspace package, public internal entry, or
temporary Nuxt-to-unpublished-source import. The next `P4-003` cut moves this constructor with the other
proved lifecycle sources and replaces Nuxt construction in the same working change.

## Proof

```text
pnpm exec vitest run --project=unit \
  test/unit/browser-runtime.test.ts \
  test/unit/auth-adapter-port.test.ts \
  test/unit/better-auth-browser-adapter.test.ts

pnpm exec vue-tsc --noEmit
pnpm run check:boundaries
```

Results: 3 files / 15 tests passed; module typecheck passed; all 12 architecture rules over 248 files
passed. The matrix includes anonymous construction, initial authenticated confirmation, loading to
authenticated replacement, stable attachment field allowlisting, token absence, and idempotent cleanup.
