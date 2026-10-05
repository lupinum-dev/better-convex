import { getConvexIdentityKey, type ConvexIdentityKey } from '../utils/identity-key'
import type { ConvexUser } from '../utils/types'

/**
 * Identity as ONE discriminated value (architecture invariant). Never independent booleans
 * for user/authenticated/loading, and never a manufactured empty-string
 * user field. `key` is always the stable Better Auth `user.id`. It holds no
 * token: this value is SSR state and reaches the page payload.
 */
export type AuthIdentity =
  | { status: 'pending' }
  | { status: 'anonymous' }
  | {
      status: 'authenticated'
      user: ConvexUser
      key: `user:${string}`
    }

export const PENDING_IDENTITY: AuthIdentity = { status: 'pending' }
export const ANONYMOUS_IDENTITY: AuthIdentity = { status: 'anonymous' }

/**
 * Build an authenticated identity from a user whose token was confirmed, or
 * fall back to anonymous when the user has no stable id. Pure.
 */
export function toAuthenticatedIdentity(user: ConvexUser): AuthIdentity {
  try {
    const key = getConvexIdentityKey(user)
    if (key === 'anonymous') return ANONYMOUS_IDENTITY
    return { status: 'authenticated', user, key }
  } catch {
    return ANONYMOUS_IDENTITY
  }
}

/** The stable identity key for any identity value. Settled values only. */
export function identityKeyOf(identity: AuthIdentity): ConvexIdentityKey {
  return identity.status === 'authenticated' ? identity.key : 'anonymous'
}

/** The published user, or null for any non-authenticated identity. */
export function identityUser(identity: AuthIdentity): ConvexUser | null {
  return identity.status === 'authenticated' ? identity.user : null
}
