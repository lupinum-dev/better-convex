import { ConvexCallError } from '../errors'

/**
 * Stable `code` for the identity-boundary rejection.
 *
 * A handle invocation that crosses an identity generation, and every A-owned
 * consumer-held call retired during A→B replacement, rejects with this code. It
 * is deliberately NOT safe-retry evidence: a stale mutation/action may already
 * have committed under the original identity.
 */
export const IDENTITY_CHANGED = 'IDENTITY_CHANGED' as const

/**
 * The identity-boundary rejection as the framework-neutral
 * {@link ConvexCallError} (`kind: 'authentication'`, `code: 'IDENTITY_CHANGED'`).
 * The old result is never placed in `data` or `cause`: a stale
 * settlement must never be presented as a safely retryable value.
 */
export function createIdentityChangedError(operation?: string): ConvexCallError {
  const message = operation
    ? `Convex ${operation} rejected: the auth identity changed before it settled (${IDENTITY_CHANGED}).`
    : `Convex operation rejected: the auth identity changed (${IDENTITY_CHANGED}).`
  return new ConvexCallError({
    kind: 'authentication',
    code: IDENTITY_CHANGED,
    message,
  })
}

/** True when an error is the identity-boundary rejection above. */
export function isIdentityChangedError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === IDENTITY_CHANGED
  )
}
