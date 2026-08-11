# Nuxt query adapter proof — 2026-07-22

## Outcome

After the P3-006 hard cut, `useConvexQuery.ts` is the Nuxt adapter around the
private query controller. It retains the responsibilities that cannot be
framework-neutral:

- Nuxt runtime configuration and per-request runtime context;
- `useRequestEvent()` cookie capture for SSR;
- SSR one-shot HTTP execution and token selection;
- identity-partitioned `useAsyncData` and payload-backed error state;
- Nuxt auth-status gating and initial-settlement await behavior;
- public Nuxt pending/status/refresh/clear result shape;
- Nuxt logger and DevTools projection;
- Vue scope watches that forward identity/execution boundaries to the controller.

It no longer owns a listener, operation revision, deferred first value,
identity-tagged previous snapshot, stale calculation, or disposal state. Those
have one source in `client-core/query-controller.ts`.

No additional adapter class or wrapper was added. The direct composable-to-
controller port is smaller and avoids relocating Nuxt-specific logic without
changing its ownership.

## Executed evidence

The full repository gate from P3-006 passed 160 test files / 1,813 tests.

The production Nuxt extended auth/session matrix was then run against a rebuilt
module and prepared playground:

```text
pnpm exec nuxt-module-build prepare
pnpm exec nuxt-module-build build
pnpm exec nuxi prepare --cwd playground --dotenv .env.local
CONVEX_E2E_AUTO_START=true BCN_E2E_REQUIRE_LOCAL=true \
  pnpm exec vitest run --project=e2e \
  test/e2e/extended/auth-session-matrix.e2e.test.ts
```

Result: 1 production E2E file / 4 tests passed. The matrix proved:

- authenticated bootstrap and live Convex identity agreement;
- revocation/sign-out and later account replacement;
- sequential Alice, Bob, and anonymous SSR payload isolation;
- concurrent Alice, Bob, and anonymous SSR payload isolation;
- no session-cookie value in rendered payloads;
- authenticated responses remain `private, no-store` and vary on cookies;
- no shared-cache override headers weaken the response boundary.

The focused Nuxt query suites additionally cover `auth: none`, optional,
required, auth-disabled, initial loading/hydration state, reactive arguments,
skip, previous data, first live value, errors, and scope disposal.

## Decision

P3-007 required no new public API and no second Nuxt adapter abstraction. The
existing composable is the adapter. Further generic client behavior belongs in
the private source island; further Nuxt behavior remains explicit here.
