/// <reference types="vite/client" />

import { convexTest } from 'convex-test'
import { componentsGeneric, defineSchema } from 'convex/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '../../src/runtime/convex-auth/component/_generated/api'
import type { ComponentApi } from '../../src/runtime/convex-auth/component/_generated/component'
import schema from '../../src/runtime/convex-auth/component/schema'
import { createBetterConvexAuth } from '../../src/runtime/convex-auth/create-better-convex-auth'
import { requireMcpPrincipal } from '../../src/runtime/convex-auth/mcp-principal'
import { grantMcp, signInAs } from '../../src/runtime/convex-auth/test'

const rootModules = import.meta.glob('../fixtures/jwks-rotation/convex/**/*.ts')
const authModules = import.meta.glob('../../src/runtime/convex-auth/component/**/*.ts')
const component = (componentsGeneric() as unknown as { limits: ComponentApi<'limits'> }).limits
const adapter = component.adapter

function init() {
  const test = convexTest(defineSchema({}), rootModules)
  test.registerComponent('limits', schema, authModules)
  return test
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('auth component limits', () => {
  it('rejects a malformed quota row instead of admitting another request', async () => {
    const test = convexTest(schema, authModules)
    // Model an already-corrupt persisted row; the public adapter rejects NaN at creation.
    await test.run((ctx) =>
      ctx.db.insert('rateLimit', {
        id: 'malformed',
        key: 'malformed',
        count: Number.NaN,
        lastRequest: Date.now(),
      }),
    )
    await expect(
      test.mutation(api.adapter.consumeRateLimit, {
        key: 'malformed',
        max: 2,
        window: 10,
        retentionWindow: 60,
      }),
    ).rejects.toThrow('AUTH_RATE_LIMIT_ROW_INVALID')
  })

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

  // Catches unique conflicts (user, session, consent) between the two test helpers, and a grant
  // that the live-grant check would refuse.
  it('grants MCP access to the person signInAs signs in, in either order', async () => {
    vi.stubEnv('SITE_URL', 'https://app.example.test')
    vi.stubEnv('CONVEX_SITE_URL', 'https://deployment.example.test')
    const test = init()
    const admitted = (principal: Awaited<ReturnType<typeof grantMcp>>) =>
      test.run(async (ctx) => (await requireMcpPrincipal(ctx, component, principal)).user.id)

    const web = await signInAs(test, 'alice', { componentName: 'limits' })
    const alice = await grantMcp(test, 'alice', ['notes:read'], { componentName: 'limits' })
    expect(alice).toMatchObject({
      userId: 'alice',
      sessionId: (await web.query((ctx) => ctx.auth.getUserIdentity()))?.sid,
      issuer: 'https://app.example.test/api/auth',
      resource: 'https://deployment.example.test/mcp',
    })
    await expect(admitted(alice)).resolves.toBe('alice')
    // A second scope for the same person and host widens the one consent.
    const wider = await grantMcp(test, 'alice', ['notes:read', 'notes:write'], {
      componentName: 'limits',
    })
    await expect(admitted(wider)).resolves.toBe('alice')

    const bob = await grantMcp(test, 'bob', ['notes:read'], { componentName: 'limits' })
    const bobOnWeb = await signInAs(test, 'bob', { componentName: 'limits' })
    expect((await bobOnWeb.query((ctx) => ctx.auth.getUserIdentity()))?.sid).toBe(bob.sessionId)
    await expect(admitted(bob)).resolves.toBe('bob')

    // Signing out ends the grant.
    await test.mutation(adapter.deleteOne, {
      model: 'session',
      where: [{ field: 'id', value: bob.sessionId }],
    })
    await expect(admitted(bob)).rejects.toThrow('MCP access denied')
  })

  // Codex round 4: after a revocation each helper made its own new session, so a sign-out on the
  // web left MCP access standing.
  it('shares the new session after a revocation, so one sign-out still ends both', async () => {
    vi.stubEnv('SITE_URL', 'https://app.example.test')
    vi.stubEnv('CONVEX_SITE_URL', 'https://deployment.example.test')
    const test = init()
    await signInAs(test, 'alice', { componentName: 'limits' })
    await test.mutation(adapter.deleteMany, {
      model: 'session',
      where: [{ field: 'userId', value: 'alice' }],
    })
    const web = await signInAs(test, 'alice', { componentName: 'limits' })
    const mcp = await grantMcp(test, 'alice', ['notes:read'], { componentName: 'limits' })
    expect((await web.query((ctx) => ctx.auth.getUserIdentity()))?.sid).toBe(mcp.sessionId)
    await test.mutation(adapter.deleteOne, {
      model: 'session',
      where: [{ field: 'id', value: mcp.sessionId }],
    })
    await expect(test.run((ctx) => requireMcpPrincipal(ctx, component, mcp))).rejects.toThrow(
      'MCP access denied',
    )
  })

  // Codex round 3: grantMcp minted a live grant under NODE_ENV=production, outside any test runner.
  it('refuses to sign in or grant outside a test runner', async () => {
    const test = init()
    vi.stubEnv('VITEST', '')
    vi.stubEnv('NODE_ENV', 'production')
    await expect(signInAs(test, 'alice', { componentName: 'limits' })).rejects.toThrow(
      'AUTH_TEST_RUNNER_REQUIRED',
    )
    await expect(
      grantMcp(test, 'alice', ['notes:read'], { componentName: 'limits' }),
    ).rejects.toThrow('AUTH_TEST_RUNNER_REQUIRED')
    vi.unstubAllEnvs()
    expect(await test.query(adapter.count, { model: 'session' })).toBe(0)
  })
})
