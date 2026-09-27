import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  // The auth component rows as the beta deployment held them, before the push.
  upgradeEvidence: defineTable({ snapshot: v.string() }),
})
