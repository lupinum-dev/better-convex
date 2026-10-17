import {
  defineFunctions,
  definePolicy,
  type RoleOf,
  custom,
  owner,
} from '@lupinum/better-convex-functions'
import { v } from 'convex/values'

import { auth, notUsed, user } from './common'

// K7: one workspace and no tenant tables, like a small business app. The role is app-wide
// (`appRoleOf`), so the library checks it on every call, and no handler or wrapper has to.
const policy = definePolicy({
  actions: ['projects.read', 'projects.rename', 'profile.read'],
  roles: { owner: ['*'], viewer: ['projects.read'] },
  scopes: {},
  signedIn: ['profile.read'],
})

const { query, mutation } = defineFunctions({
  auth,
  policy,
  user,
  roleOf: async () => null,
  appRoleOf: async (ctx, user) => {
    // The workspace's one membership list; the person's row is their role.
    const membership = await ctx.db
      .query('memberships')
      .filter((q) => q.eq(q.field('userId'), user._id))
      .first()
    return (membership?.role ?? null) as RoleOf<typeof policy> | null
  },
  rules: {
    users: owner('_id'),
    memberships: owner('userId'),
    // Every member sees every row of the workspace: the role check is the call's, not the row's.
    projects: custom(async () => true),
    ...notUsed(
      'orgs',
      'workspaces',
      'docs',
      'agencies',
      'agencyMembers',
      'clients',
      'clientProjects',
      'clientContacts',
      'notes',
    ),
  },
})

export const project = query({
  action: 'projects.read',
  args: { projectId: v.id('projects') },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { projectId }) => (await ctx.db.get(projectId))?.name ?? null,
})

export const rename = mutation({
  action: 'projects.rename',
  args: { projectId: v.id('projects'), name: v.string() },
  returns: v.null(),
  handler: async (ctx, { projectId, name }) => {
    await ctx.db.patch(projectId, { name })
    return null
  },
})

/** Open to every signed-in person, member or not. */
export const profile = query({
  action: 'profile.read',
  args: {},
  returns: v.string(),
  handler: async (ctx) => ctx.actor.kind,
})
