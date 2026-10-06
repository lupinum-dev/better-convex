import { libraryTables } from '@lupinum/better-convex-functions'
import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  users: defineTable({ authId: v.string(), active: v.boolean() }).index('by_auth_id', ['authId']),
  orgs: defineTable({ name: v.string() }),
  memberships: defineTable({
    orgId: v.id('orgs'),
    userId: v.id('users'),
    role: v.union(v.literal('owner'), v.literal('viewer')),
  })
    .index('by_org_user', ['orgId', 'userId'])
    .index('by_user', ['userId']),
  projects: defineTable({
    orgId: v.id('orgs'),
    name: v.string(),
    status: v.union(v.literal('active'), v.literal('archived')),
  }).index('by_org', ['orgId']),
  // Private to the author, or shared with an org.
  notes: defineTable({ userId: v.id('users'), orgId: v.optional(v.id('orgs')), text: v.string() }),
  ...libraryTables,
})
