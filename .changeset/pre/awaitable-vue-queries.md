---
'@lupinum/better-convex-vue': minor
'@lupinum/better-convex-nuxt': minor
---

Add `await` support to `useConvexQuery` and `useConvexPaginatedQuery` in plain Vue

A page inside `<Suspense>` now waits for the first result or error of each awaited query.
Both packages return the same awaitable state, typed `ConvexQuery` and `ConvexPaginatedQuery`.
It is no longer a Promise, so `reactive(useConvexQuery(...))` also works in Nuxt.
Migration: rename `NuxtConvexQuery` to `ConvexQuery` and `NuxtConvexPaginatedQuery` to `ConvexPaginatedQuery`. Replace `.catch()` or `.finally()` on a query with `await` and read `error`. A Nuxt query stored inside `reactive()`, `ref()` or a Pinia store now unwraps its refs: read `data` there without `.value`.
