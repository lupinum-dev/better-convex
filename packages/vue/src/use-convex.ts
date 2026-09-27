import type { ConvexClientHandle } from './internal/client-owner'
import { useBetterConvexRuntime } from './runtime-context'

/**
 * The app's stable Convex client handle; it survives identity-driven client
 * replacement.
 *
 * The handle behaves like the raw Convex client: its calls reject with the
 * error Convex raised, not a `ConvexCallError` (only an identity change
 * rejects with code `IDENTITY_CHANGED`, whose `outcome` tells whether the call
 * was sent). For multi-step work bound to one identity, use
 * `useConvexOperation`. Pass a caught error through
 * `normalizeConvexError(error, { functionName })` before reading `kind` or
 * `code`.
 */
export function useConvex(): ConvexClientHandle {
  return useBetterConvexRuntime().browser.handle
}
