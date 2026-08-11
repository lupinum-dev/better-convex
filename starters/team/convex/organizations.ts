import { paginationOptsValidator } from 'convex/server'
import { ConvexError, v } from 'convex/values'

import {
  cancelInvitationInputSchema,
  changeMemberRoleInputSchema,
  createOrganizationInputSchema,
  createTeamInputSchema,
  inviteMemberInputSchema,
  removeMemberInputSchema,
  renameOrganizationInputSchema,
} from '../shared/inputSchemas'
import {
  canViewOrganizationActivity,
  isInviteRole,
  isOrganizationRole,
} from '../shared/organizationRoles'
import { components } from './_generated/api'
import { mutation, query, type QueryCtx } from './_generated/server'
import { roleAllowsOrganizationPermissions } from './betterAuth/schemaPlugins'
import {
  getAuthenticatedSessionOrNull,
  hasOrganizationPermissions,
  requireAuthenticatedSession,
  requireAuthenticatedUser,
  requireOrgMembership,
} from './lib/authz'
import {
  getBetterAuthMember,
  getBetterAuthOrganization,
  getBetterAuthPendingInvitationByEmail,
  getBetterAuthTeam,
  listBetterAuthOrganizationInvitationsPage,
  listBetterAuthOrganizationMembersPage,
} from './lib/betterAuthRows'
import { requireBoundedPageSize } from './lib/pagination'
import { organizationActorRateLimitKey, rateLimiter } from './lib/rateLimits'
import { parseWithConvexError } from './lib/validation'

async function collectBetterAuthRows<T extends Record<string, unknown>>(
  ctx: QueryCtx,
  model: string,
  where: { field: string; value: string }[],
): Promise<T[]> {
  const rows: T[] = []
  let cursor: string | null = null
  let isDone = false
  while (!isDone) {
    const result = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model,
      where,
      paginationOpts: { cursor, numItems: 100 },
    })) as unknown as { continueCursor: string; isDone: boolean; page: T[] }
    rows.push(...result.page)
    cursor = result.continueCursor
    isDone = result.isDone
  }
  return rows
}

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return `${slug || 'organization'}-${Date.now().toString(36)}`
}

function memberDto(member: {
  id: string
  organizationId: string
  userId: string
  role: string
  user?: {
    id: string
    email: string
    name: string
    image?: string
  }
  isTeamMember?: boolean
}) {
  if (!isOrganizationRole(member.role)) {
    throw new ConvexError('Member response had an invalid role')
  }

  return {
    id: member.id,
    organizationId: member.organizationId,
    userId: member.userId,
    role: member.role,
    user: member.user,
    isTeamMember: member.isTeamMember ?? false,
  }
}

function invitationDto(invitation: {
  email: string
  role?: string | null
  teamId?: string
  teamName?: string
  status: string
  expiresAt: number
  createdAt: number
}) {
  if (!isInviteRole(invitation.role)) {
    throw new ConvexError('Invitation response had an invalid role')
  }

  return {
    email: invitation.email,
    role: invitation.role,
    teamId: invitation.teamId,
    teamName: invitation.teamName,
    status: invitation.status,
    expiresAt: invitation.expiresAt,
    createdAt: invitation.createdAt,
  }
}

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const authState = await getAuthenticatedSessionOrNull(ctx)
    if (!authState) return []

    const { actor } = authState
    const memberships: { organizationId: string }[] = []
    let cursor: string | null = null
    let isDone = false
    while (!isDone) {
      const page = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'member',
        where: [{ field: 'userId', value: actor.authUserId }],
        paginationOpts: { cursor, numItems: 100 },
      })) as {
        continueCursor: string
        isDone: boolean
        page: { organizationId: string }[]
      }
      memberships.push(...page.page)
      cursor = page.continueCursor
      isDone = page.isDone
    }
    const organizations = (
      await Promise.all(
        memberships.map((membership) =>
          getBetterAuthOrganization(ctx, { organizationId: membership.organizationId }),
        ),
      )
    ).filter((organization) => organization !== null)

    return await Promise.all(
      organizations.map(async (organization) => {
        const member = await getBetterAuthMember(ctx, {
          organizationId: organization.id,
          userId: actor.authUserId,
        })

        return {
          id: organization.id,
          name: organization.name,
          role: isOrganizationRole(member?.role) ? member.role : null,
        }
      }),
    )
  },
})

