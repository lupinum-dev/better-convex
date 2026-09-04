/// <reference types="vite/client" />

import { convexTest } from 'convex-test'
import { anyApi, type ApiFromModules } from 'convex/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { workforceSessionPolicy } from '../../src/runtime/convex-auth/workforce/operations'
import type * as adapter from '../fixtures/workforce-component/convex/betterAuth/adapter'
import schema from '../fixtures/workforce-component/convex/betterAuth/schema'

const modules = import.meta.glob('../fixtures/workforce-component/convex/betterAuth/**/*.ts')
const api = anyApi as unknown as ApiFromModules<{ adapter: typeof adapter }>
const auth = api.adapter
const now = 1_700_000_000_000
const minute = 60_000
const actor = { userId: 'user', sessionId: 'session' }
const workforce = { operation: 'password-sign-in', userId: 'user', expectedGeneration: 0 } as const
const data = {
  id: actor.sessionId,
  userId: actor.userId,
  token: 'synthetic-scheduler-session',
  createdAt: now,
  updatedAt: now,
  expiresAt: now + workforceSessionPolicy.absoluteLifetimeMs,
  bcnAssuranceGeneration: 0,
  bcnAssuranceMethod: 'none',
  bcnAuthenticatedAt: now,
  bcnSessionStartedAt: now,
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(now)
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

async function init() {
  const test = convexTest(schema, modules)
  await test.run((ctx) =>
    ctx.db.insert('user', {
      id: actor.userId,
      name: 'Synthetic user',
      email: 'user@example.test',
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
      twoFactorEnabled: true,
      bcnSecurityGeneration: 0,
    }),
  )
  return test
}
type Test = Awaited<ReturnType<typeof init>>

async function session(test: Test) {
  return test.run((ctx) =>
    ctx.db
      .query('session')
      .withIndex('id', (query) => query.eq('id', actor.sessionId))
      .unique(),
  )
}
async function jobs(test: Test) {
  return test.run((ctx) => ctx.db.system.query('_scheduled_functions').take(20))
}
async function advance(test: Test, elapsed: number) {
  vi.advanceTimersByTime(elapsed)
  await test.finishInProgressScheduledFunctions()
}

describe('canonical workforce session expiry scheduler', () => {
  it.each(['updateOne', 'updateMany', 'incrementOne'] as const)(
    'rejects generic shortening through %s so the only chain cannot become late',
    async (kind) => {
      const test = await init()
      await test.mutation(auth.create, { model: 'session', data, workforce })
      const before = await session(test)
      const scheduled = await jobs(test)
      const args = { model: 'session', where: [{ field: 'id', value: actor.sessionId }] }
      await expect(
        kind === 'incrementOne'
          ? test.mutation(auth.incrementOne, {
              ...args,
              increment: {},
              set: { expiresAt: now + minute },
            })
          : test.mutation(auth[kind], { ...args, update: { expiresAt: now + minute } }),
      ).rejects.toThrow('AUTH_WORKFORCE_SESSION_LIFETIME_OWNED')
      expect(await session(test)).toEqual(before)
      expect(await jobs(test)).toEqual(scheduled)
    },
  )

  it('schedules one physical-row job and deletes the session at its initial idle deadline', async () => {
    const test = await init()
    await test.mutation(auth.create, { model: 'session', data, workforce })
    const created = await session(test)
    expect(created).not.toBeNull()
    expect(await jobs(test)).toMatchObject([
      {
        name: 'adapter:expireWorkforceSession',
        args: [{ storageId: created?._id }],
        scheduledTime: now + workforceSessionPolicy.idleTimeoutMs,
        state: { kind: 'pending' },
      },
    ])
    await advance(test, workforceSessionPolicy.idleTimeoutMs - 1)
    expect(await session(test)).not.toBeNull()
    await advance(test, 1)
    expect(await session(test)).toBeNull()
    expect((await jobs(test)).map((job) => job.state.kind)).toEqual(['success'])
  })

  it('touch creates no job; the existing chain follows the current deadline once', async () => {
    const test = await init()
    await test.mutation(auth.create, { model: 'session', data, workforce })
    const created = await session(test)
    if (!created) throw new Error('TEST_SESSION_REQUIRED')
    // Explicit fixture state: admission proof is tested by the transition suite.
    await test.run((ctx) =>
      ctx.db.patch('session', created._id, { bcnAssuranceMethod: 'password-totp' }),
    )
    await advance(test, 10 * minute)
    expect(await test.mutation(auth.touchWorkforceSession, { actor })).toEqual({
      expiresAt: now + 70 * minute,
    })
    expect(await jobs(test)).toHaveLength(1)
    await advance(test, 50 * minute)
    expect(await session(test)).not.toBeNull()
    const continued = await jobs(test)
    expect(continued).toHaveLength(2)
    expect(continued.filter((job) => job.state.kind === 'pending')).toMatchObject([
      {
        args: [{ storageId: created._id }],
        scheduledTime: now + 70 * minute,
      },
    ])
    await advance(test, 10 * minute)
    expect(await session(test)).toBeNull()
    expect((await jobs(test)).filter((job) => job.state.kind === 'pending')).toEqual([])
  })

  it('rolls back the inserted session and scheduled job together', async () => {
    const test = await init()
    await expect(
      test.mutation(async (ctx) => {
        await ctx.runMutation(auth.create, { model: 'session', data, workforce })
        throw new Error('TEST_SESSION_INSERT_ROLLBACK')
      }),
    ).rejects.toThrow('TEST_SESSION_INSERT_ROLLBACK')
    expect(await session(test)).toBeNull()
    expect(await jobs(test)).toEqual([])
    await advance(test, workforceSessionPolicy.idleTimeoutMs)
    expect(await jobs(test)).toEqual([])
  })

  it('does not let an old physical-row job delete a replacement with the same logical ID', async () => {
    const test = await init()
    await test.mutation(auth.create, { model: 'session', data, workforce })
    const old = await session(test)
    await test.mutation(auth.deleteOne, {
      model: 'session',
      where: [{ field: 'id', value: actor.sessionId }],
    })
    await advance(test, 10 * minute)
    await test.mutation(auth.create, { model: 'session', data, workforce })
    const replacement = await session(test)
    expect(replacement?._id).not.toBe(old?._id)
    await advance(test, 50 * minute)
    expect((await session(test))?._id).toBe(replacement?._id)
    expect((await jobs(test)).filter((job) => job.state.kind === 'pending')).toHaveLength(1)
    await advance(test, 10 * minute)
    expect(await session(test)).toBeNull()
  })
})
