import { libraryTables } from '@lupinum/better-convex-functions'
import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export const role = v.union(
  v.literal('owner'),
  v.literal('admin'),
  v.literal('member'),
  v.literal('viewer'),
)

export default defineSchema({
  // Rebuildable projection. Better Auth remains the canonical user store.
  users: defineTable({
    authId: v.string(),
    email: v.string(),
    name: v.string(),
    // App-owned suspension. A suspended user keeps their login but no function lets them act.
    active: v.boolean(),
  })
    .index('by_auth_id', ['authId'])
    .index('by_email', ['email']),

  organizations: defineTable({ name: v.string() }),

  memberships: defineTable({
    organizationId: v.id('organizations'),
    userId: v.id('users'),
    role,
    status: v.union(v.literal('active'), v.literal('removed')),
  })
    .index('by_org_user', ['organizationId', 'userId'])
    // Both end in `role` so the account deletion can list a person's active owner memberships,
    // and an organization's active owners, without reading removed rows.
    .index('by_user', ['userId', 'status', 'role'])
    .index('by_org_status', ['organizationId', 'status', 'role']),

  projects: defineTable({
    organizationId: v.id('organizations'),
    name: v.string(),
    status: v.union(v.literal('active'), v.literal('archived')),
    createdBy: v.id('users'),
    archivedAt: v.optional(v.number()),
  })
    .index('by_org_status', ['organizationId', 'status'])
    .searchIndex('search_name', {
      searchField: 'name',
      filterFields: ['organizationId', 'status'],
    }),

  // Approvals, agent activity and agent rate limits.
  ...libraryTables,
})
