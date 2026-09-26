import type { OAuthOptions, Scope } from '@better-auth/oauth-provider'
import {
  createBetterConvexAuth,
  type AuthCtx,
  type AuthFunctions,
} from '@lupinum/better-convex-nuxt/better-auth/server'

import { components, internal } from './_generated/api'
import type { DataModel } from './_generated/dataModel'
import { MCP_SCOPES } from './mcp/scopes'

const authFunctions: AuthFunctions = internal.auth

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

export const auth = createBetterConvexAuth<DataModel>(components.betterAuth, {
  authFunctions,
  oauthProvider: (ctx) => oauthOptions(ctx),
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

export const { createAuth } = auth
export const { onCreate, onDelete, onUpdate } = auth.triggerFunctions()
export const { ensureSigningKey, pruneSigningKeys, rotateSigningKey } = auth.jwksOperatorFunctions()
