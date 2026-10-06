import {
  defineFunctions,
  definePolicy,
  type RoleOf,
  owner,
  tenant,
  unchecked,
} from '@lupinum/better-convex-functions'
import { testAuth } from '@lupinum/better-convex-functions/test'

import type { DataModel } from './dataModel'

export const policy = definePolicy({
  actions: [
    'orgs.list',
    'projects.search',
    'projects.create',
    'projects.rename',
    'projects.archive',
    'shapes.echo',
    'activity.read',
  ],
  roles: {
    owner: ['*'],
    member: ['orgs.list', 'projects.search', 'projects.create', 'projects.rename', 'shapes.echo'],
    viewer: ['orgs.list', 'projects.search'],
  },
  scopes: {
    read: {
      label: 'Read',
      actions: ['orgs.list', 'projects.search', 'shapes.echo', 'activity.read'],
    },
    write: { label: 'Write', actions: ['projects.create', 'projects.rename', 'projects.archive'] },
  },
  agents: { 'projects.archive': 'approve' },
})

/** Fake auth and MCP token check; `reset()` in setup. */
export const testing = testAuth<DataModel>()

export const fns = defineFunctions({
  auth: testing.auth,
  policy,
  user: (ctx, authId) =>
    ctx.db
      .query('users')
      .withIndex('by_auth_id', (q) => q.eq('authId', authId))
      .unique(),
  roleOf: async (ctx, user, tenant) => {
    if (tenant.table !== 'orgs') return null
    const membership = await ctx.db
      .query('memberships')
      .withIndex('by_org_user', (q) => q.eq('orgId', tenant.id).eq('userId', user._id))
      .unique()
    // The table stores any string (K1); the policy decides what a role may do.
    return (membership?.role as RoleOf<typeof policy> | undefined) ?? null
  },
  rules: {
    users: owner('_id'),
    orgs: tenant('_id'),
    memberships: owner('userId'),
    projects: tenant('orgId'),
    workspaces: unchecked('Not used by this function set.'),
    docs: unchecked('Not used by this function set.'),
    agencies: unchecked('Not used by this function set.'),
    agencyMembers: unchecked('Not used by this function set.'),
    clients: unchecked('Not used by this function set.'),
    clientProjects: unchecked('Not used by this function set.'),
    clientContacts: unchecked('Not used by this function set.'),
    notes: unchecked('Not used by this function set.'),
  },
})

export const { query, mutation, job } = fns
