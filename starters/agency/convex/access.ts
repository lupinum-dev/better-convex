import { ConvexError } from 'convex/values'

import type { Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { requireCurrentUser } from './users'

type Role = 'owner' | 'admin' | 'member' | 'viewer'

const roleRank: Record<Role, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  viewer: 1,
}

export async function requireOrganizationKind(
  ctx: QueryCtx | MutationCtx,
  organizationId: Id<'organizations'>,
  expectedKind: 'agency' | 'client',
) {
  const organization = await ctx.db.get(organizationId)
  if (!organization || organization.kind !== expectedKind) {
    throw new ConvexError(
      `${expectedKind === 'agency' ? 'Agency' : 'Client'} organization not found`,
    )
  }

  return organization
}

export async function requireOrgMember(
  ctx: QueryCtx | MutationCtx,
  organizationId: Id<'organizations'>,
  minimumRole: Role = 'viewer',
) {
  const user = await requireCurrentUser(ctx)
  const membership = await ctx.db
    .query('memberships')
    .withIndex('by_org_user', (q) => q.eq('organizationId', organizationId).eq('userId', user._id))
    .unique()

  if (!membership || membership.status !== 'active') {
    throw new ConvexError('Organization access denied')
  }

  if (roleRank[membership.role as Role] < roleRank[minimumRole]) {
    throw new ConvexError('Insufficient role')
  }

  return { user, membership, accessPath: 'direct' as const }
}

export async function requireDelegatedClientAccess(
  ctx: QueryCtx | MutationCtx,
  args: {
    agencyOrganizationId: Id<'organizations'>
    clientOrganizationId: Id<'organizations'>
  },
  minimumAgencyRole: Role = 'member',
) {
  // Authenticate first, so an anonymous caller cannot learn which organization ids exist.
  await requireCurrentUser(ctx)
  await Promise.all([
    requireOrganizationKind(ctx, args.agencyOrganizationId, 'agency'),
    requireOrganizationKind(ctx, args.clientOrganizationId, 'client'),
  ])
  const agencyAccess = await requireOrgMember(ctx, args.agencyOrganizationId, minimumAgencyRole)
  const link = await ctx.db
    .query('organizationLinks')
    .withIndex('by_agency_client', (q) =>
      q
        .eq('agencyOrganizationId', args.agencyOrganizationId)
        .eq('clientOrganizationId', args.clientOrganizationId),
    )
    .unique()

  if (!link || link.status !== 'active') {
    throw new ConvexError('Client access denied')
  }

  return {
    user: agencyAccess.user,
    link,
    accessPath: 'delegated' as const,
  }
}
