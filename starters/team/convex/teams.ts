import { ConvexError, v } from 'convex/values'

import { renameTeamInputSchema, teamMembershipInputSchema } from '../shared/inputSchemas'
import { query, mutation } from './_generated/server'
import { roleAllowsOrganizationPermissions } from './betterAuth/schemaPlugins'
import {
  requireAuthenticatedSession,
  requireAuthenticatedUser,
  requireOrgMembership,
  requireTeamAccess,
} from './lib/authz'
import { getBetterAuthTeam } from './lib/betterAuthRows'
import { parseWithConvexError } from './lib/validation'

export const getCapabilities = query({
  args: {
    teamId: v.string(),
  },
  handler: async (ctx, args) => {
    const team = await getBetterAuthTeam(ctx, { teamId: args.teamId })
    if (!team?.organizationId) {
      throw new ConvexError('Team not found')
    }

    const actor = await requireAuthenticatedUser(ctx)
    const { member } = await requireOrgMembership(ctx, {
      organizationId: team.organizationId,
    })

    const canViewProjects = roleAllowsOrganizationPermissions(member.role, {
      project: ['read'],
    })
    const canCreateProjectPermission = roleAllowsOrganizationPermissions(member.role, {
      project: ['create'],
    })
    const canUpdateProject = roleAllowsOrganizationPermissions(member.role, {
      project: ['update'],
    })
    const canDeleteProject = roleAllowsOrganizationPermissions(member.role, {
      project: ['delete'],
    })

    if (canViewProjects || canCreateProjectPermission || canUpdateProject || canDeleteProject) {
      await requireTeamAccess(ctx, {
        organizationId: team.organizationId,
        teamId: args.teamId,
        authUserId: actor.authUserId,
      })
    }

    return {
      organizationId: team.organizationId,
      teamId: args.teamId,
      canViewProjects,
      canCreateProject: canCreateProjectPermission,
      canUpdateProject,
      canDeleteProject,
    }
  },
})

export const rename = mutation({
  args: {
    teamId: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const { auth, headers } = await requireAuthenticatedSession(ctx)
    const input = parseWithConvexError(renameTeamInputSchema, args)

    const existingTeam = await getBetterAuthTeam(ctx, { teamId: input.teamId })
    if (!existingTeam?.organizationId) {
      throw new ConvexError('Team not found')
    }

    const team = await auth.api.updateTeam({
      headers,
      body: {
        teamId: input.teamId,
        data: {
          name: input.name,
          organizationId: existingTeam.organizationId,
        },
      },
    })
    if (!team) {
      throw new ConvexError('Team not found')
    }

    return {
      id: team.id,
      name: team.name,
      organizationId: team.organizationId,
    }
  },
})

export const addMember = mutation({
  args: {
    teamId: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const input = parseWithConvexError(teamMembershipInputSchema, args)
    const team = await getBetterAuthTeam(ctx, { teamId: args.teamId })
    if (!team?.organizationId) {
      throw new ConvexError('Team not found')
    }

    const { auth, headers } = await requireAuthenticatedSession(ctx)
    const result = await auth.api.addTeamMember({
      headers,
      body: {
        organizationId: team.organizationId,
        teamId: input.teamId,
        userId: input.userId,
      },
    })

    return result.userId
  },
})

export const removeMember = mutation({
  args: {
    teamId: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const input = parseWithConvexError(teamMembershipInputSchema, args)
    const team = await getBetterAuthTeam(ctx, { teamId: args.teamId })
    if (!team?.organizationId) {
      throw new ConvexError('Team not found')
    }

    const { auth, headers } = await requireAuthenticatedSession(ctx)
    await auth.api.removeTeamMember({
      headers,
      body: {
        organizationId: team.organizationId,
        teamId: input.teamId,
        userId: input.userId,
      },
    })

    return { ok: true }
  },
})