export const getCapabilities = query({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireAuthenticatedUser(ctx)
    const member = await getBetterAuthMember(ctx, {
      organizationId: args.organizationId,
      userId: actor.authUserId,
    })

    if (!member || !isOrganizationRole(member.role)) {
      throw new ConvexError('User is not an organization member')
    }

    const canManageOrganization = roleAllowsOrganizationPermissions(member.role, {
      organization: ['update'],
    })
    const canManageMembers = roleAllowsOrganizationPermissions(member.role, {
      member: ['create', 'update', 'delete'],
    })
    const canManageTeams = roleAllowsOrganizationPermissions(member.role, {
      team: ['create', 'update'],
    })
    const canCreateProjectPermission = roleAllowsOrganizationPermissions(member.role, {
      project: ['create'],
    })
    const canDeleteProject = roleAllowsOrganizationPermissions(member.role, {
      project: ['delete'],
    })

    return {
      role: member.role,
      canManageOrganization,
      canManageMembers,
      canManageTeams,
      canViewOrgActivity: canViewOrganizationActivity(member.role),
      canCreateProject: canCreateProjectPermission,
      canDeleteProject,
    }
  },
})

export const create = mutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const { auth, headers, actor } = await requireAuthenticatedSession(ctx)
    const input = parseWithConvexError(createOrganizationInputSchema, args)
    await rateLimiter.limit(ctx, 'organizationCreate', {
      key: actor.authUserId,
      throws: true,
    })

    const organization = await auth.api.createOrganization({
      headers,
      body: {
        name: input.name,
        slug: slugify(input.name),
      },
    })

    return {
      id: organization.id,
      name: organization.name,
    }
  },
})

export const rename = mutation({
  args: {
    organizationId: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const { auth, headers } = await requireAuthenticatedSession(ctx)
    const input = parseWithConvexError(renameOrganizationInputSchema, args)

    const organization = await auth.api.updateOrganization({
      headers,
      body: {
        organizationId: input.organizationId,
        data: { name: input.name },
      },
    })
    if (!organization) {
      throw new ConvexError('Organization not found')
    }

    return {
      id: organization.id,
      name: organization.name,
    }
  },
})

export const listTeams = query({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const { actor, member } = await requireOrgMembership(ctx, {
      organizationId: args.organizationId,
    })
    const canManageTeams = roleAllowsOrganizationPermissions(member.role, {
      team: ['create', 'update'],
    })
    const teams = canManageTeams
      ? await collectBetterAuthRows<{ id: string; name: string; organizationId: string }>(
          ctx,
          'team',
          [{ field: 'organizationId', value: args.organizationId }],
        )
      : (
          await Promise.all(
            (
              await collectBetterAuthRows<{ teamId: string }>(ctx, 'teamMember', [
                { field: 'userId', value: actor.authUserId },
              ])
            ).map((teamMember) => getBetterAuthTeam(ctx, { teamId: teamMember.teamId })),
          )
        ).filter((team) => team !== null)

    return teams
      .filter((team) => team.organizationId === args.organizationId)
      .map((team) => ({
        id: team.id,
        name: team.name,
        organizationId: team.organizationId,
      }))
  },
})

export const createTeam = mutation({
  args: {
    organizationId: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const { auth, headers } = await requireAuthenticatedSession(ctx)
    const input = parseWithConvexError(createTeamInputSchema, args)

    const team = await auth.api.createTeam({
      headers,
      body: {
        organizationId: input.organizationId,
        name: input.name,
      },
    })

    return {
      id: team.id,
      name: team.name,
      organizationId: team.organizationId,
    }
  },
})

