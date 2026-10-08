import { libraryTables } from '@lupinum/better-convex-functions'
import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  users: defineTable({ authId: v.string() }).index('by_auth_id', ['authId']),
  drafts: defineTable({ authorId: v.id('users'), text: v.string() }).index('by_author', [
    'authorId',
  ]),
  comments: defineTable({ authorId: v.optional(v.id('users')), body: v.string() }).index(
    'by_author',
    ['authorId'],
  ),
  projects: defineTable({ ownerId: v.id('users'), name: v.string() }),
  ...libraryTables,
})
