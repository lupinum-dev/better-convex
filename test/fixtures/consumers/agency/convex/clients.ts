import { v } from 'convex/values'

import { query } from './functions'

/** The agency's clients. Only agency people have a role in the agency, so a client's people get NOT_FOUND. */
export const list = query({
  action: 'clients.list',
  args: { agencyId: v.id('agencies') },
  returns: v.array(v.object({ id: v.id('clients'), name: v.string() })),
  tool: { name: 'list_clients', description: "List the agency's clients." },
  handler: async (ctx, { agencyId }) => {
    const clients = await ctx.db
      .query('clients')
      .withIndex('by_agency', (q) => q.eq('agencyId', agencyId))
      .take(200)
    return clients.map(({ _id, name }) => ({ id: _id, name }))
  },
})
