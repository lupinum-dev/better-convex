import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  appUsers: defineTable({
    authId: v.string(),
    email: v.string(),
  }).index('by_auth_id', ['authId']),
  authUsers: defineTable({
    authId: v.string(),
    email: v.string(),
  }).index('by_auth_id', ['authId']),
})
