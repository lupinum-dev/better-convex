# Temporary compatibility code

Each entry is code that exists only for a version we still support. Remove the
code and its entry together when the removal condition is met.

## Raw h3 v1 events (Nuxt 4)

- **Code:** the raw h3 v1 branch of each accessor in
  `src/runtime/server/utils/event.ts` (`H3V1Event`, `rawH3V1`, the Node
  response-header wrapper, the h3 1.x URL rebuild), and the `~portable` check
  in `eventAbortSignal` (a Nuxt 4.6 `nuxt/server` event has a `Request` whose
  signal never aborts). The Nuxt 4 in-process request body source in
  `src/runtime/server/api/auth/body-size.ts` (`inProcessRequestBodyStream`
  and its helpers `inProcessBodyBytes`, `isNodeReadable`, `readNodeReadable`):
  it reads a body that Nitro 2's unenv mock request or h3 1.x already holds.
- **Why:** on Nuxt 4, server routes that use h3's auto-imported
  `defineEventHandler`, and the server-rendering event (`useRequestEvent()`),
  are raw h3 v1 events: `event.req` is the Node `IncomingMessage`, and response
  headers live on `event.node.res`. Nuxt 5 and `nuxt/server` handlers pass a
  web-shaped event instead.
- **Introduced:** 2026-10-14.
- **Dependents:** every caller of the event accessors (auth proxy, server
  helpers, SSR plugin, `query-foundation.ts`), the public `ConvexServerEvent`
  type, and these tests and notes:
  - the raw-event rows of `test/unit/server-event.test.ts` (they use h3 1.x
    `createEvent` and Nuxt 4.6's `toPortableEvent`), `rawProxyEvent` in
    `test/helpers/auth-proxy-event.ts` and its callers, and the other unit and
    security tests that build raw v1 events with h3 1.x `createEvent`; they
    are why `h3` stays a devDependency;
  - the Nuxt 4.6 `cause` allowance in `test/unit/server-h3-error.test.ts`
    (h3 v1 `createError` stores the sanitized input as `cause`) and the
    `statusMessage` fallback in `test/e2e/server-utils-smoke.e2e.test.ts`;
  - the Nuxt 4 note above `readBoundedJsonBody` in
    `playground/server/api/test-server-mutation.post.ts` (on Nuxt 4 the
    portable `event.req.body` buffers the whole request, so only the
    content-length precheck bounds memory there).
- **Remove when:** the `nuxt` peer range no longer includes Nuxt 4.
- **Tracking issue:** none yet.

## Convex transpile entry (Nuxt 4.6 regression)

- **Code:** `nuxt.options.build.transpile.push('convex')` in `src/module.ts`.
- **Why:** Nuxt 4.6.0 and 4.6.1 with nitropack 2.13.4 inline `convex/browser`
  into the server build with a broken import path, so SSR pages that load
  Convex answer 500. The regression came with nuxt/nuxt#36309.
- **Introduced:** 2026-10-14.
- **Dependents:** none; in dev the browser loads `convex` unbundled while the
  entry exists.
- **Remove when:** the lowest supported Nuxt bundles `convex` correctly
  without the entry.
- **Tracking issue:** none yet; no upstream issue is filed.
