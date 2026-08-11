import { ConvexError } from 'convex/values'

import { canAccessAllTeams, canViewOrganizationActivity } from '../../shared/organizationRoles'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { authComponent, createAuth, type AppAuth } from '../auth'
import { roleAllowsOrganizationPermissions } from '../betterAuth/schemaPlugins'
import { getBetterAuthMember, getBetterAuthTeam, getBetterAuthTeamMember } from './betterAuthRows'

export type ProjectPermission = 'create' | 'read' | 'update' | 'delete'

type Ctx = QueryCtx | MutationCtx

type AccessActor = {
  kind: 'user'
  authUserId: string
}

export type TeamAccess = {
  actor: AccessActor
  organizationId: string
  teamId: string
}

export type ProjectAccess = TeamAccess & {
  project: Doc<'projects'>
}

export async function getAppAuth(ctx: MutationCtx) {
  return await authComponent.getAuth(createAuth, ctx)
}

export async function getAuthenticatedUserOrNull(ctx: Ctx) {
  const user = await authComponent.safeGetAuthUser(ctx)
  if (!user || typeof user.id !== 'string') return null
  const actor = {
    kind: 'user' as const,
    authUserId: user.id,
  }
  return { actor, user: user as { id: string } & Record<string, unknown> }
}

export async function getAuthenticatedSessionOrNull(ctx: Ctx) {
  const authenticated = await getAuthenticatedUserOrNull(ctx)
  return authenticated ? { ...authenticated, session: { user: authenticated.user } } : null
}

export async function requireAuthenticatedSession(ctx: MutationCtx) {
  const authenticated = await getAuthenticatedUserOrNull(ctx)
  if (!authenticated) throw new ConvexError('Unauthenticated')
  const { auth, headers } = await getAppAuth(ctx)

  return {
    ...authenticated,
    auth,
    headers,
    session: { user: authenticated.user },
  }
}

export async function requireAuthenticatedUser(ctx: Ctx): Promise<AccessActor> {
  const authenticated = await getAuthenticatedUserOrNull(ctx)
  if (!authenticated) throw new ConvexError('Unauthenticated')
  const { actor } = authenticated
  return actor
}

export async function hasOrganizationPermissions(
  auth: AppAuth,
  headers: Headers,
  organizationId: string,
  permissions: Record<string, ('create' | 'read' | 'update' | 'delete')[]>,
) {
  const allowed = await auth.api.hasPermission({
    headers,
    body: {
      organizationId,
      permissions,
    },
  })

  return allowed.success
}

export async function requireOrgPermission(
  ctx: Ctx,
  args: {
    organizationId: string
    permission: ProjectPermission
  },
) {
  const actor = await requireAuthenticatedUser(ctx)
  const member = await getBetterAuthMember(ctx, {
    organizationId: args.organizationId,
    userId: actor.authUserId,
  })
  const allowed = Boolean(
    member && roleAllowsOrganizationPermissions(member.role, { project: [args.permission] }),
  )

  if (!allowed) {
    throw new ConvexError(`Missing project:${args.permission} permission`)
  }

  return {
    actor,
    userId: actor.authUserId,
  }
}

export async function requireOrgMembership(
  ctx: Ctx,
  args: {
    organizationId: string
  },
) {
  const actor = await requireAuthenticatedUser(ctx)
  const member = await getBetterAuthMember(ctx, {
    organizationId: args.organizationId,
    userId: actor.authUserId,
  })

  if (!member) {
    throw new ConvexError('User is not an organization member')
  }

  return { actor, member }
}

export async function requireOrganizationActivityAccess(
  ctx: Ctx,
  args: {
    organizationId: string
  },
) {
  const membership = await requireOrgMembership(ctx, args)
  if (!canViewOrganizationActivity(membership.member.role)) {
    throw new ConvexError('Missing organization activity permission')
  }

  return membership
}

export async function requireTeamAccess(
  ctx: Ctx,
  args: {
    organizationId: string
    teamId: string
    authUserId: string
  },
) {
  const team = await getBetterAuthTeam(ctx, {
    teamId: args.teamId,
    organizationId: args.organizationId,
  })

  if (!team) {
    throw new ConvexError('Team does not belong to organization')
  }

  const member = await getBetterAuthMember(ctx, {
    organizationId: args.organizationId,
    userId: args.authUserId,
  })

  if (!member) {
    throw new ConvexError('User is not an organization member')
  }

  if (canAccessAllTeams(member.role)) {
    return
  }

  const teamMember = await getBetterAuthTeamMember(ctx, {
    teamId: args.teamId,
    userId: args.authUserId,
  })

  if (!teamMember) {
    throw new ConvexError('User is not a member of the team')
  }
}

export async function requireProjectTeamAccess(
  ctx: Ctx,
  args: {
    teamId: string
    permission: ProjectPermission
  },
): Promise<TeamAccess> {
  const team = await getBetterAuthTeam(ctx, {
    teamId: args.teamId,
  })

  if (!team?.organizationId) {
    throw new ConvexError('Team not found')
  }

  const { actor } = await requireOrgPermission(ctx, {
    organizationId: team.organizationId,
    permission: args.permission,
  })

  await requireTeamAccess(ctx, {
    organizationId: team.organizationId,
    teamId: args.teamId,
    authUserId: actor.authUserId,
  })

  return {
    actor,
    organizationId: team.organizationId,
    teamId: args.teamId,
  }
}

export async function requireProjectAccessById(
  ctx: Ctx,
  args: {
    projectId: Id<'projects'>
    permission: ProjectPermission
  },
): Promise<ProjectAccess> {
  const project = await ctx.db.get(args.projectId)
  if (!project) {
    throw new ConvexError('Project not found')
  }

  const { actor } = await requireOrgPermission(ctx, {
    organizationId: project.organizationId,
    permission: args.permission,
  })

  await requireTeamAccess(ctx, {
    organizationId: project.organizationId,
    teamId: project.teamId,
    authUserId: actor.authUserId,
  })

  return {
    actor,
    organizationId: project.organizationId,
    teamId: project.teamId,
    project,
  }
}
