import { v } from 'convex/values'

import { mutation } from './functions'

/** Creates a client under an organization; the `clients` rule allows only this action to. */
export const create = mutation({
  action: 'clients.create',
  args: { organizationId: v.id('organizations'), name: v.string() },
  returns: v.id('clients'),
  handler: async (ctx, { organizationId, name }) =>
    await ctx.db.insert('clients', { organizationId, name }),
})
