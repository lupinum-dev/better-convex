import type { ConvexRuntimeContext } from './runtime-context'

// The public `$convex` and `$auth` Nuxt-app property augmentations are deleted
// : consumers use the stable `useConvex()` handle and the auth
// composables, never a raw replaceable client or generic Nuxt injection. The
// augmentations below are INTERNAL inter-plugin seams (browser-only).
declare module '#app' {
  interface NuxtApp {
    /**
     * The per-Nuxt-app client owner (architecture invariant). Sole source of
     * truth for the replaceable primary and lazy anonymous clients; `useConvex()`
     * returns its stable handle and `useConvexConnectionState()` observes its
     * connection store. Provided by the core client plugin (browser only).
     */
    $convexRuntime?: ConvexRuntimeContext
  }
}

export {}
