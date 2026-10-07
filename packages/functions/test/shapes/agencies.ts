import {
  defineFunctions,
  definePolicy,
  type RoleOf,
  owner,
  tenant,
} from '@lupinum/better-convex-functions'
import { v } from 'convex/values'

import { auth, notUsed, user } from './common'

// K3: agency -> client -> project. An agency member works on every client's projects; a
// client contact sees only their client.
const policy = definePolicy({
  actions: ['clients.list', 'clients.create', 'clients.update', 'clientProjects.list'],
  roles: { owner: ['*'], contact: ['clientProjects.list'] },
  scopes: {},
})

const { query, mutation } = defineFunctions({
  auth,
  policy,
  user,
  // A client inherits its agency's roles; contacts are members of the client itself.
  roleOf: async (ctx, user, tenant) => {
    let agencyId
    if (tenant.table === 'clients') {
      const contact = await ctx.db
        .query('clientContacts')
        .withIndex('by_client_user', (q) => q.eq('clientId', tenant.id).eq('userId', user._id))
        .unique()
      if (contact) return contact.role as RoleOf<typeof policy>
      agencyId = (await ctx.db.get(tenant.id))?.agencyId
    } else if (tenant.table === 'agencies') agencyId = tenant.id
    if (!agencyId) return null
    const member = await ctx.db
      .query('agencyMembers')
      .withIndex('by_agency_user', (q) => q.eq('agencyId', agencyId).eq('userId', user._id))
      .unique()
    return (member?.role as RoleOf<typeof policy> | undefined) ?? null
  },
  rules: {
    users: owner('_id'),
    agencies: tenant('_id'),
    agencyMembers: owner('userId'),
    clients: tenant('_id', { parent: 'agencyId', createdBy: 'clients.create' }),
    clientProjects: tenant('clientId'),
    clientContacts: owner('userId'),
    ...notUsed('orgs', 'memberships', 'projects', 'workspaces', 'docs', 'notes'),
  },
})

export const clients = query({
  action: 'clients.list',
  args: { agencyId: v.id('agencies') },
  returns: v.array(v.string()),
  handler: async (ctx, { agencyId }) =>
    (
      await ctx.db
        .query('clients')
        .withIndex('by_agency', (q) => q.eq('agencyId', agencyId))
        .collect()
    ).map((c) => c.name),
})

export const projectsOfClient = query({
  action: 'clientProjects.list',
  args: { clientId: v.id('clients') },
  returns: v.array(v.string()),
  handler: async (ctx, { clientId }) =>
    (
      await ctx.db
        .query('clientProjects')
        .withIndex('by_client', (q) => q.eq('clientId', clientId))
        .collect()
    ).map((p) => p.name),
})

/** A project of one client, read through the agency and the client together. */
export const projectsOfAgencyClient = query({
  action: 'clientProjects.list',
  args: { agencyId: v.id('agencies'), clientId: v.id('clients') },
  returns: v.array(v.string()),
  handler: async (ctx, { clientId }) =>
    (
      await ctx.db
        .query('clientProjects')
        .withIndex('by_client', (q) => q.eq('clientId', clientId))
        .collect()
    ).map((p) => p.name),
})

export const createClient = mutation({
  action: 'clients.create',
  args: { agencyId: v.id('agencies'), name: v.string(), under: v.optional(v.string()) },
  returns: v.id('clients'),
  // `under` lets a test plant a client under another agency than the one the call names. A plain
  // string, so the argument check cannot see it and the insert's parent check must.
  handler: async (ctx, { agencyId, name, under }) =>
    ctx.db.insert('clients', {
      agencyId: (under && ctx.db.normalizeId('agencies', under)) || agencyId,
      name,
    }),
})

/** Moves a client under the agency `to` names: a plain string, so only the write's parent check sees it. */
export const moveClient = mutation({
  action: 'clients.update',
  args: { clientId: v.id('clients'), to: v.string() },
  returns: v.null(),
  handler: async (ctx, { clientId, to }) => {
    await ctx.db.patch(clientId, { agencyId: ctx.db.normalizeId('agencies', to)! })
    return null
  },
})
