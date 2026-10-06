import { libraryTables } from '@lupinum/better-convex-functions'
import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export const role = v.union(v.literal('owner'), v.literal('member'), v.literal('viewer'))

/** A small app: organizations with projects, and clients that inherit their organization's roles. */
export default defineSchema({
  users: defineTable({ authId: v.string(), name: v.string(), active: v.boolean() }).index(
    'by_auth_id',
    ['authId'],
  ),

  organizations: defineTable({ name: v.string() }),

  memberships: defineTable({ organizationId: v.id('organizations'), userId: v.id('users'), role })
    .index('by_org_user', ['organizationId', 'userId'])
    .index('by_user', ['userId']),

  projects: defineTable({
    organizationId: v.id('organizations'),
    name: v.string(),
    status: v.union(v.literal('active'), v.literal('archived')),
    archivedAt: v.optional(v.number()),
  })
    .index('by_org_status', ['organizationId', 'status'])
    .index('by_status_archived', ['status', 'archivedAt'])
    .searchIndex('search_name', {
      searchField: 'name',
      filterFields: ['organizationId', 'status'],
    }),

  // A tenant below a tenant: an organization's members work on its clients.
  clients: defineTable({ organizationId: v.id('organizations'), name: v.string() }).index(
    'by_org',
    ['organizationId'],
  ),

  ...libraryTables,
})
