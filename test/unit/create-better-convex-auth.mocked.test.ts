// Temporary: these behavior tests still mock Better Auth. Each group moves to a convex-test file with real Better Auth; delete this file when it is empty. See test/TESTING.md.
import type { BetterAuthOptions } from 'better-auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createBetterConvexAuth } from '../../src/runtime/convex-auth/create-better-convex-auth'

const { betterAuth } = vi.hoisted(() => ({
  betterAuth: vi.fn((options: unknown) => ({
    $context: Promise.resolve(),
    handler: vi.fn(),
    options,
  })),
}))

vi.mock('better-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('better-auth')>()),
  betterAuth,
}))

const previousEnvironment = {
  BETTER_AUTH_SECRETS: process.env.BETTER_AUTH_SECRETS,
  CONVEX_SITE_URL: process.env.CONVEX_SITE_URL,
  SITE_URL: process.env.SITE_URL,
}

beforeEach(() => {
  process.env.BETTER_AUTH_SECRETS = `0:${'test-secret'.repeat(4)}`
  process.env.CONVEX_SITE_URL = 'https://deployment.convex.site'
  process.env.SITE_URL = 'https://app.example.test'
  betterAuth.mockClear()
})

afterEach(() => {
  for (const [name, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) Reflect.deleteProperty(process.env, name)
    else process.env[name] = value
  }
})

function queryContext() {
  return { runQuery: vi.fn().mockResolvedValue(null) }
}

function component() {
  const reference = {} as never
  return {
    adapter: {
      consumeOne: reference,
      consumeRateLimit: reference,
      count: reference,
      create: reference,
      deleteMany: reference,
      deleteOne: reference,
      findMany: reference,
      findOne: reference,
      incrementOne: reference,
      rotateSigningKey: reference,
      sessionAdmission: reference,
      updateMany: reference,
      updateOne: reference,
    },
  } as never
}

describe('createBetterConvexAuth', () => {
  it('retries only confirmed uncommitted rate-limit contention with a fixed bound', async () => {
    const consumeRateLimit = { operation: 'consumeRateLimit' }
    const systemConflict = new Error(
      'Documents read from or written to the table "rateLimit" changed while this mutation was being run and on every subsequent retry.',
    )
    const ctx = {
      ...queryContext(),
      runMutation: vi
        .fn()
        .mockRejectedValueOnce(systemConflict)
        .mockRejectedValueOnce(systemConflict)
        .mockResolvedValueOnce({ allowed: true, retryAfter: null }),
    }
    const componentWithRateLimit = component() as unknown as {
      adapter: Record<string, unknown>
    }
    componentWithRateLimit.adapter.consumeRateLimit = consumeRateLimit
    const auth = createBetterConvexAuth(componentWithRateLimit as never)

    await auth.createAuth(ctx as never)
    const options = betterAuth.mock.calls[0]![0] as BetterAuthOptions
    const consume = () =>
      options.rateLimit!.customStorage!.consume('client|/get-session', { max: 100, window: 10 })
    await expect(consume()).resolves.toEqual({ allowed: true, retryAfter: null })
    expect(ctx.runMutation).toHaveBeenCalledTimes(3)
    expect(ctx.runMutation).toHaveBeenLastCalledWith(consumeRateLimit, {
      key: 'client|/get-session',
      max: 100,
      retentionWindow: 60,
      window: 10,
    })

    ctx.runMutation.mockClear()
    ctx.runMutation.mockRejectedValueOnce(new Error('AUTH_RATE_LIMIT_ROW_INVALID'))
    await expect(consume()).rejects.toThrow('AUTH_RATE_LIMIT_ROW_INVALID')
    expect(ctx.runMutation).toHaveBeenCalledTimes(1)

    ctx.runMutation.mockClear()
    ctx.runMutation.mockRejectedValueOnce(new Error('optimistic concurrency control failure'))
    await expect(consume()).rejects.toThrow('optimistic concurrency control failure')
    expect(ctx.runMutation).toHaveBeenCalledTimes(1)

    ctx.runMutation.mockClear()
    ctx.runMutation.mockRejectedValue(systemConflict)
    await expect(consume()).rejects.toThrow(systemConflict.message)
    expect(ctx.runMutation).toHaveBeenCalledTimes(6)

    // Inside a mutation (ctx.db present) a retry cannot help: fail on the first conflict.
    ctx.runMutation.mockClear()
    Object.assign(ctx, { db: {} })
    await expect(consume()).rejects.toThrow(systemConflict.message)
    expect(ctx.runMutation).toHaveBeenCalledTimes(1)
  })
})
