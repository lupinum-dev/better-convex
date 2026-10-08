import { libraryTables } from '@lupinum/better-convex-functions'
import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

const severity = v.union(v.literal('notice'), v.literal('warning'), v.literal('critical'))
export const findingState = v.union(
  v.literal('open'),
  v.literal('acknowledged'),
  v.literal('fixed'),
  v.literal('regressed'),
)

/**
 * Website-checker's shape: an agency monitors its clients' sites (projects)
 * and their crawl findings. Agency people work on every client; a client's
 * own people see only that client.
 */
export default defineSchema({
  users: defineTable({ authId: v.string(), name: v.string() }).index('by_auth_id', ['authId']),
  agencies: defineTable({ name: v.string() }),
  agencyMembers: defineTable({
    agencyId: v.id('agencies'),
    userId: v.id('users'),
    role: v.union(v.literal('owner'), v.literal('staff')),
  }).index('by_agency_user', ['agencyId', 'userId']),
  clients: defineTable({ agencyId: v.id('agencies'), name: v.string() }).index('by_agency', [
    'agencyId',
  ]),
  /** A client's own people: they see that client's projects and briefs, nothing else. */
  clientMembers: defineTable({ clientId: v.id('clients'), userId: v.id('users') }).index(
    'by_client_user',
    ['clientId', 'userId'],
  ),
  projects: defineTable({ clientId: v.id('clients'), name: v.string(), url: v.string() }).index(
    'by_client',
    ['clientId'],
  ),
  /** Written by the crawler (a job); people acknowledge them. */
  findings: defineTable({
    projectId: v.id('projects'),
    type: v.string(),
    url: v.string(),
    title: v.string(),
    detail: v.string(),
    severity,
    state: findingState,
  }).index('by_project_state', ['projectId', 'state']),
  ...libraryTables,
})
