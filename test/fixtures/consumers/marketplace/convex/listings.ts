import { v } from 'convex/values'

import { query } from './functions'

export const browse = query({
  action: 'listings.browse',
  args: {},
  returns: v.array(
    v.object({ id: v.id('listings'), title: v.string(), sellerOrgId: v.id('orgs') }),
  ),
  tool: { name: 'browse_listings', description: 'List what sellers offer right now.' },
  handler: async (ctx) => {
    const listings = await ctx.db
      .query('listings')
      .withIndex('by_active', (q) => q.eq('active', true))
      .take(100)
    return listings.map(({ _id, title, sellerOrgId }) => ({ id: _id, title, sellerOrgId }))
  },
})
