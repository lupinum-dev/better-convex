import { describe, expect, it } from 'vitest'

import { getConvexAuthProvider } from '../../src/runtime/convex-auth/provider'

describe('Convex auth provider', () => {
  it('uses the deployment-owned HTTP Actions origin for issuer and JWKS', () => {
    expect(
      getConvexAuthProvider({
        CONVEX_SITE_URL: 'https://example-deployment.convex.site',
        SITE_URL: 'http://localhost:3000',
      }),
    ).toEqual({
      algorithm: 'RS256',
      applicationID: 'convex',
      issuer: 'https://example-deployment.convex.site',
      jwks: 'https://example-deployment.convex.site/api/auth/jwks',
      type: 'customJwt',
    })
  })

  it('does not require the host origin while Convex evaluates auth.config', () => {
    expect(
      getConvexAuthProvider({ CONVEX_SITE_URL: 'https://example-deployment.convex.site' }),
    ).toMatchObject({
      issuer: 'https://example-deployment.convex.site',
      jwks: 'https://example-deployment.convex.site/api/auth/jwks',
    })
  })
})
