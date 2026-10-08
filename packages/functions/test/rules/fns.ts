import {
  allOf,
  anyOf,
  custom,
  defineFunctions,
  definePolicy,
  owner,
  publicRead,
  tenant,
  unchecked,
} from '@lupinum/better-convex-functions'
import type { DataModelFromSchemaDefinition, DocumentByName } from 'convex/server'

import { people } from '../app/people'
import type schema from './schema'

type DataModel = DataModelFromSchemaDefinition<typeof schema>

export const policy = definePolicy({
  actions: [
    'projects.read',
    'projects.archive',
    'projects.rename',
    'notes.read',
    'pages.read',
    'pages.edit',
    'members.list',
    'members.edit',
  ],
  roles: { owner: ['*'], viewer: ['projects.read', 'pages.read', 'members.list'] },
  scopes: { all: { label: 'Everything', actions: ['*'] } },
  public: ['pages.read'],
})

// Auth is the one outside service; the fake names a person by the test identity's subject.
const auth = people<DataModel>()

export const { query, mutation, internalQuery, internalMutation, internalAction, job } =
  defineFunctions({
    auth,
    policy,
    user: async (ctx, authId) => {
      const user = await ctx.db
        .query('users')
        .withIndex('by_auth_id', (q) => q.eq('authId', authId))
        .unique()
      return user?.active === false ? null : user
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
      // The documented rule (row-rules.md): every membership of an org where the role allows the action.
      memberships: custom<DocumentByName<DataModel, 'memberships'>>((ctx, membership) =>
        ctx.allows({ table: 'orgs', id: membership.orgId }),
      ),
      // An archived project is read-only: a state condition in the rule, not in each handler.
      projects: allOf(
        tenant('orgId'),
        custom<DocumentByName<DataModel, 'projects'>>(
          (ctx, project) =>
            ctx.mode === 'read' || !project.archived || ctx.action === 'projects.archive',
        ),
      ),
      notes: unchecked('Test table for the escape hatch.'),
      // A careless rule: it unlocks the row it was handed while reading.
      locks: allOf(
        tenant('orgId'),
        custom<DocumentByName<DataModel, 'locks'>>((ctx, lock) => {
          if (ctx.mode === 'write') return !lock.locked
          lock.locked = false
          return true
        }),
      ),
      pages: anyOf(
        publicRead((page: { published: boolean }) => page.published),
        tenant('orgId'),
      ),
    },
  })
