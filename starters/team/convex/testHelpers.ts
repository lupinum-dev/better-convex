import type { UserIdentity } from 'convex/server'

import { components } from './_generated/api'
import { createAuth } from './auth'
import type { initConvexTest } from './test.setup'

export const now = 1_700_000_000_000
export const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000

type Role = 'owner' | 'admin' | 'member' | 'viewer'

export function readRateLimitError(error: unknown) {
  if (!error || typeof error !== 'object' || !('data' in error)) {
    return null
  }

  let data = error.data
  while (typeof data === 'string') {
    data = JSON.parse(data)
  }

  if (!data || typeof data !== 'object' || !('kind' in data) || data.kind !== 'RateLimited') {
    return null
  }

  return data
}

export async function seedBetterAuthOrganization(
  t: ReturnType<typeof initConvexTest>,
  args: {
    name: string
  },
) {
  return await t.run(async (ctx) => {
    const organization = (await ctx.runMutation(components.betterAuth.adapter.create, {
      model: 'organization',
      data: {
        id: `organization_${args.name}`,
        name: args.name,
        slug: args.name,
        createdAt: now,
      },
    })) as { id: string }

    return organization.id
  })
}

export async function seedBetterAuthActor(
  t: ReturnType<typeof initConvexTest>,
  args: {
    label: string
    organizationId: string
    role: Role
    teamIds?: string[]
  },
) {
  const user = await signUpBetterAuthUser(t, { label: args.label })

  await t.run(async (ctx) => {
    await ctx.runMutation(components.betterAuth.adapter.create, {
      model: 'member',
      data: {
        id: `member_${args.organizationId}_${user.authUserId}`,
        organizationId: args.organizationId,
        userId: user.authUserId,
        role: args.role,
        createdAt: now,
      },
    })

    for (const teamId of args.teamIds ?? []) {
      await ctx.runMutation(components.betterAuth.adapter.create, {
        model: 'teamMember',
        data: {
          id: `team-member_${teamId}_${user.authUserId}`,
          teamId,
          userId: user.authUserId,
          createdAt: now,
        },
      })
    }
  })

  return {
    authUserId: user.authUserId,
    sessionId: user.sessionId,
  }
}

export async function signUpBetterAuthUser(
  t: ReturnType<typeof initConvexTest>,
  args: {
    label: string
  },
) {
  return await t.run(async (ctx) => {
    const auth = await createAuth(ctx)
    const email = `${args.label}@example.com`
    const password = 'Password123456!'
    const verificationPrefix = `[team-starter] Verification link ${email}: `
    let verificationUrl: string | null = null
    const originalConsoleInfo = console.info
    console.info = (...values: unknown[]) => {
      const message = values.map(String).join(' ')
      if (message.startsWith(verificationPrefix)) {
        verificationUrl = message.slice(verificationPrefix.length)
      }
    }

    let signedUp: Awaited<ReturnType<typeof auth.api.signUpEmail>>
    try {
      signedUp = await auth.api.signUpEmail({
        body: {
          email,
          password,
          name: args.label,
        },
      })
    } finally {
      console.info = originalConsoleInfo
    }

    if (!verificationUrl) {
      throw new Error('Better Auth signup did not emit a local verification link')
    }
    const verificationToken = new URL(verificationUrl).searchParams.get('token')
    if (!verificationToken) {
      throw new Error('Better Auth verification link did not contain a token')
    }
    await auth.api.verifyEmail({
      query: { token: verificationToken },
    })

    const signedIn = await auth.api.signInEmail({
      body: { email, password },
    })
    const session = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: 'session',
      where: [{ field: 'token', value: signedIn.token }],
    })) as { id: string } | null
    if (!session) {
      throw new Error('Better Auth session row was not created')
    }

    return {
      authUserId: signedUp.user.id,
      sessionId: session.id,
      token: signedIn.token,
    }
  })
}

export async function seedBetterAuthTeam(
  t: ReturnType<typeof initConvexTest>,
  args: {
    organizationId: string
    teamId: string
    name?: string
  },
) {
  return await t.run(async (ctx) => {
    const team = (await ctx.runMutation(components.betterAuth.adapter.create, {
      model: 'team',
      data: {
        id: args.teamId,
        name: args.name ?? args.teamId,
        memberCount: 0,
        organizationId: args.organizationId,
        createdAt: now,
        updatedAt: now,
      },
    })) as { id: string }

    return team.id
  })
}

export function asActor(
  t: ReturnType<typeof initConvexTest>,
  args: {
    userId: string
    sessionId: string
  },
) {
  return t.withIdentity({
    issuer: 'http://localhost:3210',
    sid: args.sessionId,
    subject: args.userId,
    token_use: 'convex-session',
  } as Partial<UserIdentity>)
}
