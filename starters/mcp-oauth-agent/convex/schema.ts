import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  // Rebuildable projection. Better Auth remains the canonical user store.
  users: defineTable({
    authId: v.string(),
    email: v.string(),
    name: v.string(),
    // App-owned suspension. A suspended user keeps their login but loses MCP access.
    active: v.boolean(),
  })
    .index('by_auth_id', ['authId'])
    .index('by_email', ['email']),

  organizations: defineTable({ name: v.string() }),

  memberships: defineTable({
    organizationId: v.id('organizations'),
    userId: v.id('users'),
    role: v.union(v.literal('owner'), v.literal('admin'), v.literal('member'), v.literal('viewer')),
    status: v.union(v.literal('active'), v.literal('removed')),
  })
    .index('by_org_user', ['organizationId', 'userId'])
    .index('by_user', ['userId', 'status']),

  projects: defineTable({
    organizationId: v.id('organizations'),
    name: v.string(),
    status: v.union(v.literal('active'), v.literal('deleted')),
    createdBy: v.id('users'),
    deletedAt: v.optional(v.number()),
  }).index('by_org_status', ['organizationId', 'status']),

  // A person approves a deletion the agent requested. Bound to user, client, and project.
  approvals: defineTable({
    operation: v.literal('projects.delete'),
    projectId: v.id('projects'),
    organizationId: v.id('organizations'),
    userId: v.id('users'),
    clientId: v.string(),
    status: v.union(
      v.literal('pending'),
      v.literal('approved'),
      v.literal('rejected'),
      v.literal('used'),
    ),
    expiresAt: v.number(),
    approvedBy: v.optional(v.id('users')),
    usedAt: v.optional(v.number()),
  })
    .index('by_project_client_user', ['projectId', 'clientId', 'userId'])
    .index('by_org_status_expiry', ['organizationId', 'status', 'expiresAt']),

  mcpRateLimits: defineTable({
    key: v.string(),
    windowStartedAt: v.number(),
    count: v.number(),
  }).index('by_key', ['key']),
})
