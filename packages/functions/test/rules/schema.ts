import { libraryTables } from '@lupinum/better-convex-functions'
import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  users: defineTable({ authId: v.string(), active: v.optional(v.boolean()) }).index('by_auth_id', [
    'authId',
  ]),
  orgs: defineTable({ name: v.string() }),
  memberships: defineTable({
    orgId: v.id('orgs'),
    userId: v.id('users'),
    role: v.union(v.literal('owner'), v.literal('viewer')),
  })
    .index('by_org_user', ['orgId', 'userId'])
    .index('by_user', ['userId']),
  projects: defineTable({ orgId: v.id('orgs'), name: v.string(), archived: v.boolean() })
    .index('by_org', ['orgId'])
    .searchIndex('search_name', { searchField: 'name' }),
  notes: defineTable({ userId: v.id('users'), text: v.string() }),
  // Public when published; members of the org edit them.
  pages: defineTable({ orgId: v.id('orgs'), title: v.string(), published: v.boolean() }).index(
    'by_org',
    ['orgId'],
  ),
  ...libraryTables,
})
