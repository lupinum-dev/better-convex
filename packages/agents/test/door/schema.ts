import { libraryTables } from '@lupinum/better-convex-functions'
import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

/** Stress fixture: the app shape of convex/ plus the extra tenant shapes K2, K3 and K6 need. */
export default defineSchema({
  users: defineTable({ authId: v.string(), name: v.string() }).index('by_auth_id', ['authId']),
  orgs: defineTable({ name: v.string() }),
  // A plain string, so a role the policy does not know can be stored (K1).
  memberships: defineTable({ orgId: v.id('orgs'), userId: v.id('users'), role: v.string() }).index(
    'by_org_user',
    ['orgId', 'userId'],
  ),
  projects: defineTable({
    orgId: v.id('orgs'),
    name: v.string(),
    status: v.union(v.literal('active'), v.literal('archived')),
  }).index('by_org_status', ['orgId', 'status']),
  // K2: personal workspaces next to organizations.
  workspaces: defineTable({ ownerId: v.id('users'), name: v.string() }),
  docs: defineTable({ workspaceId: v.id('workspaces'), text: v.string() }).index('by_workspace', [
    'workspaceId',
  ]),
  // K3: an agency with clients, each client with projects.
  agencies: defineTable({ name: v.string() }),
  agencyMembers: defineTable({
    agencyId: v.id('agencies'),
    userId: v.id('users'),
    role: v.string(),
  }).index('by_agency_user', ['agencyId', 'userId']),
  clients: defineTable({ agencyId: v.id('agencies'), name: v.string() }).index('by_agency', [
    'agencyId',
  ]),
  clientProjects: defineTable({ clientId: v.id('clients'), name: v.string() }).index('by_client', [
    'clientId',
  ]),
  // A client's own people, who see only that client.
  clientContacts: defineTable({
    clientId: v.id('clients'),
    userId: v.id('users'),
    role: v.string(),
  }).index('by_client_user', ['clientId', 'userId']),
  // K6: a note is private to its author, or shared with an organization.
  notes: defineTable({
    authorId: v.id('users'),
    orgId: v.optional(v.id('orgs')),
    text: v.string(),
  }),
  ...libraryTables,
})
