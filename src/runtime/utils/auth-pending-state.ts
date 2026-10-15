import type { Ref } from 'vue'

import { useState } from '#app'

/**
 * Single source for the `convex:pending` auth-readiness state.
 *
 * The client starts pending — auth is unknown until the client engine settles —
 * while the server starts settled, because `plugin.server` writes the resolved
 * auth state into the SSR payload before render. Every reader/writer of
 * `convex:pending` must go through this helper so the initial value can never
 * diverge by first-touch order.
 *
 * Internal only — not part of the public auto-import surface.
 */
export function useConvexAuthPendingState(): Ref<boolean> {
  return useState<boolean>('convex:pending', () => import.meta.client)
}