export const listMembers = query({
  args: {
    organizationId: v.string(),
    teamId: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    requireBoundedPageSize(args.paginationOpts.numItems)
    const { member } = await requireOrgMembership(ctx, {
      organizationId: args.organizationId,
    })
    const allowed = roleAllowsOrganizationPermissions(member.role, {
      member: ['update'],
    })
    if (!allowed) {
      throw new ConvexError('Missing member:update permission')
    }

    if (args.teamId) {
      const team = await getBetterAuthTeam(ctx, { teamId: args.teamId })
      if (team?.organizationId !== args.organizationId) {
        throw new ConvexError('Team not found')
      }
    }

    const members = await listBetterAuthOrganizationMembersPage(ctx, args)
    return {
      ...members,
      page: members.page.map(memberDto),
    }
  },
})

export const listInvitations = query({
  args: {
    organizationId: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    requireBoundedPageSize(args.paginationOpts.numItems)
    const { member } = await requireOrgMembership(ctx, {
      organizationId: args.organizationId,
    })
    const allowed = roleAllowsOrganizationPermissions(member.role, {
      member: ['update'],
    })
    if (!allowed) {
      throw new ConvexError('Missing member:update permission')
    }

    const invitations = await listBetterAuthOrganizationInvitationsPage(
      ctx,
      args.organizationId,
      args.paginationOpts,
    )
    return {
      ...invitations,
      page: invitations.page.map(invitationDto),
    }
  },
})

export const inviteMember = mutation({
  args: {
    organizationId: v.string(),
    email: v.string(),
    role: v.string(),
    teamId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { auth, headers, actor } = await requireAuthenticatedSession(ctx)
    const input = parseWithConvexError(inviteMemberInputSchema, {
      ...args,
      teamId: args.teamId?.trim() || undefined,
    })
    await rateLimiter.limit(ctx, 'inviteMember', {
      key: organizationActorRateLimitKey(input.organizationId, actor.authUserId),
      throws: true,
    })

    await auth.api.createInvitation({
      headers,
      body: {
        organizationId: input.organizationId,
        email: input.email,
        role: input.role,
        ...(input.teamId ? { teamId: input.teamId } : {}),
      },
    })

    return { ok: true }
  },
})

export const cancelInvitation = mutation({
  args: {
    organizationId: v.string(),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const { auth, headers } = await requireAuthenticatedSession(ctx)
    const input = parseWithConvexError(cancelInvitationInputSchema, args)
    await requireOrgMembership(ctx, { organizationId: input.organizationId })
    const allowed = await hasOrganizationPermissions(auth, headers, input.organizationId, {
      member: ['update'],
    })
    if (!allowed) {
      throw new ConvexError('Missing member:update permission')
    }
    const invitation = await getBetterAuthPendingInvitationByEmail(ctx, {
      organizationId: input.organizationId,
      email: input.email,
    })

    if (!invitation) {
      return { ok: true }
    }

    const invitationId = invitation.id
    if (!invitationId) {
      throw new ConvexError('Invitation row is missing an id')
    }

    await auth.api.cancelInvitation({
      headers,
      body: {
        invitationId,
      },
    })

    return { ok: true }
  },
})

export const changeMemberRole = mutation({
  args: {
    organizationId: v.string(),
    memberId: v.string(),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    const { auth, headers } = await requireAuthenticatedSession(ctx)
    const input = parseWithConvexError(changeMemberRoleInputSchema, args)

    const result = await auth.api.updateMemberRole({
      headers,
      body: {
        organizationId: input.organizationId,
        memberId: input.memberId,
        role: input.role,
      },
    })

    return memberDto(result)
  },
})

export const removeMember = mutation({
  args: {
    organizationId: v.string(),
    memberId: v.string(),
  },
  handler: async (ctx, args) => {
    const { auth, headers } = await requireAuthenticatedSession(ctx)
    const input = parseWithConvexError(removeMemberInputSchema, args)
    await auth.api.removeMember({
      headers,
      body: {
        organizationId: input.organizationId,
        memberIdOrEmail: input.memberId,
      },
    })
    return { ok: true }
  },
})
