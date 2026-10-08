import { libraryTables } from '@lupinum/better-convex-functions'
import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

/** The MCP door fixture: organizations with projects. */
export default defineSchema({
  users: defineTable({ authId: v.string(), name: v.string() }).index('by_auth_id', ['authId']),
  orgs: defineTable({ name: v.string() }),
  memberships: defineTable({
    orgId: v.id('orgs'),
    userId: v.id('users'),
    role: v.literal('owner'),
  }).index('by_org_user', ['orgId', 'userId']),
  projects: defineTable({
    orgId: v.id('orgs'),
    name: v.string(),
    status: v.union(v.literal('active'), v.literal('archived')),
  }).index('by_org_status', ['orgId', 'status']),
  ...libraryTables,
})
