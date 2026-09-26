import type { ConvexRuntimeContext } from './runtime-context'

// Consumers use the stable `useConvex()` handle and the auth composables,
// never a raw replaceable client or generic Nuxt injection. The augmentation
// below is an internal, browser-only seam between plugins.
declare module '#app' {
  interface NuxtApp {
    /**
     * The per-Nuxt-app client owner. Sole source of truth for the replaceable
     * primary and lazy anonymous clients; `useConvex()` returns its stable
     * handle and `useConvexConnectionState()` observes its connection store.
     * Provided by the core client plugin (browser only).
     */
    $convexRuntime?: ConvexRuntimeContext
  }
}

export {}
