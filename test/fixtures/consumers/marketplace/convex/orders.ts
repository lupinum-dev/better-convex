import { fail } from '@lupinum/better-convex-functions'
import { v } from 'convex/values'

import { mutation, query } from './functions'

// Every operation names the organization it acts for (`orgId`): its role there
// decides, and an agent's work lands in that organization's activity feed.

const order = v.object({
  id: v.id('orders'),
  item: v.string(),
  quantity: v.number(),
  status: v.union(v.literal('placed'), v.literal('shipped'), v.literal('cancelled')),
})

export const list = query({
  action: 'orders.list',
  args: { orgId: v.id('orgs'), side: v.union(v.literal('buying'), v.literal('selling')) },
  returns: v.array(order),
  tool: {
    name: 'list_orders',
    description: 'List the orders your organization placed (buying) or received (selling).',
  },
  handler: async (ctx, { orgId, side }) => {
    const rows =
      side === 'buying'
        ? await ctx.db
            .query('orders')
            .withIndex('by_buyer', (q) => q.eq('buyerOrgId', orgId))
            .take(100)
        : await ctx.db
            .query('orders')
            .withIndex('by_seller', (q) => q.eq('sellerOrgId', orgId))
            .take(100)
    return rows.map(({ _id, item, quantity, status }) => ({ id: _id, item, quantity, status }))
  },
})

export const place = mutation({
  action: 'orders.place',
  args: { orgId: v.id('orgs'), listingId: v.id('listings'), quantity: v.number() },
  returns: v.id('orders'),
  tool: {
    name: 'place_order',
    description: 'Order a listing for your organization.',
    args: { orgId: 'Your organization, the buyer.' },
  },
  handler: async (ctx, { orgId, listingId, quantity }) => {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000)
      fail('INVALID_INPUT', 'quantity: use a whole number from 1 to 1000.')
    const listing = await ctx.db.get(listingId)
    // Drafts of other sellers do not exist here: the listings rule shows only active ones.
    if (!listing) fail('NOT_FOUND', 'No listing with this ID is on sale.')
    if (listing.sellerOrgId === orgId)
      fail('INVALID_INPUT', 'listingId: your organization sells this listing.')
    return await ctx.db.insert('orders', {
      buyerOrgId: orgId,
      sellerOrgId: listing.sellerOrgId,
      listingId,
      item: listing.title,
      quantity,
      status: 'placed',
    })
  },
})

export const ship = mutation({
  action: 'orders.ship',
  args: { orgId: v.id('orgs'), orderId: v.id('orders') },
  returns: v.null(),
  tool: {
    name: 'ship_order',
    description: 'Mark an order you sold as shipped.',
    args: { orgId: 'Your organization, the seller.' },
  },
  handler: async (ctx, { orderId }) => {
    const row = await ctx.db.get(orderId)
    if (!row) fail('NOT_FOUND', 'No order with this ID.')
    if (row.status !== 'placed')
      fail('INVALID_INPUT', `orderId: this order is ${row.status}; only a placed order ships.`)
    await ctx.db.patch(orderId, { status: 'shipped' })
    return null
  },
})

export const cancel = mutation({
  action: 'orders.cancel',
  args: { orgId: v.id('orgs'), orderId: v.id('orders') },
  returns: v.null(),
  tool: {
    name: 'cancel_order',
    description: 'Cancel an order you placed, before it ships.',
    args: { orgId: 'Your organization, the buyer.' },
  },
  approval: async (ctx, { orderId }) => {
    const row = await ctx.db.get(orderId)
    return row
      ? `Cancel the order of ${row.quantity} × "${row.item}".`
      : 'Cancel an order that no longer exists.'
  },
  handler: async (ctx, { orderId }) => {
    const row = await ctx.db.get(orderId)
    if (!row) fail('NOT_FOUND', 'No order with this ID.')
    if (row.status !== 'placed')
      fail(
        'INVALID_INPUT',
        `orderId: this order is ${row.status}; only a placed order can be cancelled.`,
      )
    await ctx.db.patch(orderId, { status: 'cancelled' })
    return null
  },
})
