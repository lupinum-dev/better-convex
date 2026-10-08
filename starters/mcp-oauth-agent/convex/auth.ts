import { consentScopes, trusted } from '@lupinum/better-convex-functions'
import {
  createBetterConvexAuth,
  type AuthFunctions,
} from '@lupinum/better-convex-nuxt/better-auth/server'
import { ConvexError } from 'convex/values'

import { components, internal } from './_generated/api'
import type { DataModel } from './_generated/dataModel'
import { policy } from './policy'

const authFunctions: AuthFunctions = internal.auth

/** Also the name of the MCP resource that host clients are bound to. */
export const APP_NAME = 'Project agent'

function projectedUser(input: unknown) {
  const user = input as { email?: unknown; id?: unknown; name?: unknown }
  if (
    typeof user.id !== 'string' ||
    typeof user.email !== 'string' ||
    typeof user.name !== 'string'
  ) {
    throw new TypeError('AUTH_USER_PROJECTION_INVALID')
  }
  return { authId: user.id, email: user.email, name: user.name }
}

export const auth = createBetterConvexAuth<DataModel>(components.betterAuth, {
  appName: APP_NAME,
  authFunctions,
  // The MCP OAuth profile: operator-provisioned PKCE clients, a consent page,
  // 10-minute access tokens bound to `${CONVEX_SITE_URL}/mcp`, and renewal that
  // ends with the Better Auth session that granted consent.
  // People can delete their own account. The app erases its data in `onDelete` below.
  deleteUser: {
    enabled: true,
    beforeDelete: async (ctx, user) => {
      const refusal = await ctx.runQuery(internal.accountDeletion.refusalForDeletion, {
        authId: user.id,
      })
      if (refusal === 'last-owner')
        throw new ConvexError({
          message:
            'Make another member an owner of your organization before you delete your account.',
        })
      if (refusal === 'too-many-teams')
        throw new ConvexError({
          message:
            'You own more than 100 organizations. Hand some over or delete them, then delete your account.',
        })
    },
  },
  oauth: { mcp: { scopes: consentScopes(policy), hosts: ['chatgpt', 'claude'] } },
  triggers: {
    user: {
      onCreate: async (ctx, input) => {
        const user = projectedUser(input)
        const userId = await ctx.db.insert('users', { ...user, active: true })
        // Every account starts with one organization it owns.
        const organizationId = await ctx.db.insert('organizations', { name: user.name })
        await ctx.db.insert('memberships', {
          organizationId,
          userId,
          role: 'owner',
          status: 'active',
        })
      },
      onUpdate: async (ctx, input) => {
        const { authId, email, name } = projectedUser(input)
        const user = await ctx.db
          .query('users')
          .withIndex('by_auth_id', (q) => q.eq('authId', authId))
          .unique()
        if (user) await ctx.db.patch(user._id, { email, name })
      },
      onDelete: async (ctx, input) => {
        const authId = (input as { id?: unknown }).id
        if (typeof authId !== 'string') throw new TypeError('AUTH_USER_PROJECTION_INVALID')
        const user = await ctx.db
          .query('users')
          .withIndex('by_auth_id', (q) => q.eq('authId', authId))
          .unique()
        if (!user) return
        // Organizations only this person used go first, then what the app holds about the person
        // (`erasure` in ./functions.ts), all in batches. See `scanOrganizations`.
        await ctx.scheduler.runAfter(0, internal.accountDeletion.scanOrganizations, {
          userId: user._id,
          cursor: null,
        })
        await ctx.db.delete(user._id)
      },
    },
  },
})

export const { createAuth } = auth

// Internal functions of the auth component's own: they keep `users` in step with Better Auth and
// rotate signing keys. They run as the auth library or an operator, never for a person or agent.
const triggers = auth.triggerFunctions()
const byAuth = 'Better Auth triggers: they project the auth user into users.'
export const onCreate = trusted(byAuth, triggers.onCreate)
export const onDelete = trusted(byAuth, triggers.onDelete)
export const onUpdate = trusted(byAuth, triggers.onUpdate)

const keys = auth.jwksOperatorFunctions()
const operator = 'Operator function: run it from the Convex dashboard or with `convex run`.'
export const ensureSigningKey = trusted(operator, keys.ensureSigningKey)
export const pruneSigningKeys = trusted(operator, keys.pruneSigningKeys)
export const rotateSigningKey = trusted(operator, keys.rotateSigningKey)
