import type { Ref } from 'vue'

import { useState } from '#app'

import type { AuthErrorState } from './convex-shared'

/**
 * Single source for the `convex:authError` state: why Nuxt shows no identity,
 * as `{ code, message }`. The server writes it into the page payload and the
 * browser updates it, so every reader and writer goes through this helper.
 *
 * Internal only — not part of the public auto-import surface.
 */
export function useConvexAuthErrorState(): Ref<AuthErrorState | null> {
  return useState<AuthErrorState | null>('convex:authError', () => null)
}
