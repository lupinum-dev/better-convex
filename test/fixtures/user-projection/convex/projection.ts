import { internalMutationGeneric, internalQueryGeneric } from 'convex/server'
import { v } from 'convex/values'

import { createUserProjectionTriggers } from '../../../../src/runtime/convex-auth/user-projection'

type AuthUser = {
  id: string
  email: string
}

type AppUser = {
  _id: unknown
  authId: string
  email: string
}

const projection = createUserProjectionTriggers<AuthUser, AppUser>({
  table: 'appUsers',
  index: 'by_auth_id',
  createDoc: ({ user }) => ({ email: user.email }),
  patchDoc: ({ user }) => ({ email: user.email }),
  rebuildDoc: ({ user }) => ({ email: user.email }),
})

export const seed = internalMutationGeneric({
  args: {
    appEmails: v.array(v.string()),
    authId: v.string(),
    canonicalEmail: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert('authUsers', {
      authId: args.authId,
      email: args.canonicalEmail,
    })
    for (const email of args.appEmails) {
      await ctx.db.insert('appUsers', { authId: args.authId, email })
    }
    return null
  },
})

export const updateCanonicalAndProjection = internalMutationGeneric({
  args: {
    authId: v.string(),
    email: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const canonical = await ctx.db
      .query('authUsers')
      .withIndex('by_auth_id', (query) => query.eq('authId', args.authId))
      .unique()
    if (!canonical) throw new Error('AUTH_USER_MISSING')
    const previousUser = { id: args.authId, email: canonical.email }
    const user = { id: args.authId, email: args.email }
    await ctx.db.patch(canonical._id, { email: args.email })
    await projection.user.onUpdate(ctx as never, user, previousUser)
    return null
  },
})

export const rebuild = internalMutationGeneric({
  args: {
    users: v.array(v.object({ id: v.string(), email: v.string() })),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await projection.user.rebuild(ctx as never, args.users)
    return null
  },
})

export const inspect = internalQueryGeneric({
  args: { authId: v.string() },
  returns: v.object({
    appEmails: v.array(v.string()),
    canonicalEmail: v.string(),
  }),
  handler: async (ctx, args) => {
    const canonical = await ctx.db
      .query('authUsers')
      .withIndex('by_auth_id', (query) => query.eq('authId', args.authId))
      .unique()
    if (!canonical) throw new Error('AUTH_USER_MISSING')
    const appUsers = await ctx.db
      .query('appUsers')
      .withIndex('by_auth_id', (query) => query.eq('authId', args.authId))
      .collect()
    return {
      appEmails: appUsers.map((user) => user.email),
      canonicalEmail: canonical.email,
    }
  },
})
