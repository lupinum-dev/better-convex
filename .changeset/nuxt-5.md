---
'@lupinum/better-convex-nuxt': minor
'@lupinum/better-convex-vue': minor
---

Add Nuxt 5 support: the module runs on Nuxt `^4.6.0 || ^5.0.0-0` with one server code path, tested on Nuxt 4.6.1 and the Nuxt 5 nightly (pre-release)

Server code uses `nuxt/server` and web `Request`/`Response`. Remove the `h3` dependency: the server helpers take `event: ConvexServerEvent`, which accepts every Nuxt 4.6 and Nuxt 5 server event.
`toConvexH3Error` returns, and `getConvexUser` and `requireConvexUser` throw, an HTTP error (`NuxtError`); check it with `isNuxtError` from `nuxt/server` and read `error.status`.
Server helpers (`serverConvex`, `getConvexUser`, `requireConvexUser`) read the server's runtime config, not a per-request copy; on Nuxt 4 with per-request env (Cloudflare module workers) set the Convex config at build or boot time.
On Nuxt 5, a `routeRules` cache or `headers` rule, or server middleware that sets cache headers, overrides the private cache headers on signed-in pages; the module warns at build about such route rules. Install `@nuxt/devtools` on Nuxt 5 to see the Convex tab.
Migration: update Nuxt to 4.6 or newer and Node to `^22.22.3 || ^24.15.0 || >=26`, import `defineEventHandler`/`createError`/`readBody`/`useRuntimeConfig` from `nuxt/server`, read `error.status` (not `statusCode`) on `toConvexH3Error` results, and type helper events as `ConvexServerEvent` or let them infer.
