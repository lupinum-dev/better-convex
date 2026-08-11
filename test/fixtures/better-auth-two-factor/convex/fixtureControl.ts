import { actionGeneric, makeFunctionReference } from 'convex/server'
import { v } from 'convex/values'

import { components } from './_generated/api'

const rotateSigningKey = makeFunctionReference<'action', Record<string, never>, { newKid: string }>(
  'auth:rotateSigningKey',
)

function assertFixtureProof(proof: string): void {
  const expected = process.env.BCN_AUTH_PROXY_IP_SECRET
  if (!expected || proof !== expected) throw new Error('MFA_FIXTURE_CONTROL_DENIED')
}

export const provisionSigningKey = actionGeneric({
  args: { proof: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ activeKeyCount: number; kid: string; totalKeyCount: number }> => {
    assertFixtureProof(args.proof)
    const before = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'jwks',
      paginationOpts: { cursor: null, numItems: 2 },
    })
    if (before.page.length !== 0) throw new Error('MFA_FIXTURE_SIGNING_KEY_ALREADY_PROVISIONED')

    const provisioned = await ctx.runAction(rotateSigningKey, {})
    const after = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'jwks',
      paginationOpts: { cursor: null, numItems: 2 },
    })
    const active = after.page.filter((row: Record<string, unknown>) => row.expiresAt === null)
    if (after.page.length !== 1 || active.length !== 1 || active[0]?.id !== provisioned.newKid) {
      throw new Error('MFA_FIXTURE_SIGNING_KEY_PROVISIONING_INVALID')
    }
    return { activeKeyCount: 1, kid: provisioned.newKid, totalKeyCount: 1 }
  },
})

/**
 * Test-only persisted-state fault controls. These run only in the dedicated
 * local fixture and call the same component functions used by Better Auth.
 */
export const mutatePersistedSession = actionGeneric({
  args: {
    operation: v.union(v.literal('delete'), v.literal('expire'), v.literal('mismatch')),
    proof: v.string(),
    token: v.string(),
  },
  handler: async (ctx, args): Promise<boolean> => {
    assertFixtureProof(args.proof)

    if (args.operation === 'delete') {
      const deleted = await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
        model: 'session',
        where: [{ field: 'token', value: args.token }],
      })
      return deleted !== null
    }

    const update =
      args.operation === 'expire'
        ? { expiresAt: Date.now() - 60_000 }
        : { token: `mismatched-${crypto.randomUUID()}` }
    const updated = await ctx.runMutation(components.betterAuth.adapter.updateOne, {
      model: 'session',
      update,
      where: [{ field: 'token', value: args.token }],
    })
    return updated !== null
  },
})

export const readTwoFactorState = actionGeneric({
  args: { proof: v.string(), userId: v.string() },
  handler: async (ctx, args): Promise<{ failedVerificationCount: number; lockedUntil: number }> => {
    assertFixtureProof(args.proof)
    const row = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: 'twoFactor',
      where: [{ field: 'userId', value: args.userId }],
    })) as Record<string, unknown> | null
    if (!row) throw new Error('MFA_FIXTURE_TWO_FACTOR_ROW_MISSING')

    const failedVerificationCount = row.failedVerificationCount
    const lockedUntil = row.lockedUntil
    if (typeof failedVerificationCount !== 'number' || typeof lockedUntil !== 'number') {
      throw new TypeError('MFA_FIXTURE_TWO_FACTOR_STATE_INVALID')
    }
    return { failedVerificationCount, lockedUntil }
  },
})
