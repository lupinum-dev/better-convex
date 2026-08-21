import {
  createBetterConvexAuth,
  createUserProjectionTriggers,
  type AuthFunctions,
  type BetterAuthUserProjectionSource,
} from '@lupinum/better-convex-nuxt/better-auth/server'
import { v } from 'convex/values'

import { components, internal } from './_generated/api'
import type { DataModel, Doc } from './_generated/dataModel'
import { internalMutation, query } from './_generated/server'

function requireAuthEnvironment(): {
  githubClientId: string
  githubClientSecret: string
} {
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
export const betterConvexAuth = createBetterConvexAuth<DataModel>(components.betterAuth, {
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
  socialProviders: () => {
    const { githubClientId, githubClientSecret } = requireAuthEnvironment()
    return { github: { clientId: githubClientId, clientSecret: githubClientSecret } }
  },
})

export const { authComponent, createAuth } = betterConvexAuth

// Export trigger handlers for the component
export const { onCreate, onUpdate, onDelete } = betterConvexAuth.triggerFunctions()

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
export const { rotateSigningKey } = betterConvexAuth.jwksOperatorFunctions()

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
