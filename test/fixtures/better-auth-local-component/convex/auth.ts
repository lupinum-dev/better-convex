import { betterAuth } from 'better-auth'
import {
  convexAuth,
  createAuthComponent,
  getConvexAuthProvider,
  requireAuthOrigin,
  type AuthCtx,
} from 'better-convex-nuxt/convex-auth'

import { components } from './_generated/api'
import type { DataModel } from './_generated/dataModel'
import { createLocalAuthPlugins } from './betterAuth/schemaPlugins'

export const authComponent = createAuthComponent<DataModel>(components.betterAuth)

function assertAuthSecretsConfigured(): void {
  if (!process.env.BETTER_AUTH_SECRETS) {
    throw new Error('BETTER_AUTH_SECRETS is required')
  }
}

// Pre-traffic operator ceremony: provision/rotate the one official JWT key graph.
export const { rotateSigningKey } = authComponent.jwksOperatorFunctions(createAuth)

export async function createAuth(ctx: AuthCtx<DataModel>) {
  try {
    const siteUrl = requireAuthOrigin('SITE_URL')
    const convexSiteUrl = requireAuthOrigin('CONVEX_SITE_URL')
    const authIssuer = `${siteUrl}/api/auth`
    assertAuthSecretsConfigured()

    const auth = betterAuth({
      account: { encryptOAuthTokens: true, storeAccountCookie: false },
      advanced: {
        ipAddress: { ipAddressHeaders: ['x-bcn-verified-client-ip'] },
      },
      basePath: '/api/auth',
      baseURL: siteUrl,
      database: authComponent.adapter(ctx),
      disabledPaths: [
        '/token',
        '/get-access-token',
        '/refresh-token',
        '/.well-known/openid-configuration',
        '/oauth2/register',
        '/oauth2/introspect',
        '/oauth2/userinfo',
        '/oauth2/end-session',
      ],
      plugins: [
        ...createLocalAuthPlugins(authIssuer),
        convexAuth({
          authConfig: { providers: [getConvexAuthProvider()] },
          sessionJwt: {
            audience: 'convex',
            expirationTime: '15m',
            issuer: convexSiteUrl,
          },
        }),
      ],
      rateLimit: {
        enabled: true,
        modelName: 'rateLimit',
        storage: 'database',
      },
      trustedOrigins: [siteUrl],
      verification: { storeIdentifier: 'hashed' },
    })

    await auth.$context
    return auth
  } catch {
    throw new Error('AUTH_CONFIG_INVALID')
  }
}
