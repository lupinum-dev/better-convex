/// <reference types="vite/client" />

import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ordinarySchema from '../../src/runtime/convex-auth/component/schema'
import { readAuthSessionAdmission } from '../../src/runtime/convex-auth/workforce/admission'
import { workforceSessionPolicy } from '../../src/runtime/convex-auth/workforce/operations'
import workforceSchema from '../fixtures/workforce-component/convex/betterAuth/schema'

const modules = import.meta.glob('../fixtures/workforce-component/convex/betterAuth/**/*.ts')
const ordinaryModules = import.meta.glob('../../src/runtime/convex-auth/component/**/*.ts')
const now = 1_700_000_000_000
const generation = 5
const assertProfile = makeFunctionReference<'query', { workforce: boolean }, null>(
  'adapter:assertProfile',
)
const user = {
  id: 'user',
  name: 'User',
  email: 'user@example.test',
  emailVerified: true,
  image: null,
  createdAt: now - 1_000,
  updatedAt: now - 1_000,
}
const session = {
  id: 'session',
  userId: user.id,
  token: 'synthetic-session',
  createdAt: now - 1_000,
  updatedAt: now - 1_000,
  expiresAt: now + 60_000,
  ipAddress: null,
  userAgent: null,
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
})
afterEach(() => vi.useRealTimers())

async function init() {
  const test = convexTest(workforceSchema, modules)
  const ids = await test.run(async (ctx) => ({
    user: await ctx.db.insert('user', {
      ...user,
      twoFactorEnabled: true,
      bcnSecurityGeneration: generation,
    }),
    session: await ctx.db.insert('session', {
      ...session,
      bcnAssuranceGeneration: generation,
      bcnAssuranceMethod: 'password-totp',
      bcnAuthenticatedAt: now - 1_000,
      bcnSessionStartedAt: now - 1_000,
    }),
  }))
  const read = (binding: { sessionId: string; userId?: string } = { sessionId: session.id }) =>
    test.run((ctx) => readAuthSessionAdmission(ctx, binding, true))
  return { test, ids, read }
}

describe('canonical session admission', () => {
  it('rejects mismatched runtime profiles without exposing rows or changing schema policy', async () => {
    const workforce = convexTest(workforceSchema, modules)
    const ordinary = convexTest(ordinarySchema, ordinaryModules)
    await expect(workforce.query(assertProfile, { workforce: true })).resolves.toBeNull()
    await expect(ordinary.query(assertProfile, { workforce: false })).resolves.toBeNull()
    await expect(workforce.query(assertProfile, { workforce: false })).rejects.toThrow(
      'AUTH_WORKFORCE_SCHEMA_MISMATCH',
    )
    await expect(ordinary.query(assertProfile, { workforce: true })).rejects.toThrow(
      'AUTH_WORKFORCE_SCHEMA_MISMATCH',
    )
  })
  it('returns live full-assurance canonical rows with optional exact user binding', async () => {
    const { test, ids, read } = await init()
    const canonical = await test.run(async (ctx) => ({
      user: await ctx.db.get('user', ids.user),
      session: await ctx.db.get('session', ids.session),
    }))
    expect(await read()).toEqual(canonical)
    expect(await read({ sessionId: session.id, userId: user.id })).toEqual(canonical)
  })

  it.each(['password-only', 'totp-enrollment', 'password-recovery', 'none', 'unknown'])(
    'denies restricted or unknown method %s',
    async (method) => {
      const { test, ids, read } = await init()
      await test.run((ctx) => ctx.db.patch('session', ids.session, { bcnAssuranceMethod: method }))
      expect(await read()).toBeNull()
    },
  )

  it.each([
    { sessionId: '' },
    { sessionId: 'missing' },
    { sessionId: session.id, userId: '' },
    { sessionId: session.id, userId: 'other' },
  ])('denies missing session or mismatched identity %j', async (binding) => {
    const { read } = await init()
    expect(await read(binding)).toBeNull()
  })

  it.each(['user', 'session'] as const)('denies a deleted canonical %s', async (table) => {
    const { test, ids, read } = await init()
    expect(await read()).not.toBeNull()
    await test.run((ctx) => ctx.db.delete(ids[table]))
    expect(await read()).toBeNull()
  })

  it.each([
    { bcnSecurityGeneration: generation + 1 },
    { bcnSecurityGeneration: -1 },
    { bcnSecurityGeneration: 0.5 },
    { emailVerified: false },
  ])('denies changed or malformed user authority %j', async (patch) => {
    const { test, ids, read } = await init()
    await test.run((ctx) => ctx.db.patch('user', ids.user, patch))
    expect(await read()).toBeNull()
  })

  it.each([
    { userId: '' },
    { userId: 'other' },
    { bcnAssuranceGeneration: generation - 1 },
    { bcnAssuranceGeneration: -1 },
    { bcnAssuranceGeneration: 0.5 },
    { expiresAt: now },
    { expiresAt: now - 1 },
    { expiresAt: Number.POSITIVE_INFINITY },
    { expiresAt: Number.NaN },
    { bcnAuthenticatedAt: now + 1 },
    { bcnAuthenticatedAt: 0 },
    { bcnSessionStartedAt: 0 },
    { bcnSessionStartedAt: now },
    { bcnSessionStartedAt: now - workforceSessionPolicy.absoluteLifetimeMs },
  ])('denies malformed or expired session authority %j', async (patch) => {
    const { test, ids, read } = await init()
    await test.run((ctx) => ctx.db.patch('session', ids.session, patch))
    expect(await read()).toBeNull()
  })

  it('does not impose the privileged-action freshness window on ordinary business admission', async () => {
    const { test, ids, read } = await init()
    const authenticatedAt = now - workforceSessionPolicy.freshAuthenticationMs - 1
    await test.run((ctx) =>
      ctx.db.patch('session', ids.session, {
        bcnAuthenticatedAt: authenticatedAt,
        bcnSessionStartedAt: authenticatedAt,
      }),
    )
    expect(await read()).not.toBeNull()
  })

  it('preserves ordinary admission without accepting its missing fields as workforce proof', async () => {
    const test = convexTest(ordinarySchema, ordinaryModules)
    const ids = await test.run(async (ctx) => ({
      user: await ctx.db.insert('user', {
        ...user,
        emailVerified: false,
        bcnSecurityGeneration: 0,
      }),
      session: await ctx.db.insert('session', { ...session, bcnAssuranceGeneration: 0 }),
    }))
    const binding = { sessionId: session.id, userId: user.id }
    expect(await test.run((ctx) => readAuthSessionAdmission(ctx, binding, false))).toMatchObject({
      user: { id: user.id, emailVerified: false },
      session,
    })
    await test.run((ctx) => ctx.db.patch('user', ids.user, { emailVerified: true }))
    expect(await test.run((ctx) => readAuthSessionAdmission(ctx, binding, true))).toBeNull()
    await test.run((ctx) => ctx.db.patch('session', ids.session, { expiresAt: now }))
    expect(await test.run((ctx) => readAuthSessionAdmission(ctx, binding, false))).toBeNull()
  })
})
