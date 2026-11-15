import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  deletedAuthUsers: defineTable({ authUserId: v.string() }),
})
