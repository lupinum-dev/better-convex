import {
  convexAuth,
  createAuthComponent,
  createUserProjectionTriggers,
  getConvexAuthProvider,
  requireAuthOrigin,
  type AuthCtx,
  type AuthFunctions,
  type BetterAuthUserProjectionSource,
} from '@lupinum/better-convex-nuxt/better-auth/server'
import { betterAuth } from 'better-auth'
import { jwt } from 'better-auth/plugins'
import { v } from 'convex/values'

import { components, internal } from './_generated/api'
import type { DataModel, Doc } from './_generated/dataModel'
import { internalMutation, query } from './_generated/server'

function assertAuthSecretsConfigured(): void {
  if (!process.env.BETTER_AUTH_SECRETS) throw new Error('BETTER_AUTH_SECRETS is required')
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

// Better Auth owns identity; this table is a rebuildable display projection.
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

// Pre-traffic operator ceremony: provision/rotate the one official JWT key graph.
export const { rotateSigningKey } = authComponent.jwksOperatorFunctions(createAuth)

// Factory function to create auth instance per request
export async function createAuth(ctx: AuthCtx<DataModel>) {
  try {
    const siteUrl = requireAuthOrigin('SITE_URL')
    const convexSiteUrl = requireAuthOrigin('CONVEX_SITE_URL')
    const authIssuer = `${siteUrl}/api/auth`
    assertAuthSecretsConfigured()
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
      ],
      emailAndPassword: { autoSignIn: false, enabled: true, minPasswordLength: 15 },
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
            definePayload: ({ user }) => ({
              authId: user.id,
              email: user.email,
              emailVerified: user.emailVerified,
              image: user.image ?? undefined,
              name: user.name,
            }),
          },
        }),
      ],
      rateLimit: { enabled: true, modelName: 'rateLimit', storage: 'database' },
      session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
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
// Called by the app-owned usePermissions() composable on the frontend.
// Returns the minimal signed-in context (the user's authId) or null when
// signed out: no args, returns PermissionContext | null.
//
// This playground does not enable the Better Auth Organization plugin, so
// there is no role/org to return — the demo gates on signed-in + ownership.
// For the full role model, read role/membership from Better Auth (see docs).

export const getPermissionContext = query({
  args: {},
  handler: async (ctx): Promise<{ role: string; userId: string } | null> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      return null
    }

    // `role` is a static placeholder — the playground has no org plugin. In a
    // real app, read the role from Better Auth (member row / hasPermission).
    return { role: 'member', userId: identity.subject }
  },
})
