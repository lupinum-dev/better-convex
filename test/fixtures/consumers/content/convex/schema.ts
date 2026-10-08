import { libraryTables } from '@lupinum/better-convex-functions'
import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

/**
 * Ginko CMS pages, cut down to what read and edit need. Ginko serves one site
 * per deployment; here a site is the tenant, so a second site can hold the
 * canary rows the leak test watches.
 */
export default defineSchema({
  users: defineTable({ authId: v.string(), name: v.string() }).index('by_auth_id', ['authId']),
  sites: defineTable({ name: v.string() }),
  members: defineTable({
    siteId: v.id('sites'),
    userId: v.id('users'),
    role: v.union(v.literal('owner'), v.literal('editor'), v.literal('viewer')),
  }).index('by_site_user', ['siteId', 'userId']),
  pages: defineTable({
    siteId: v.id('sites'),
    slug: v.string(),
    title: v.string(),
    body: v.string(),
    status: v.union(v.literal('draft'), v.literal('published')),
  })
    // Status before slug: a visitor's lookup must name `published`, or it meets a draft and fails.
    .index('by_site_status_slug', ['siteId', 'status', 'slug']),
  ...libraryTables,
})
