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
  type, and the raw-event rows of `test/unit/server-event.test.ts` (they use
  h3 1.x `createEvent` and Nuxt 4.6's `toPortableEvent`).
- **Remove when:** the `nuxt` peer range no longer includes Nuxt 4.
- **Tracking issue:** none yet.
