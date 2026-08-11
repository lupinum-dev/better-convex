/** Stable, non-secret partition for anonymous or authenticated browser state. */
export type ConvexIdentityKey = 'anonymous' | `user:${string}`

/** True when the key names a concrete authenticated subject (`user:<id>`). */
export function isAuthenticatedIdentityKey(key: ConvexIdentityKey | null): key is `user:${string}` {
  return typeof key === 'string' && key.startsWith('user:')
}
