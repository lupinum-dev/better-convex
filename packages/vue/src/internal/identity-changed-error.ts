import {
  ConvexCallError,
  isConvexCallError,
  type ConvexCallErrorCode,
  type ConvexCallOutcome,
} from '../errors'

/**
 * Stable `code` for the identity-boundary rejection.
 *
 * A call that crosses an identity generation rejects with this code. Its
 * `outcome` records whether the request was sent: `not-sent`, or `unknown`
 * when a write may already have committed under the original identity.
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
  context?: { readonly functionName?: string; readonly outcome?: ConvexCallOutcome },
): ConvexCallError {
  const message = operation
    ? `Convex ${operation} rejected: the auth identity changed before it settled (${IDENTITY_CHANGED}).`
    : `Convex operation rejected: the auth identity changed (${IDENTITY_CHANGED}).`
  return new ConvexCallError({
    kind: 'authentication',
    code: IDENTITY_CHANGED,
    message,
    functionName: context?.functionName,
    outcome: context?.outcome,
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
