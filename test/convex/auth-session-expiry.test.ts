/// <reference types="vite/client" />

import { convexTest } from 'convex-test'
import { anyApi, type ApiFromModules } from 'convex/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as adapter from '../../src/runtime/convex-auth/component/adapter'
import schema from '../../src/runtime/convex-auth/component/schema'

const modules = import.meta.glob('../../src/runtime/convex-auth/component/**/*.ts')
const api = anyApi as unknown as ApiFromModules<{ adapter: typeof adapter }>
const auth = api.adapter
const now = 1_700_000_000_000
const minute = 60_000
const sessionId = 'session'
const data = {
  id: sessionId,
  userId: 'user',
  token: 'synthetic-scheduler-session',
  createdAt: now,
  updatedAt: now,
  expiresAt: now + 60 * minute,
  ipAddress: null,
  userAgent: null,
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
  await test.mutation(auth.create, {
    model: 'user',
    data: {
      id: data.userId,
      name: 'Synthetic user',
      email: 'user@example.test',
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    },
  })
  return test
}
type Test = Awaited<ReturnType<typeof init>>

async function session(test: Test) {
  return test.run((ctx) =>
    ctx.db
      .query('session')
      .withIndex('id', (query) => query.eq('id', sessionId))
      .unique(),
  )
}
async function jobs(test: Test) {
  return test.run((ctx) => ctx.db.system.query('_scheduled_functions').take(20))
}
async function pending(test: Test) {
  return (await jobs(test)).filter((job) => job.state.kind === 'pending')
}
async function advance(test: Test, elapsed: number) {
  vi.advanceTimersByTime(elapsed)
  await test.finishInProgressScheduledFunctions()
}

describe('component session expiry scheduler', () => {
  it('schedules one physical-row job and deletes the session at its expiry', async () => {
    const test = await init()
    await test.mutation(auth.create, { model: 'session', data })
    const created = await session(test)
    expect(created).not.toBeNull()
    expect(await jobs(test)).toMatchObject([
      {
        name: 'adapter:expireSession',
        args: [{ storageId: created?._id }],
        scheduledTime: data.expiresAt,
        state: { kind: 'pending' },
      },
    ])
    await advance(test, 60 * minute - 1)
    expect(await session(test)).not.toBeNull()
    await advance(test, 1)
    expect(await session(test)).toBeNull()
    expect((await jobs(test)).map((job) => job.state.kind)).toEqual(['success'])
  })

  it('follows a refreshed expiry with the existing chain', async () => {
    const test = await init()
    await test.mutation(auth.create, { model: 'session', data })
    const created = await session(test)
    if (!created) throw new Error('TEST_SESSION_REQUIRED')
    await test.mutation(auth.updateOne, {
      model: 'session',
      where: [{ field: 'id', value: sessionId }],
      update: { expiresAt: now + 120 * minute },
    })
    expect(await jobs(test)).toHaveLength(1)
    await advance(test, 60 * minute)
    expect(await session(test)).not.toBeNull()
    expect(await pending(test)).toMatchObject([
      { args: [{ storageId: created._id }], scheduledTime: now + 120 * minute },
    ])
    await advance(test, 60 * minute)
    expect(await session(test)).toBeNull()
    expect(await pending(test)).toEqual([])
  })

  it('rolls back the inserted session and scheduled job together', async () => {
    const test = await init()
    await expect(
      test.mutation(async (ctx) => {
        await ctx.runMutation(auth.create, { model: 'session', data })
        throw new Error('TEST_SESSION_INSERT_ROLLBACK')
      }),
    ).rejects.toThrow('TEST_SESSION_INSERT_ROLLBACK')
    expect(await session(test)).toBeNull()
    expect(await jobs(test)).toEqual([])
  })

  it('does not let an old physical-row job delete a replacement with the same logical ID', async () => {
    const test = await init()
    await test.mutation(auth.create, { model: 'session', data })
    const old = await session(test)
    await test.mutation(auth.deleteOne, {
      model: 'session',
      where: [{ field: 'id', value: sessionId }],
    })
    await advance(test, 10 * minute)
    await test.mutation(auth.create, {
      model: 'session',
      data: { ...data, expiresAt: now + 70 * minute },
    })
    const replacement = await session(test)
    expect(replacement?._id).not.toBe(old?._id)
    await advance(test, 50 * minute)
    expect((await session(test))?._id).toBe(replacement?._id)
    expect(await pending(test)).toHaveLength(1)
    await advance(test, 10 * minute)
    expect(await session(test)).toBeNull()
  })
})
