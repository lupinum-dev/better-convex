import { libraryTables } from '@lupinum/better-convex-functions'
import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

/** Marketplace slice: organizations sell listings to each other; an order belongs to both the buyer and the seller. */
export default defineSchema({
  users: defineTable({ authId: v.string(), name: v.string() }).index('by_auth_id', ['authId']),
  orgs: defineTable({ name: v.string() }),
  memberships: defineTable({
    orgId: v.id('orgs'),
    userId: v.id('users'),
    role: v.union(v.literal('owner'), v.literal('member'), v.literal('viewer')),
  }).index('by_org_user', ['orgId', 'userId']),
  listings: defineTable({
    sellerOrgId: v.id('orgs'),
    title: v.string(),
    active: v.boolean(),
  }).index('by_active', ['active']),
  orders: defineTable({
    buyerOrgId: v.id('orgs'),
    sellerOrgId: v.id('orgs'),
    listingId: v.id('listings'),
    // Copied from the listing, so the order still reads right after the listing changes.
    item: v.string(),
    quantity: v.number(),
    status: v.union(v.literal('placed'), v.literal('shipped'), v.literal('cancelled')),
  })
    .index('by_buyer', ['buyerOrgId'])
    .index('by_seller', ['sellerOrgId']),
  ...libraryTables,
})
