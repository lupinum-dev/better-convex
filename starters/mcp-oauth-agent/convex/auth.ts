import { oauthProvider, type OAuthOptions, type Scope } from '@better-auth/oauth-provider'
import { betterAuth } from 'better-auth'
import { jwt } from 'better-auth/plugins'
import {
  convexAuth,
  createAuthComponent,
  getConvexAuthProvider,
  requireAuthOrigin,
  type AuthCtx,
  type AuthFunctions,
} from 'better-convex-nuxt/convex-auth'

import { components, internal } from './_generated/api'
import type { DataModel } from './_generated/dataModel'
import { MCP_SCOPES } from './mcp/scopes'
import { mcpOAuthAdminPlugin } from './mcpOAuthAdmin'
const authFunctions: AuthFunctions = internal.auth

export const authComponent = createAuthComponent<DataModel>(components.betterAuth, {
  authFunctions,
  triggers: {
    user: {
      onCreate: async (ctx, input) => {
        const user = input as {
          email?: unknown
          id?: unknown
          name?: unknown
        }
        if (
          typeof user.id !== 'string' ||
          typeof user.email !== 'string' ||
          typeof user.name !== 'string'
        ) {
          throw new TypeError('AUTH_USER_PROJECTION_INVALID')
        }
        await ctx.db.insert('users', {
          active: true,
          authId: user.id,
          email: user.email,
          name: user.name,
          oauthAdmin: false,
        })
      },
      onDelete: async (ctx, input) => {
        const authId = (input as { id?: unknown }).id
        if (typeof authId !== 'string') throw new Error('AUTH_USER_PROJECTION_INVALID')
        const user = await ctx.db
          .query('users')
          .withIndex('by_auth_id', (q) => q.eq('authId', authId))
          .unique()
        if (user) await ctx.db.patch(user._id, { active: false })
      },
      onUpdate: async (ctx, input) => {
        const user = input as {
          email?: unknown
          id?: unknown
          name?: unknown
        }
        if (
          typeof user.id !== 'string' ||
          typeof user.email !== 'string' ||
          typeof user.name !== 'string'
        ) {
          throw new TypeError('AUTH_USER_PROJECTION_INVALID')
        }
        const projected = await ctx.db
          .query('users')
          .withIndex('by_auth_id', (q) => q.eq('authId', user.id as string))
          .unique()
        if (projected) {
          await ctx.db.patch(projected._id, {
            email: user.email,
            name: user.name,
          })
        }
      },
    },
  },
})

export const { onCreate, onDelete, onUpdate } = authComponent.triggerFunctions()
export const { rotateSigningKey } = authComponent.jwksOperatorFunctions(createAuth)

async function hasOAuthAdminPrivilege(
  ctx: AuthCtx<DataModel>,
  {
    session,
    user,
  }: {
    session?: { userId?: string }
    user?: { id?: string }
  },
): Promise<boolean> {
  if (!user?.id || session?.userId !== user.id) return false
  const userId = user.id
  if ('db' in ctx) {
    const projected = await ctx.db
      .query('users')
      .withIndex('by_auth_id', (q) => q.eq('authId', userId))
      .unique()
    return projected?.active === true && projected.oauthAdmin === true
  }
  if ('runQuery' in ctx && typeof ctx.runQuery === 'function') {
    return await ctx.runQuery(internal.mcpAdmin.hasOAuthAdminPrivilege, {
      authUserId: userId,
    })
  }
  return false
}

function oauthOptions(ctx: AuthCtx<DataModel>): OAuthOptions<Scope[]> {
  return {
    accessTokenExpiresIn: 600,
    allowDynamicClientRegistration: false,
    allowPublicClientPrelogin: true,
    allowUnauthenticatedClientRegistration: false,
    clientPrivileges: (identity) => hasOAuthAdminPrivilege(ctx, identity),
    codeExpiresIn: 120,
    consentPage: '/oauth/consent',
    customAccessTokenClaims: () => ({ token_use: 'oauth-access' }),
    dpop: { signingAlgorithms: [] },
    enforcePerClientResources: true,
    grantTypes: ['authorization_code'],
    loginPage: '/login',
    rateLimit: {
      authorize: { max: 30, window: 60 },
      revoke: { max: 30, window: 60 },
      token: { max: 20, window: 60 },
    },
    resourcePrivileges: (identity) => hasOAuthAdminPrivilege(ctx, identity),
    scopes: [...MCP_SCOPES],
    storeClientSecret: 'hashed',
    storeTokens: 'hashed',
  }
}

export async function createAuth(ctx: AuthCtx<DataModel>) {
  const siteUrl = requireAuthOrigin('SITE_URL')
  const convexSiteUrl = requireAuthOrigin('CONVEX_SITE_URL')
  if (!process.env.BETTER_AUTH_SECRETS) throw new Error('AUTH_CONFIG_INVALID')
  const issuer = `${siteUrl}/api/auth`
  const oauth = oauthOptions(ctx)
  const authConfig = { providers: [getConvexAuthProvider()] }
  // convexAuth hardens the privilege/claim callbacks in-place. Construct it
  // before the official provider snapshots those options, while keeping the
  // runtime plugin order jwt -> convexAuth -> oauthProvider.
  const convexPlugin = convexAuth({
    authConfig,
    oauthProvider: oauth,
    sessionJwt: {
      audience: 'convex',
      expirationTime: '15m',
      issuer: convexSiteUrl,
    },
  })
  const provider = oauthProvider(oauth)
  const auth = betterAuth({
    account: { encryptOAuthTokens: true, storeAccountCookie: false },
    advanced: { ipAddress: { ipAddressHeaders: ['x-bcn-verified-client-ip'] } },
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
      '/oauth2/create-client',
      '/oauth2/get-client',
      '/oauth2/get-clients',
      '/oauth2/update-client',
      '/oauth2/client/rotate-secret',
      '/oauth2/delete-client',
    ],
    emailAndPassword: {
      autoSignIn: false,
      enabled: true,
      minPasswordLength: 15,
    },
    plugins: [
      jwt({
        disableSettingJwtHeader: true,
        jwks: {
          disablePrivateKeyEncryption: false,
          gracePeriod: 21 * 60,
          keyPairConfig: { alg: 'RS256' },
        },
        jwt: { audience: issuer, expirationTime: '10m', issuer },
      }),
      convexPlugin,
      provider,
      mcpOAuthAdminPlugin(ctx, provider, convexSiteUrl),
    ],
    rateLimit: { enabled: true, modelName: 'rateLimit', storage: 'database' },
    trustedOrigins: [siteUrl],
    verification: { storeIdentifier: 'hashed' },
  })
  await auth.$context
  return auth
}
