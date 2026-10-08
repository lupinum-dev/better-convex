import { defineFunctions, definePolicy, owner, unchecked } from '@lupinum/better-convex-functions'
import type { DataModelFromSchemaDefinition } from 'convex/server'

import { people } from '../app/people'
import schema from './schema'

type DataModel = DataModelFromSchemaDefinition<typeof schema>

export const policy = definePolicy({
  actions: ['drafts.read'],
  roles: { owner: ['*'] },
  scopes: { all: { label: 'Everything', actions: ['*'] } },
})

export const fns = defineFunctions({
  auth: people<DataModel>(),
  policy,
  schema,
  user: async (ctx, authId) =>
    ctx.db
      .query('users')
      .withIndex('by_auth_id', (q) => q.eq('authId', authId))
      .unique(),
  roleOf: async () => null,
  rules: {
    users: owner('_id'),
    drafts: unchecked('Test table.'),
    comments: unchecked('Test table.'),
    projects: unchecked('Test table.'),
  },
  erasure: {
    drafts: { delete: 'authorId' },
    comments: { anonymize: 'authorId' },
    projects: { keep: 'Team data stays with the team.' },
  },
})

export const { eraseStep } = fns.erasure
