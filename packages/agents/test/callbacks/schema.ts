import { libraryTables } from '@lupinum/better-convex-functions'
import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  users: defineTable({ authId: v.string(), active: v.boolean() }).index('by_auth_id', ['authId']),
  orgs: defineTable({ name: v.string() }),
  // `role`: a role, or `bad:<name>` for a value of `bad` (fns.ts) that `roleOf` returns instead.
  memberships: defineTable({ orgId: v.id('orgs'), userId: v.id('users'), role: v.string() }).index(
    'by_org_user',
    ['orgId', 'userId'],
  ),
  // `verdict`: `true`, or `bad:<name>` for a value of `bad` that the table's custom rule returns.
  // A custom rule alone.
  checked: defineTable({ verdict: v.string(), edits: v.optional(v.number()) }),
  // A custom rule as a part of anyOf, next to an owner rule the actor does not pass.
  eitherChecked: defineTable({
    ownerId: v.id('users'),
    verdict: v.string(),
    edits: v.optional(v.number()),
  }),
  // A custom rule as a part of allOf, next to a tenant rule the actor passes.
  bothChecked: defineTable({
    orgId: v.id('orgs'),
    verdict: v.string(),
    edits: v.optional(v.number()),
  }),
  // A publicRead condition alone.
  publicChecked: defineTable({ verdict: v.string(), edits: v.optional(v.number()) }),
  ...libraryTables,
})
