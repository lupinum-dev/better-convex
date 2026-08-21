import { decodeJwtPayload } from '../utils/convex-shared'
import type { AuthState, ConvexUser, EnhancedAuthState } from './types'

export function createDevtoolsAuthState(
  canonical: Pick<AuthState, 'isAuthenticated' | 'pending'>,
  token: string | null,
  user: ConvexUser | null,
  nowSeconds = Math.floor(Date.now() / 1_000),
): EnhancedAuthState {
  const payload = token ? decodeJwtPayload(token) : null
  const expiresAt = typeof payload?.exp === 'number' ? payload.exp : undefined
  const issuedAt = typeof payload?.iat === 'number' ? payload.iat : undefined
  return {
    ...canonical,
    user,
    tokenStatus: !token
      ? 'none'
      : expiresAt !== undefined && expiresAt <= nowSeconds
        ? 'expired'
        : 'valid',
    issuedAt: issuedAt === undefined ? undefined : issuedAt * 1_000,
    expiresAt: expiresAt === undefined ? undefined : expiresAt * 1_000,
    expiresInSeconds: expiresAt === undefined ? undefined : Math.max(0, expiresAt - nowSeconds),
  }
}
