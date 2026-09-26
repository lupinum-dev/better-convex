import {
  createBetterConvexAuth,
  createUserProjectionTriggers,
  requireAuthOrigin,
  type AuthFunctions,
  type BetterAuthUserProjectionSource,
  type BetterConvexAuthEmail,
} from '@lupinum/better-convex-nuxt/better-auth/server'
import { v } from 'convex/values'

import { components, internal } from './_generated/api'
import type { DataModel, Doc } from './_generated/dataModel'
import { internalMutation } from './_generated/server'
import { createTeamOrganizationOptions } from './betterAuth/schemaPlugins'
import { escapeEmailHtml, sendStarterEmail } from './lib/authEmail'

const authFunctions: AuthFunctions = internal.auth

type BetterAuthUserPage = {
  page: BetterAuthUserProjectionSource[]
  continueCursor: string
  isDone: boolean
}

function invitationLink(siteUrl: string, invitationId: string) {
  return `${siteUrl.replace(/\/+$/, '')}/invitations/${encodeURIComponent(invitationId)}`
}

async function deliverInvitationEmail(
  siteUrl: string,
  message: Extract<BetterConvexAuthEmail, { type: 'organization-invitation' }>,
) {
  const link = invitationLink(siteUrl, message.invitationId)
  const inviterName = message.inviter.name.trim() || message.inviter.email
  const escapedInviterName = escapeEmailHtml(inviterName)
  const escapedOrganizationName = escapeEmailHtml(message.organization.name)
  const escapedLink = escapeEmailHtml(link)
  await sendStarterEmail({
    recipient: message.to,
    siteUrl,
    fallbackLabel: 'Invitation link',
    fallbackUrl: link,
    content: {
      subject: `${inviterName} invited you to join ${message.organization.name}`,
      text: [
        `${inviterName} invited you to join ${message.organization.name}.`,
        '',
        `Accept the invitation: ${link}`,
      ].join('\n'),
      html: `<p>${escapedInviterName} invited you to join <strong>${escapedOrganizationName}</strong>.</p><p><a href="${escapedLink}">Accept the invitation</a></p>`,
    },
  })
}

async function deliverVerificationEmail(
  siteUrl: string,
  message: Extract<BetterConvexAuthEmail, { type: 'verify-email' }>,
) {
  const escapedUrl = escapeEmailHtml(message.url)
  await sendStarterEmail({
    recipient: message.to,
    siteUrl,
    fallbackLabel: 'Verification link',
    fallbackUrl: message.url,
    content: {
      subject: 'Verify your email address',
      text: `Click the link to verify your email: ${message.url}`,
      html: `<p><a href="${escapedUrl}">Verify your email address</a></p>`,
    },
  })
}

function userProjectionFields(user: BetterAuthUserProjectionSource) {
  return {
    name: user.name ?? undefined,
    email: user.email ?? undefined,
    image: user.image ?? undefined,
  }
}

function userProjectionPatch(
  user: BetterAuthUserProjectionSource,
  existing: Doc<'users'>,
  now: number,
) {
  const fields = userProjectionFields(user)
  if (
    fields.name === existing.name &&
    fields.email === existing.email &&
    fields.image === existing.image
  ) {
    return null
  }

  return { ...fields, updatedAt: now }
}

const userProjection = createUserProjectionTriggers<BetterAuthUserProjectionSource, Doc<'users'>>({
  table: 'users',
  index: 'by_auth_user_id',
  authIdField: 'authUserId',
  createDoc: ({ user, now }) => ({
    authUserId: user.id,
    ...userProjectionFields(user),
    createdAt: now,
    updatedAt: now,
  }),
  patchDoc: ({ user, existing, now }) => userProjectionPatch(user, existing, now),
  rebuildDoc: ({ user, existing, now }) => userProjectionPatch(user, existing, now),
})

export const auth = createBetterConvexAuth<DataModel>(components.betterAuth, {
  authFunctions,
  triggers: {
    user: {
      onCreate: async (ctx, user) =>
        userProjection.user.onCreate(ctx, user as BetterAuthUserProjectionSource),
      onUpdate: async (ctx, user, previousUser) =>
        userProjection.user.onUpdate(
          ctx,
          user as BetterAuthUserProjectionSource,
          previousUser as BetterAuthUserProjectionSource,
        ),
      onDelete: async (ctx, user) =>
        userProjection.user.onDelete(ctx, user as BetterAuthUserProjectionSource),
    },
  },
  email: async (_ctx, message) => {
    const siteUrl = requireAuthOrigin('SITE_URL')
    switch (message.type) {
      case 'verify-email':
        return await deliverVerificationEmail(siteUrl, message)
      case 'organization-invitation':
        return await deliverInvitationEmail(siteUrl, message)
      default:
        // Password reset and one-time codes are not enabled, so no other type
        // is emitted. Better Auth only logs a rejected send; it never fails
        // the request, so an unexpected type must not be relied on to block it.
        throw new Error(`The team starter does not send ${message.type} email`)
    }
  },
  emailAndPassword: { requireEmailVerification: true },
  emailVerification: {
    autoSignInAfterVerification: true,
    sendOnSignIn: true,
    sendOnSignUp: true,
  },
  organization: createTeamOrganizationOptions(),
})

export const { createAuth } = auth

// Pre-traffic operator ceremony: provision/rotate the one official JWT key graph.
// Schedule pruneSigningKeys to delete retired keys after the verification grace.
export const { ensureSigningKey, pruneSigningKeys, rotateSigningKey } = auth.jwksOperatorFunctions()

export type AppAuth = Awaited<ReturnType<typeof createAuth>>

export const { onCreate, onUpdate, onDelete } = auth.triggerFunctions()

/** Reconcile one bounded page of the display-only user projection. */
export const rebuildUserProjectionBatch = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const users = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'user',
      paginationOpts: { cursor: args.cursor, numItems: 100 },
    })) as BetterAuthUserPage
    const result = await userProjection.user.rebuild(ctx, users.page)

    return {
      ...result,
      continueCursor: users.continueCursor,
      isDone: users.isDone,
    }
  },
})
