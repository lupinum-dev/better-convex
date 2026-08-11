import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  relationshipEvents: defineTable({
    event: v.union(v.literal('delete'), v.literal('update')),
    model: v.string(),
    rowId: v.string(),
  }),
})
