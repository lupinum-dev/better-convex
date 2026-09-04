/// <reference types="vite/client" />

import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  workforceSessionPolicy,
  type WorkforceOperation,
} from '../../src/runtime/convex-auth/workforce/operations'
import { readWorkforcePendingFactor } from '../../src/runtime/convex-auth/workforce/pending-factor-view'
import schema from '../fixtures/workforce-component/convex/betterAuth/schema'

const modules = import.meta.glob('../fixtures/workforce-component/convex/betterAuth/**/*.ts')
const now = 1_700_000_000_000
const generation = 5
const operation = {
  operation: 'confirm-enrollment',
  userId: 'user',
  sessionId: 'setup',
  expectedGeneration: generation,
} as const satisfies WorkforceOperation

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
})
afterEach(() => vi.useRealTimers())

async function init() {
  const test = convexTest(schema, modules)
  const ids = await test.run(async (ctx) => ({
    user: await ctx.db.insert('user', {
      id: 'user',
      name: 'User',
      email: 'user@example.test',
      emailVerified: true,
      image: null,
      createdAt: now - 1000,
      updatedAt: now - 1000,
      twoFactorEnabled: true,
      bcnSecurityGeneration: generation,
    }),
    session: await ctx.db.insert('session', {
      id: 'setup',
      userId: 'user',
      token: 'synthetic-setup-session',
      createdAt: now - 1000,
      updatedAt: now - 1000,
      expiresAt: now + 60_000,
      ipAddress: null,
      userAgent: null,
      bcnAssuranceGeneration: generation,
      bcnAssuranceMethod: 'totp-enrollment',
      bcnAuthenticatedAt: now - 1000,
      bcnSessionStartedAt: now - 1000,
    }),
    factor: await ctx.db.insert('twoFactor', {
      id: 'factor',
      userId: 'user',
      secret: 'active-encrypted-secret',
      backupCodes: 'active-encrypted-codes',
      verified: true,
      failedVerificationCount: null,
      lockedUntil: null,
      bcnPendingSecret: 'pending-encrypted-secret',
      bcnPendingBackupCodes: 'pending-encrypted-codes',
      bcnPendingSessionId: 'setup',
      bcnPendingGeneration: generation,
    }),
  }))
  const read = () =>
    test.run(async (ctx) =>
      readWorkforcePendingFactor(ctx, await ctx.db.get('twoFactor', ids.factor), operation),
    )
  return { test, ids, read }
}

describe('operation-bound pending factor reads', () => {
  it('projects the pending seed for confirmation without mutating canonical credentials', async () => {
    const { test, ids, read } = await init()
    const original = await test.run((ctx) => ctx.db.get('twoFactor', ids.factor))
    expect(await read()).toEqual({
      ...original,
      secret: 'pending-encrypted-secret',
      backupCodes: 'pending-encrypted-codes',
      verified: false,
    })
    expect(await test.run((ctx) => ctx.db.get('twoFactor', ids.factor))).toEqual(original)
  })

  it('leaves absent and unrelated operations unchanged without reading authority', async () => {
    const { test, ids } = await init()
    const operations: Array<WorkforceOperation | undefined> = [
      undefined,
      { ...operation, operation: 'begin-enrollment' },
      { ...operation, operation: 'regenerate-backup-codes' },
      { operation: 'password-sign-in', userId: 'user', expectedGeneration: generation },
      {
        operation: 'totp-sign-in',
        userId: 'user',
        expectedGeneration: generation,
        challengeId: 'challenge',
      },
      {
        operation: 'recovery-sign-in',
        userId: 'user',
        expectedGeneration: generation,
        challengeId: 'challenge',
      },
    ]
    await test.run(async (ctx) => {
      const row = await ctx.db.get('twoFactor', ids.factor)
      const query = vi.spyOn(ctx.db, 'query')
      try {
        for (const unrelated of operations) {
          expect(await readWorkforcePendingFactor(ctx, row, unrelated)).toBe(row)
          expect(await readWorkforcePendingFactor(ctx, null, unrelated)).toBeNull()
        }
        expect(query).not.toHaveBeenCalled()
      } finally {
        query.mockRestore()
      }
    })
  })

  it.each(['user', 'session', 'factor'] as const)(
    'rejects a missing canonical %s',
    async (name) => {
      const { test, ids, read } = await init()
      await test.run(async (ctx) => {
        await ctx.db.delete(ids[name])
      })
      await expect(read()).rejects.toThrow('AUTH_WORKFORCE_')
    },
  )

  it.each([
    { bcnAssuranceMethod: 'password-only' },
    { bcnAssuranceMethod: 'password-totp' },
    { bcnAssuranceMethod: 'password-recovery' },
    { bcnAssuranceMethod: 'none' },
    { bcnAssuranceGeneration: generation - 1 },
    { userId: 'other' },
    { expiresAt: now },
    { bcnAuthenticatedAt: now + 1 },
    { bcnSessionStartedAt: now },
    { bcnSessionStartedAt: now - workforceSessionPolicy.absoluteLifetimeMs },
  ])('rejects invalid continuation session %j', async (patch) => {
    const { test, ids, read } = await init()
    await test.run((ctx) => ctx.db.patch('session', ids.session, patch))
    await expect(read()).rejects.toThrow('AUTH_WORKFORCE_')
  })

  it.each([{ bcnSecurityGeneration: generation + 1 }, { emailVerified: false }])(
    'rejects changed canonical user authority %j',
    async (patch) => {
      const { test, ids, read } = await init()
      await test.run((ctx) => ctx.db.patch('user', ids.user, patch))
      await expect(read()).rejects.toThrow('AUTH_WORKFORCE_CONTINUATION_INVALID')
    },
  )

  it.each([
    { userId: 'other' },
    { bcnPendingSessionId: 'other' },
    { bcnPendingSessionId: null },
    { bcnPendingGeneration: generation - 1 },
    { bcnPendingGeneration: null },
    { bcnPendingSecret: '' },
    { bcnPendingSecret: null },
    { bcnPendingBackupCodes: '' },
    { bcnPendingBackupCodes: null },
  ])('rejects an unbound or missing pending factor %j', async (patch) => {
    const { test, ids, read } = await init()
    await test.run((ctx) => ctx.db.patch('twoFactor', ids.factor, patch))
    await expect(read()).rejects.toThrow('AUTH_WORKFORCE_PENDING_FACTOR_INVALID')
  })
})
