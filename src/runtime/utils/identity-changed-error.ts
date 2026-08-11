import { ConvexCallError } from '../errors'

export const IDENTITY_CHANGED = 'IDENTITY_CHANGED' as const

export function createIdentityChangedError(operation?: string): ConvexCallError {
  return new ConvexCallError({
    kind: 'authentication',
    code: IDENTITY_CHANGED,
    message: operation
      ? `Convex ${operation} rejected: the auth identity changed before it settled (${IDENTITY_CHANGED}).`
      : `Convex operation rejected: the auth identity changed (${IDENTITY_CHANGED}).`,
  })
}

export function isIdentityChangedError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === IDENTITY_CHANGED
  )
}
