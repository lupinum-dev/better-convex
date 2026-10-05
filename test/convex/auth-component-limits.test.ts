/// <reference types="vite/client" />

import { convexTest } from 'convex-test'
import { componentsGeneric, defineSchema } from 'convex/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ComponentApi } from '../../src/runtime/convex-auth/component/_generated/component'
import schema from '../../src/runtime/convex-auth/component/schema'
import { createBetterConvexAuth } from '../../src/runtime/convex-auth/create-better-convex-auth'
import { signInAs } from '../../src/runtime/convex-auth/test'

const rootModules = import.meta.glob('../fixtures/jwks-rotation/convex/**/*.ts')
const authModules = import.meta.glob('../../src/runtime/convex-auth/component/**/*.ts')
const component = (componentsGeneric() as unknown as { limits: ComponentApi<'limits'> }).limits
const adapter = component.adapter

function init() {
  const test = convexTest(defineSchema({}), rootModules)
  test.registerComponent('limits', schema, authModules)
  return test
}

afterEach(() => vi.useRealTimers())

describe('auth component limits', () => {
  it('A01 removes 300 stale rate limits and one-time keys after a burst', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
    const test = init()
    for (let index = 0; index < 300; index++) {
      await test.mutation(adapter.create, {
        model: 'rateLimit',
        data: { id: `stale-${index}`, key: `stale-${index}`, count: 1, lastRequest: 1 },
      })
    }
    for (let index = 0; index < 10; index++) {
      await test.mutation(adapter.consumeRateLimit, {
        key: `one-time-${index}`,
        max: 2,
        window: 10,
        retentionWindow: 60,
      })
    }
    await test.mutation(adapter.create, {
      model: 'rateLimit',
      data: { id: 'reset', key: 'reset', count: 2, lastRequest: 1 },
    })
    await test.mutation(adapter.consumeRateLimit, {
      key: 'reset',
      max: 2,
      window: 10,
      retentionWindow: 60,
    })
    for (let batch = 0; batch < 3; batch++) {
      vi.advanceTimersByTime(0)
      await test.finishInProgressScheduledFunctions()
    }
    expect(await test.query(adapter.count, { model: 'rateLimit' })).toBe(11)
    await test.finishAllScheduledFunctions(vi.runAllTimers)
    expect(await test.query(adapter.count, { model: 'rateLimit' })).toBe(0)
  })

  it('A02 counts only admitted sessions after generation invalidation', async () => {
    const test = init()
    await signInAs(test, 'alice', { componentName: 'limits' })
    expect(await test.query(adapter.count, { model: 'session' })).toBe(1)
    await test.mutation(adapter.deleteMany, {
      model: 'session',
      where: [{ field: 'userId', value: 'alice' }],
    })
    expect(
      (
        await test.query(adapter.findMany, {
          model: 'session',
          paginationOpts: { cursor: null, numItems: 10 },
        })
      ).page,
    ).toEqual([])
    expect(await test.query(adapter.count, { model: 'session' })).toBe(0)
  })

  it('A03 signs in again after generation revocation with a fresh session identity', async () => {
    const test = init()
    const auth = createBetterConvexAuth(component)
    const first = await signInAs(test, 'alice', { componentName: 'limits' })
    const before = await first.query((ctx) => ctx.auth.getUserIdentity())
    await test.mutation(adapter.deleteMany, {
      model: 'session',
      where: [{ field: 'userId', value: 'alice' }],
    })
    const second = await signInAs(test, 'alice', { componentName: 'limits' })
    expect((await second.query((ctx) => ctx.auth.getUserIdentity()))?.sid).not.toBe(before?.sid)
    expect(await second.query((ctx) => auth.requireUser(ctx))).toMatchObject({ id: 'alice' })
    expect(await first.query((ctx) => auth.getUser(ctx))).toBeNull()
  })
})
