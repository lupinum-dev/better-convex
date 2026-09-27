import { useConvex as useVueConvex, type ConvexClientHandle } from '@lupinum/better-convex-vue'

import { useNuxtApp } from '#app'

import { readConvexRuntimeContext } from '../runtime-context'
import { UNAVAILABLE_CONVEX_HANDLE } from '../utils/client-unavailable'

export type { ConvexClientHandle } from '@lupinum/better-convex-vue'

/**
 * Access the stable, replacement-safe Convex client handle.
 *
 * The handle behaves like the raw Convex client: in the browser, its calls
 * reject with the error Convex raised, not a `ConvexCallError` (only an
 * identity change rejects with code `IDENTITY_CHANGED`). Pass a caught error
 * through `normalizeConvexError(error, { functionName })` before reading
 * `kind` or `code`.
 *
 * Calling it is safe everywhere. During server rendering, or when no Convex
 * URL is configured, it returns a handle whose `query`, `mutation`, and
 * `action` reject and whose `onUpdate` throws a `ConvexCallError` with code
 * `CLIENT_UNAVAILABLE`. Use `useConvexQuery` for server-rendered data and
 * `serverConvex(event)` in Nitro handlers.
 */
export function useConvex(): ConvexClientHandle {
  if (import.meta.server || !readConvexRuntimeContext(useNuxtApp())) {
    return UNAVAILABLE_CONVEX_HANDLE
  }
  return useVueConvex()
}
