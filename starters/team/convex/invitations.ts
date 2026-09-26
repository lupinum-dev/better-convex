import { ConvexError, v } from 'convex/values'

import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server'
import { auth } from './auth'
import { requireAuthenticatedSession } from './lib/authz'
import {
  getBetterAuthInvitation,
  getBetterAuthOrganization,
  getBetterAuthTeam,
} from './lib/betterAuthRows'

function normalizeEmail(email: string | null | undefined) {
  return email?.trim().toLowerCase() ?? ''
}

async function loadInvitationForUser(ctx: QueryCtx | MutationCtx, invitationId: string) {
  const user = await auth.requireUser(ctx)
  const sessionEmail = normalizeEmail(user.email)
  if (!sessionEmail) {
    throw new ConvexError('Authenticated session is missing an email address')
  }
  if (user.emailVerified !== true) {
    throw new ConvexError('Verify your email before using invitation links')
  }

  const invitation = await getBetterAuthInvitation(ctx, { invitationId })
  if (!invitation || normalizeEmail(invitation.email) !== sessionEmail) {
    throw new ConvexError('Invitation is unavailable')
  }

  return { user, invitation }
}

export const get = query({
  args: {
    invitationId: v.string(),
  },
  handler: async (ctx, args) => {
    const { invitation } = await loadInvitationForUser(ctx, args.invitationId)
    const [organization, team] = await Promise.all([
      getBetterAuthOrganization(ctx, { organizationId: invitation.organizationId }),
      invitation.teamId ? getBetterAuthTeam(ctx, { teamId: invitation.teamId }) : null,
    ])

    return {
      id: invitation.id,
      organizationId: invitation.organizationId,
      organizationName: organization?.name ?? 'Organization',
      email: invitation.email,
      role: invitation.role ?? 'member',
      teamId: invitation.teamId ?? undefined,
      teamName: team?.name,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    }
  },
})

export const accept = mutation({
  args: {
    invitationId: v.string(),
  },
  handler: async (ctx, args) => {
    const { invitation } = await loadInvitationForUser(ctx, args.invitationId)
    const { auth, headers } = await requireAuthenticatedSession(ctx)
    if (invitation.status !== 'pending') {
      throw new ConvexError('Invitation is no longer pending')
    }

    await auth.api.acceptInvitation({
      headers,
      body: {
        invitationId: args.invitationId,
      },
    })

    return {
      ok: true,
      organizationId: invitation.organizationId,
    }
  },
})

export const reject = mutation({
  args: {
    invitationId: v.string(),
  },
  handler: async (ctx, args) => {
    const { invitation } = await loadInvitationForUser(ctx, args.invitationId)
    const { auth, headers } = await requireAuthenticatedSession(ctx)
    if (invitation.status !== 'pending') {
      throw new ConvexError('Invitation is no longer pending')
    }

    await auth.api.rejectInvitation({
      headers,
      body: {
        invitationId: args.invitationId,
      },
    })

    return { ok: true }
  },
})
