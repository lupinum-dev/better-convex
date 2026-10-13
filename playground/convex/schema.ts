import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  // ============================================
  // USERS (Better Auth projection)
  // ============================================
  // A rebuildable projection of the Better Auth user, kept in sync by the
  // auth component triggers. Better Auth owns identity, role, org and member
  // state — this table only mirrors display fields for product queries.
  users: defineTable({
    // Auth provider ID (from Better Auth)
    authId: v.string(),

    // User info
    displayName: v.optional(v.string()),
    email: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),

    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_auth_id', ['authId']),

  // ============================================
  // POSTS (permission system demo)
  // ============================================
  // Demonstrates a userland usePermissions() composable with a signed-in + ownership model.
  // The playground does not enable the Better Auth Organization plugin, so
  // the demo shows the minimal context (signed-in + resource ownership)
  // rather than org roles. See the docs for the full Better Auth org model.
  posts: defineTable({
    title: v.string(),
    content: v.string(),
    status: v.union(v.literal('draft'), v.literal('published'), v.literal('archived')),

    // Ownership - required for permission checks
    ownerId: v.string(), // authId of creator

    // Optional metadata
    publishedAt: v.optional(v.number()),

    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_owner', ['ownerId'])
    .index('by_status', ['status']),

  // ============================================
  // TASKS (auth-scoped list demo)
  // ============================================
  tasks: defineTable({
    userId: v.string(), // Better Auth user ID
    title: v.string(),
    completed: v.boolean(),
    createdAt: v.number(),
  }).index('by_user', ['userId']),

  // ============================================
  // FILES (ownership tracking for Convex storage)
  // ============================================
  files: defineTable({
    storageId: v.id('_storage'),
    ownerId: v.string(), // Better Auth user ID
    createdAt: v.number(),
  }).index('by_storage', ['storageId']),

  // ============================================
  // NOTES (public demo)
  // ============================================
  notes: defineTable({
    title: v.string(),
    content: v.string(),
    createdAt: v.number(),
  }),
})
