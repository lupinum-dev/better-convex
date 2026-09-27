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
export const auth = createBetterConvexAuth<DataModel>(components.betterAuth, {
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
  // Profile claims are opt-in. The playground shows the name and email from the token.
  defineSessionClaims: ({ user }) => ({ authId: user.id, name: user.name, email: user.email }),
})

export const { createAuth } = auth

// Export trigger handlers for the component
export const { onCreate, onUpdate, onDelete } = auth.triggerFunctions()

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

// Run before the app receives public traffic: create or rotate the JWT signing key.
// Schedule pruneSigningKeys to delete retired keys after the verification grace.
export const { pruneSigningKeys, rotateSigningKey } = auth.jwksOperatorFunctions()

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
    const user = await auth.getUser(ctx)
    if (!user) {
      return null
    }

    // `role` is a static placeholder — the playground has no org plugin. In a
    // real app, read the role from Better Auth (member row / hasPermission).
    return { role: 'member', userId: user.id }
  },
})
