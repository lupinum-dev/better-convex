import {
  defineFunctions,
  definePolicy,
  owner,
  tenant,
  unchecked,
} from '@lupinum/better-convex-functions'
import type { DataModelFromSchemaDefinition } from 'convex/server'

import { people } from '../app/people'
import type schema from '../rules/schema'

type DataModel = DataModelFromSchemaDefinition<typeof schema>

export const policy = definePolicy({
  actions: [
    'projects.read',
    'projects.rename',
    'projects.archive',
    'projects.touch',
    'reports.generate',
    'contact.send',
    'feedback.send',
    'audit.read',
    'notes.add',
    'projects.nest',
    'tasks.run',
  ],
  roles: {
    owner: ['*'],
    viewer: ['projects.read'],
  },
  scopes: { all: { label: 'Everything', actions: ['*'] } },
  public: ['contact.send', 'feedback.send'],
  limits: {
    'projects.rename': { max: 3, every: 'minute' },
    'reports.generate': { max: 2, every: 'hour', per: 'tenant' },
    'contact.send': { max: 2, every: 'minute', per: 'everyone' },
    'feedback.send': { max: 1, every: 'minute' },
    'tasks.run': { max: 1, every: 'minute' },
  },
  audit: ['projects.archive', 'projects.touch', 'projects.nest'],
})

export const { query, mutation, internalQuery, internalMutation, job } = defineFunctions({
  auth: people<DataModel>(),
  policy,
  user: async (ctx, authId) =>
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
    return membership?.role ?? null
  },
  rules: {
    users: owner('_id'),
    orgs: tenant('_id'),
    memberships: unchecked('Not touched by these tests.'),
    projects: tenant('orgId'),
    notes: unchecked('Rows a call writes without a tenant.'),
    locks: unchecked('Unused here.'),
    oddLone: unchecked('Unused here.'),
    oddPart: unchecked('Unused here.'),
    pages: unchecked('Unused here.'),
  },
})
