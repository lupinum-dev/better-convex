import {
  defineFunctions,
  definePolicy,
  anyOf,
  owner,
  tenant,
} from '@lupinum/better-convex-functions'
import { testAuth } from '@lupinum/better-convex-functions/test'
import type { DataModelFromSchemaDefinition } from 'convex/server'

import type schema from './schema'

type DataModel = DataModelFromSchemaDefinition<typeof schema>

export const policy = definePolicy({
  actions: [
    'projects.list',
    'projects.read',
    'projects.rename',
    'projects.archive',
    'projects.export',
    'notes.edit',
  ],
  roles: { owner: ['*'], viewer: ['projects.list', 'projects.read'] },
  scopes: {
    'projects:read': { label: 'See projects.', actions: ['projects.list', 'projects.read'] },
    'projects:write': {
      label: 'Change projects.',
      actions: ['projects.rename', 'projects.archive', 'projects.export', 'notes.edit'],
    },
  },
  // Small exports run on their own; large ones wait for a person.
  agents: {
    'notes.edit': 'approve',
    'projects.archive': 'approve',
    'projects.export': ({ size }) => (size > 100 ? 'approve' : 'allow'),
  },
  approvers: { 'projects.archive': ['owner'] },
})

// Auth is the one outside service; the fake names a person by the test identity's subject.
const { auth } = testAuth<DataModel>()

export const fns = defineFunctions({
  auth,
  policy,
  user: async (ctx, authId) => {
    const user = await ctx.db
      .query('users')
      .withIndex('by_auth_id', (q) => q.eq('authId', authId))
      .unique()
    return user?.active ? user : null
  },
  roleOf: async (ctx, user, tenant) => {
    if (tenant.table !== 'orgs') return null
    const membership = await ctx.db
      .query('memberships')
      .withIndex('by_org_user', (q) => q.eq('orgId', tenant.id).eq('userId', user._id))
      .unique()
    return membership?.role ?? null
  },
  rules: {
    users: owner('_id'),
    orgs: tenant('_id'),
    memberships: owner('userId'),
    projects: tenant('orgId'),
    notes: anyOf(owner('userId'), tenant('orgId')),
  },
})

export const { query, mutation, internalMutation } = fns
