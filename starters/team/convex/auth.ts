import {
  createBetterConvexAuth,
  createUserProjectionTriggers,
  requireAuthOrigin,
  type AuthFunctions,
  type BetterAuthUserProjectionSource,
} from '@lupinum/better-convex-nuxt/better-auth/server'
import { v } from 'convex/values'

import { components, internal } from './_generated/api'
import type { DataModel, Doc } from './_generated/dataModel'
import { internalMutation } from './_generated/server'
import { createTeamOrganizationOptions } from './betterAuth/schemaPlugins'
import { escapeEmailHtml, sendStarterEmail } from './lib/authEmail'

const authFunctions: AuthFunctions = internal.auth

type InvitationEmailData = {
  id: string
  email: string
  organization: {
    name: string
  }
  inviter: {
    user: {
      name?: string | null
      email: string
    }
  }
}

type VerificationEmailData = {
  url: string
  user: {
    email: string
  }
}

type BetterAuthUserPage = {
  page: BetterAuthUserProjectionSource[]
  continueCursor: string
  isDone: boolean
}

function invitationLink(siteUrl: string, invitationId: string) {
  return `${siteUrl.replace(/\/+$/, '')}/invitations/${encodeURIComponent(invitationId)}`
}

async function sendInvitationEmail(siteUrl: string, data: InvitationEmailData) {
  const link = invitationLink(siteUrl, data.id)
  const inviterName = data.inviter.user.name?.trim() || data.inviter.user.email
  const escapedInviterName = escapeEmailHtml(inviterName)
  const escapedOrganizationName = escapeEmailHtml(data.organization.name)
  const escapedLink = escapeEmailHtml(link)
  await sendStarterEmail({
    recipient: data.email,
    siteUrl,
    fallbackLabel: 'Invitation link',
    fallbackUrl: link,
    content: {
      subject: `${inviterName} invited you to join ${data.organization.name}`,
      text: [
        `${inviterName} invited you to join ${data.organization.name}.`,
        '',
        `Accept the invitation: ${link}`,
      ].join('\n'),
      html: `<p>${escapedInviterName} invited you to join <strong>${escapedOrganizationName}</strong>.</p><p><a href="${escapedLink}">Accept the invitation</a></p>`,
    },
  })
}

async function sendVerificationEmail(siteUrl: string, data: VerificationEmailData) {
  const escapedUrl = escapeEmailHtml(data.url)
  await sendStarterEmail({
    recipient: data.user.email,
    siteUrl,
    fallbackLabel: 'Verification link',
    fallbackUrl: data.url,
    content: {
      subject: 'Verify your email address',
      text: `Click the link to verify your email: ${data.url}`,
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

export const betterConvexAuth = createBetterConvexAuth<DataModel>(components.betterAuth, {
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
  defineSessionClaims: ({ user }) => ({
    email: user.email,
    emailVerified: user.emailVerified,
    image: user.image ?? undefined,
    name: user.name,
  }),
  emailAndPassword: { requireEmailVerification: true },
  emailVerification: {
    autoSignInAfterVerification: true,
    sendOnSignIn: true,
    sendOnSignUp: true,
    async sendVerificationEmail(data) {
      await sendVerificationEmail(requireAuthOrigin('SITE_URL'), data as VerificationEmailData)
    },
  },
  organization: createTeamOrganizationOptions({
    async sendInvitationEmail(data) {
      await sendInvitationEmail(requireAuthOrigin('SITE_URL'), data as InvitationEmailData)
    },
  }),
})

export const { authComponent, createAuth } = betterConvexAuth

// Pre-traffic operator ceremony: provision/rotate the one official JWT key graph.
export const { rotateSigningKey } = betterConvexAuth.jwksOperatorFunctions()

export type AppAuth = Awaited<ReturnType<typeof createAuth>>

export const { onCreate, onUpdate, onDelete } = betterConvexAuth.triggerFunctions()

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
