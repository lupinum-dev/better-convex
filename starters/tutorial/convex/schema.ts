import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  todos: defineTable({
    ownerId: v.string(),
    text: v.string(),
    completed: v.boolean(),
  }).index('by_owner', ['ownerId']),
})
