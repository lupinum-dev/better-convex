import { defineFunctions, definePolicy, owner, tenant } from '@lupinum/better-convex-functions'
import { v } from 'convex/values'

import { auth, notUsed, orgRole, user } from './common'

// A tenant rule on a field that holds an ID of a table that is not a tenant: `users` has no
// `tenant('_id')` rule. It type-checks, so the first row it meets must say what is wrong.
const policy = definePolicy({
  actions: ['notes.create'],
  roles: { owner: ['*'] },
  scopes: {},
})

const { mutation } = defineFunctions({
  auth,
  policy,
  user,
  roleOf: async (ctx, user, tenant) =>
    tenant.table === 'orgs' ? ((await orgRole(ctx, user._id, tenant.id)) as 'owner' | null) : null,
  rules: {
    users: owner('_id'),
    orgs: tenant('_id'),
    memberships: owner('userId'),
    notes: tenant('authorId'),
    ...notUsed(
      'projects',
      'workspaces',
      'docs',
      'agencies',
      'agencyMembers',
      'clients',
      'clientProjects',
      'clientContacts',
    ),
  },
})

export const create = mutation({
  action: 'notes.create',
  args: { text: v.string() },
  returns: v.id('notes'),
  handler: async (ctx, { text }) => ctx.db.insert('notes', { authorId: ctx.actor.user._id, text }),
})
