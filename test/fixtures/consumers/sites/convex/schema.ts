import { libraryTables } from '@lupinum/better-convex-functions'
import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  users: defineTable({ authId: v.string(), name: v.string() }).index('by_auth_id', ['authId']),

  organizations: defineTable({ name: v.string() }),

  memberships: defineTable({
    organizationId: v.id('organizations'),
    userId: v.id('users'),
    role: v.union(v.literal('owner'), v.literal('member'), v.literal('viewer')),
  }).index('by_org_user', ['organizationId', 'userId']),

  // A website an organization monitors.
  sites: defineTable({
    organizationId: v.id('organizations'),
    name: v.string(),
    url: v.string(),
  }).index('by_org', ['organizationId']),

  // One paid check of a site. `organizationId` is copied from the site so the row rule can
  // check it without a lookup. queued -> running -> ok | failed.
  siteChecks: defineTable({
    organizationId: v.id('organizations'),
    siteId: v.id('sites'),
    status: v.union(
      v.literal('queued'),
      v.literal('running'),
      v.literal('ok'),
      v.literal('failed'),
    ),
    requestedBy: v.id('users'),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    score: v.optional(v.number()),
    summary: v.optional(v.string()),
  })
    .index('by_site_status', ['siteId', 'status'])
    .index('by_status', ['status']),

  // Approvals, agent activity and agent rate limits.
  ...libraryTables,
})
