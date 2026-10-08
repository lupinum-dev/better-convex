import { defineFunctions, owner, tenant, type RoleOf } from '@lupinum/better-convex-functions'
import type { GenericQueryCtx } from 'convex/server'

import type { DataModel, Id } from './_generated/dataModel'
import { auth } from './auth'
import { policy } from './policy'

type Role = RoleOf<typeof policy>
type Ctx = GenericQueryCtx<DataModel>

async function agencyRole(ctx: Ctx, userId: Id<'users'>, agencyId: Id<'agencies'>) {
  const member = await ctx.db
    .query('agencyMembers')
    .withIndex('by_agency_user', (q) => q.eq('agencyId', agencyId).eq('userId', userId))
    .unique()
  return member?.role ?? null
}

/** A client's own people are `client` there; agency people keep their agency role. */
async function clientRole(
  ctx: Ctx,
  userId: Id<'users'>,
  clientId: Id<'clients'>,
): Promise<Role | null> {
  const member = await ctx.db
    .query('clientMembers')
    .withIndex('by_client_user', (q) => q.eq('clientId', clientId).eq('userId', userId))
    .unique()
  if (member) return 'client'
  const client = await ctx.db.get(clientId)
  return client ? agencyRole(ctx, userId, client.agencyId) : null
}

export const fns = defineFunctions({
  auth,
  policy,
  user: (ctx, authId) =>
    ctx.db
      .query('users')
      .withIndex('by_auth_id', (q) => q.eq('authId', authId))
      .unique(),
  // Two levels: a project inherits its client's roles, a client its agency's.
  roleOf: async (ctx, user, ref) => {
    switch (ref.table) {
      case 'agencies':
        return agencyRole(ctx, user._id, ref.id)
      case 'clients':
        return clientRole(ctx, user._id, ref.id)
      case 'projects': {
        const project = await ctx.db.get(ref.id)
        return project ? clientRole(ctx, user._id, project.clientId) : null
      }
      default:
        return null
    }
  },
  rules: {
    users: owner('_id'),
    agencies: tenant('_id'),
    agencyMembers: owner('userId'),
    clients: tenant('_id', { parent: 'agencyId' }),
    clientMembers: owner('userId'),
    projects: tenant('_id', { parent: 'clientId', createdBy: 'projects.create' }),
    findings: tenant('projectId'),
  },
})

export const { query, mutation } = fns
