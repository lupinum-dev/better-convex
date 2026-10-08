import {
  anyOf,
  custom,
  defineFunctions,
  owner,
  publicRead,
  tenant,
} from '@lupinum/better-convex-functions'

import type { Doc } from './_generated/dataModel'
import { auth } from './auth'
import { policy } from './policy'

/**
 * One side of an order. Both sides read it, each with its own role; only the actions listed
 * change it, and only in a call made for that side. A role that allows `orders.ship` in the
 * buyer organization still cannot ship, because shipping is not the buyer's to do; a person in
 * both organizations ships only as the seller.
 */
const party = (side: 'buyerOrgId' | 'sellerOrgId', writes: readonly string[]) =>
  custom<Doc<'orders'>>(
    async (ctx, order) =>
      (ctx.mode === 'read' || (writes.includes(ctx.action) && ctx.tenant?.id === order[side])) &&
      ctx.allows({ table: 'orgs', id: order[side] }),
  )

export const fns = defineFunctions({
  auth,
  policy,
  user: (ctx, authId) =>
    ctx.db
      .query('users')
      .withIndex('by_auth_id', (q) => q.eq('authId', authId))
      .unique(),
  roleOf: async (ctx, user, tenant) => {
    if (tenant.table !== 'orgs') return null
    const membership = await ctx.db
      .query('memberships')
      .withIndex('by_org_user', (q) => q.eq('orgId', tenant.id).eq('userId', user._id))
      .unique()
    return membership?.role ?? null
  },
  rules: {
    users: owner('_id'),
    orgs: tenant('_id'),
    // Not owner('userId'): a member could change their own role.
    memberships: custom<Doc<'memberships'>>((ctx, membership) =>
      ctx.allows({ table: 'orgs', id: membership.orgId }),
    ),
    // Sellers see their drafts; every signed-in buyer sees what is on sale.
    listings: anyOf(
      tenant('sellerOrgId'),
      publicRead((listing: Doc<'listings'>) => listing.active),
    ),
    orders: anyOf(
      party('buyerOrgId', ['orders.place', 'orders.cancel']),
      party('sellerOrgId', ['orders.ship']),
    ),
  },
})

export const { query, mutation } = fns
