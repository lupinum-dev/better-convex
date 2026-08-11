import type { AuthProvider } from 'convex/server'

import { requireAuthOrigin } from './origin'

export function getConvexAuthProvider(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AuthProvider {
  const issuer = requireAuthOrigin('CONVEX_SITE_URL', env)
  return {
    algorithm: 'RS256',
    applicationID: 'convex',
    issuer,
    jwks: `${issuer}/api/auth/jwks`,
    type: 'customJwt',
  }
}
