import {
  defineFunctions,
  definePolicy,
  type RoleOf,
  owner,
  tenant,
  unchecked,
} from '@lupinum/better-convex-functions'
import { v } from 'convex/values'

import { testing } from './fns'

// K2: organizations and personal workspaces, one `roleOf`, one role namespace.
const policy = definePolicy({
  actions: ['projects.search', 'docs.read', 'docs.write', 'docs.move'],
  roles: { owner: ['*'], viewer: ['projects.search', 'docs.read'] },
  scopes: {},
})

const { query, mutation } = defineFunctions({
  auth: testing.auth,
  policy,
  user: (ctx, authId) =>
    ctx.db
      .query('users')
      .withIndex('by_auth_id', (q) => q.eq('authId', authId))
      .unique(),
  roleOf: async (ctx, user, tenant) => {
    if (tenant.table === 'orgs') {
      const membership = await ctx.db
        .query('memberships')
        .withIndex('by_org_user', (q) => q.eq('orgId', tenant.id).eq('userId', user._id))
        .unique()
      return (membership?.role as RoleOf<typeof policy> | undefined) ?? null
    }
    if (tenant.table === 'workspaces') {
      const workspace = await ctx.db.get(tenant.id)
      return workspace?.ownerId === user._id ? 'owner' : null
    }
    return null
  },
  rules: {
    users: owner('_id'),
    orgs: tenant('_id'),
    memberships: owner('userId'),
    projects: tenant('orgId'),
    workspaces: tenant('_id', { createdBy: 'docs.write' }),
    docs: tenant('workspaceId'),
    agencies: unchecked('Not used here.'),
    agencyMembers: unchecked('Not used here.'),
    clients: unchecked('Not used here.'),
    clientProjects: unchecked('Not used here.'),
    clientContacts: unchecked('Not used here.'),
    notes: unchecked('Not used here.'),
  },
})

export const docs = query({
  action: 'docs.read',
  args: { workspaceId: v.id('workspaces') },
  returns: v.array(v.string()),
  handler: async (ctx, { workspaceId }) =>
    (
      await ctx.db
        .query('docs')
        .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
        .collect()
    ).map((d) => d.text),
})

const move = {
  action: 'docs.move' as const,
  args: { docId: v.id('docs'), orgId: v.id('orgs') },
  returns: v.null(),
  handler: async (ctx: any, { docId, orgId }: { docId: string; orgId: string }) => {
    const doc = await ctx.db.get(docId)
    if (!doc) return null
    await ctx.db.insert('projects', { orgId, name: doc.text, status: 'active' })
    await ctx.db.delete(docId)
    return null
  },
}

/** "Move to team" without saying it spans two places: refused. */
export const moveToOrg = mutation(move)

/** The same, declared: the role must allow the action in each place. */
export const moveToOrgAcross = mutation({ ...move, crossTenant: true })
