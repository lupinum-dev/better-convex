import { ConvexError, v } from 'convex/values'

import { mutation, query } from './_generated/server'
import { requireDelegatedClientAccess, requireOrganizationKind, requireOrgMember } from './access'
import { writeAuditEvent } from './audit'
import { requireCurrentUser } from './users'

export const revoke = mutation({
  args: {
    agencyOrganizationId: v.id('organizations'),
    clientOrganizationId: v.id('organizations'),
  },
  handler: async (ctx, args) => {
    // Authenticate first, so an anonymous caller cannot learn which organization ids exist.
    const user = await requireCurrentUser(ctx)
    await Promise.all([
      requireOrganizationKind(ctx, args.agencyOrganizationId, 'agency'),
      requireOrganizationKind(ctx, args.clientOrganizationId, 'client'),
    ])
    const memberships = await Promise.all(
      [args.agencyOrganizationId, args.clientOrganizationId].map(async (organizationId) => {
        return await ctx.db
          .query('memberships')
          .withIndex('by_org_user', (q) =>
            q.eq('organizationId', organizationId).eq('userId', user._id),
          )
          .unique()
      }),
    )
    const mayRevoke = memberships.some(
      (membership) =>
        membership?.status === 'active' &&
        (membership.role === 'owner' || membership.role === 'admin'),
    )
    if (!mayRevoke) {
      throw new ConvexError('Organization link revocation denied')
    }
    const link = await ctx.db
      .query('organizationLinks')
      .withIndex('by_agency_client', (q) =>
        q
          .eq('agencyOrganizationId', args.agencyOrganizationId)
          .eq('clientOrganizationId', args.clientOrganizationId),
      )
      .unique()

    if (link?.status === 'active') {
      await ctx.db.patch(link._id, {
        status: 'revoked',
        updatedAt: Date.now(),
      })
      const clientMembership = memberships[1]
      await writeAuditEvent(ctx, {
        organizationId: args.clientOrganizationId,
        actorUserId: user._id,
        accessPath:
          clientMembership?.status === 'active' &&
          (clientMembership.role === 'owner' || clientMembership.role === 'admin')
            ? 'direct'
            : 'delegated',
        action: 'organizationLinks.revoke',
        resourceType: 'organizationLink',
        resourceId: link._id,
      })
    }
  },
})

export const listClients = query({
  args: {
    agencyOrganizationId: v.id('organizations'),
  },
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.agencyOrganizationId)
    await requireOrganizationKind(ctx, args.agencyOrganizationId, 'agency')
    const links = await ctx.db
      .query('organizationLinks')
      .withIndex('by_agency_status', (q) =>
        q.eq('agencyOrganizationId', args.agencyOrganizationId).eq('status', 'active'),
      )
      .take(100)

    const clients = []
    for (const link of links) {
      const client = await ctx.db.get(link.clientOrganizationId)
      if (client) clients.push({ id: client._id, name: client.name, kind: client.kind })
    }

    return clients
  },
})

export const assertClientAccess = query({
  args: {
    agencyOrganizationId: v.id('organizations'),
    clientOrganizationId: v.id('organizations'),
  },
  handler: async (ctx, args) => {
    await requireDelegatedClientAccess(ctx, args)
    return true
  },
})
