import type { ConvexUser } from './types'

export type ConvexIdentityKey = 'anonymous' | `user:${string}`

export function isAuthenticatedIdentityKey(key: ConvexIdentityKey | null): key is `user:${string}` {
  return typeof key === 'string' && key.startsWith('user:')
}

/**
 * The single stable-user-ID extraction function.
 *
 * `'anonymous'` covers every unauthenticated identity; `user:${string}` uses the
 * Better Auth `user.id` at this Nuxt adapter boundary. It is never a JWT, token
 * hash, role, or permission.
 *
 * Use this everywhere an identity-varying holder is keyed: SSR snapshots, client
 * auth, cache keys, payload keys, subscription keys, and identity generation.
 * There is deliberately exactly one implementation .
 *
 * @throws TypeError when a user is present but has no non-empty string `id`.
 *   A token without a resolved user id is not a settled identity and must keep
 *   auth-gated queries waiting; it must never produce `user:undefined`.
 */
export function getConvexIdentityKey(user: ConvexUser | null): ConvexIdentityKey {
  if (!user) return 'anonymous'
  if (typeof user.id !== 'string' || user.id.length === 0) {
    throw new TypeError('Authenticated Convex user is missing a stable Better Auth user id')
  }
  return `user:${user.id}`
}
