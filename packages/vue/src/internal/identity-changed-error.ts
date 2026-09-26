import { ConvexCallError, isConvexCallError, type ConvexCallErrorCode } from '../errors'

/**
 * Stable `code` for the identity-boundary rejection.
 *
 * A handle invocation that crosses an identity generation, and every A-owned
 * consumer-held call retired during A→B replacement, rejects with this code. It
 * is deliberately NOT safe-retry evidence: a stale mutation/action may already
 * have committed under the original identity.
 */
export const IDENTITY_CHANGED = 'IDENTITY_CHANGED' satisfies ConvexCallErrorCode

/**
 * The identity-boundary rejection as the framework-neutral
 * {@link ConvexCallError} (`kind: 'authentication'`, `code: 'IDENTITY_CHANGED'`).
 * The old result is never placed in `data`: a stale settlement must never be
 * presented as a safely retryable value.
 */
export function createIdentityChangedError(
  operation?: string,
  context?: { readonly functionName?: string },
): ConvexCallError {
  const message = operation
    ? `Convex ${operation} rejected: the auth identity changed before it settled (${IDENTITY_CHANGED}).`
    : `Convex operation rejected: the auth identity changed (${IDENTITY_CHANGED}).`
  return new ConvexCallError({
    kind: 'authentication',
    code: IDENTITY_CHANGED,
    message,
    functionName: context?.functionName,
  })
}

/**
 * True only for the library's identity-boundary rejection above. An
 * application `ConvexError` whose `data.code` happens to be `IDENTITY_CHANGED`
 * normalizes to `kind: 'server'` and is not a retirement.
 */
export function isIdentityChangedError(error: unknown): error is ConvexCallError {
  return isConvexCallError(error, IDENTITY_CHANGED) && error.kind === 'authentication'
}
