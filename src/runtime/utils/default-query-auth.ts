import type { ConvexAuthMode } from './auth-status'
import { getConvexRuntimeConfig } from './runtime-config'

/**
 * The auth mode for a query whose options omit `auth`: the build's
 * `convex.auth.defaultQueryAuth`, or `'optional'`. SSR and the hydrating
 * browser read the same normalized runtime config, so both key and gate the
 * query identically.
 */
export function resolveDefaultQueryAuth(): ConvexAuthMode {
  const auth = getConvexRuntimeConfig().auth
  return auth === false ? 'optional' : auth.defaultQueryAuth
}
