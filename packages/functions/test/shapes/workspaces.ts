import {
  defineFunctions,
  definePolicy,
  docValidator,
  type RoleOf,
  owner,
  tenant,
} from '@lupinum/better-convex-functions'
import { v } from 'convex/values'

import { auth, notUsed, orgRole, user } from './common'
import schema from './schema'

// K2: organizations and personal workspaces, one `roleOf`, one role namespace.
const policy = definePolicy({
  actions: ['projects.read', 'docs.move'],
  roles: { owner: ['*'], viewer: ['projects.read'] },
  scopes: {},
})

const { query, mutation } = defineFunctions({
  auth,
  policy,
  user,
  roleOf: async (ctx, user, tenant) => {
    if (tenant.table === 'orgs')
      return (await orgRole(ctx, user._id, tenant.id)) as RoleOf<typeof policy> | null
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
    workspaces: tenant('_id'),
    docs: tenant('workspaceId'),
    ...notUsed('agencies', 'agencyMembers', 'clients', 'clientProjects', 'clientContacts', 'notes'),
  },
})

/** E10: a whole document, with the validator derived from the schema. */
export const project = query({
  action: 'projects.read',
  args: { projectId: v.id('projects') },
  returns: v.union(docValidator(schema, 'projects'), v.null()),
  handler: async (ctx, { projectId }) => await ctx.db.get(projectId),
})

const move = {
  action: 'docs.move' as const,
  args: { docId: v.id('docs'), orgId: v.id('orgs') },
  returns: v.null(),
  handler: async (ctx: any, { docId, orgId }: { docId: string; orgId: string }) => {
    const doc = await ctx.db.get(docId)
    await ctx.db.insert('projects', { orgId, name: doc.text })
    await ctx.db.delete(docId)
    return null
  },
}

/** "Move to team" without saying it spans two places: refused. */
export const moveToOrg = mutation(move)

/** The same, declared: the role must allow the action in each place. */
export const moveToOrgAcross = mutation({ ...move, crossTenant: true })

/** Names the org but changes only the doc: no row rule sees the org, so only the role check does. */
export const noteOrgAcross = mutation({
  ...move,
  crossTenant: true,
  handler: async (ctx: any, { docId, orgId }: { docId: string; orgId: string }) => {
    await ctx.db.patch(docId, { text: `Moved to ${orgId}` })
    return null
  },
})
