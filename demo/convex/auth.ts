import {
  convexAuth,
  createAuthComponent,
  createUserProjectionTriggers,
  getConvexAuthProvider,
  requireAuthOrigin,
  type AuthCtx,
  type AuthFunctions,
  type BetterAuthUserProjectionSource,
} from '@lupinum/better-convex-nuxt/convex-auth'
import { betterAuth } from 'better-auth'
import { jwt } from 'better-auth/plugins'
import { v } from 'convex/values'

import { components, internal } from './_generated/api'
import type { DataModel, Doc } from './_generated/dataModel'
import { internalMutation, query } from './_generated/server'

function requireAuthEnvironment(): {
  githubClientId: string
  githubClientSecret: string
} {
  if (!process.env.BETTER_AUTH_SECRETS) throw new Error('BETTER_AUTH_SECRETS is required')
  const githubClientId = process.env.GITHUB_CLIENT_ID
  if (!githubClientId) throw new Error('GITHUB_CLIENT_ID is required')
  const githubClientSecret = process.env.GITHUB_CLIENT_SECRET
  if (!githubClientSecret) throw new Error('GITHUB_CLIENT_SECRET is required')
  return { githubClientId, githubClientSecret }
}

// Auth functions for triggers
const authFunctions: AuthFunctions = internal.auth

type BetterAuthUserPage = {
  page: BetterAuthUserProjectionSource[]
  continueCursor: string
  isDone: boolean
}

function userProjectionFields(user: BetterAuthUserProjectionSource) {
  return {
    displayName: user.name ?? undefined,
    email: user.email ?? undefined,
    avatarUrl: user.image ?? undefined,
  }
}

function userProjectionPatch(
  user: BetterAuthUserProjectionSource,
  existing: Doc<'users'>,
  now: number,
) {
  const fields = userProjectionFields(user)
  if (
    fields.displayName === existing.displayName &&
    fields.email === existing.email &&
    fields.avatarUrl === existing.avatarUrl
  ) {
    return null
  }

  return { ...fields, updatedAt: now }
}

const userProjection = createUserProjectionTriggers<BetterAuthUserProjectionSource, Doc<'users'>>({
  table: 'users',
  index: 'by_auth_id',
  authIdField: 'authId',
  createDoc: ({ user, now }) => ({
    authId: user.id,
    ...userProjectionFields(user),
    createdAt: now,
    updatedAt: now,
  }),
  patchDoc: ({ user, existing, now }) => userProjectionPatch(user, existing, now),
  rebuildDoc: ({ user, existing, now }) => userProjectionPatch(user, existing, now),
})

// Better Auth owns the canonical user. This table is a rebuildable display projection.
export const authComponent = createAuthComponent<DataModel>(components.betterAuth, {
  authFunctions,
  triggers: {
    user: {
      onCreate: async (ctx, user) =>
        userProjection.user.onCreate(ctx, user as BetterAuthUserProjectionSource),
      onUpdate: async (ctx, user, previousUser) =>
        userProjection.user.onUpdate(
          ctx,
          user as BetterAuthUserProjectionSource,
          previousUser as BetterAuthUserProjectionSource,
        ),
      onDelete: async (ctx, user) =>
        userProjection.user.onDelete(ctx, user as BetterAuthUserProjectionSource),
    },
  },
})

// Export trigger handlers for the component
export const { onCreate, onUpdate, onDelete } = authComponent.triggerFunctions()

/** Reconcile one bounded page of the display-only user projection. */
export const rebuildUserProjectionBatch = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const users = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'user',
      paginationOpts: { cursor: args.cursor, numItems: 100 },
    })) as BetterAuthUserPage
    const result = await userProjection.user.rebuild(ctx, users.page)

    return {
      ...result,
      continueCursor: users.continueCursor,
      isDone: users.isDone,
    }
  },
})

// Factory function to create auth instance per request
// Pre-traffic operator ceremony: provision/rotate the one official JWT key graph.
export const { rotateSigningKey } = authComponent.jwksOperatorFunctions(createAuth)

export async function createAuth(ctx: AuthCtx<DataModel>) {
  try {
    const siteUrl = requireAuthOrigin('SITE_URL')
    const convexSiteUrl = requireAuthOrigin('CONVEX_SITE_URL')
    const { githubClientId, githubClientSecret } = requireAuthEnvironment()
    const authIssuer = `${siteUrl}/api/auth`
    const auth = betterAuth({
      account: {
        encryptOAuthTokens: true,
        storeAccountCookie: false,
        accountLinking: {
          allowDifferentEmails: false,
          allowUnlinkingAll: false,
          disableImplicitLinking: true,
          trustedProviders: [],
        },
      },
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
      ],
      plugins: [
        jwt({
          disableSettingJwtHeader: true,
          jwks: {
            disablePrivateKeyEncryption: false,
            gracePeriod: 21 * 60,
            keyPairConfig: { alg: 'RS256' },
          },
          jwt: { audience: authIssuer, expirationTime: '10m', issuer: authIssuer },
        }),
        convexAuth({
          authConfig: { providers: [getConvexAuthProvider()] },
          sessionJwt: {
            audience: 'convex',
            expirationTime: '15m',
            issuer: convexSiteUrl,
          },
        }),
      ],
      rateLimit: { enabled: true, modelName: 'rateLimit', storage: 'database' },
      session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
      socialProviders: {
        github: { clientId: githubClientId, clientSecret: githubClientSecret },
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

// ============================================
// GET PERMISSION CONTEXT
// ============================================
// Fetched once at app startup.
// Returns everything the frontend needs to check permissions.

export const getPermissionContext = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()

    if (!identity) {
      return null
    }

    // Look up user in our database
    const user = await ctx.db
      .query('users')
      .withIndex('by_auth_id', (q) => q.eq('authId', identity.subject))
      .first()

    // User doesn't exist yet - will be created by trigger
    if (!user) {
      return null
    }

    return {
      // Demo-only placeholder: the demo does not model authoritative roles.
      role: 'member' as const,
      userId: user.authId,
      displayName: user.displayName,
      email: user.email,
      avatarUrl: user.avatarUrl,
    }
  },
})

// ============================================
// GET CURRENT USER
// ============================================

export const getCurrentUser = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()

    if (!identity) {
      return null
    }

    const user = await ctx.db
      .query('users')
      .withIndex('by_auth_id', (q) => q.eq('authId', identity.subject))
      .first()

    return user
  },
})
