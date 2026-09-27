import type { ConvexUser } from '../types'

/**
 * Label for the signed-in user. The session token carries only the user ID
 * unless the app adds profile claims with `defineSessionClaims`, so fall back
 * to the ID rather than showing an anonymous-looking placeholder.
 */
export function userDisplayName(user: Partial<ConvexUser> | null | undefined): string {
  return user?.name || user?.email || user?.id || ''
}
