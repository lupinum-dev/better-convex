/// <reference types="vite/client" />

import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../../src/runtime/convex-auth/component/_generated/api'
import { fingerprintWorkforceFactor } from '../../src/runtime/convex-auth/workforce/factor-fingerprint'
import {
  workforceSessionPolicy,
  type WorkforceConsumedChallenge,
  type WorkforceOperation,
} from '../../src/runtime/convex-auth/workforce/operations'
import schema from '../fixtures/workforce-component/convex/betterAuth/schema'

const modules = import.meta.glob('../fixtures/workforce-component/convex/betterAuth/**/*.ts')
const now = 1_700_000_000_000
const generation = 5
const auth = api.adapter
const password = {
  operation: 'password-sign-in',
  userId: 'user',
  expectedGeneration: generation,
} as const satisfies WorkforceOperation
const totp = {
  ...password,
  operation: 'totp-sign-in',
  challengeId: 'challenge',
} as const satisfies WorkforceOperation
const receipt = { ...totp, expiresAt: now + 60_000 } satisfies WorkforceConsumedChallenge
const session = {
  id: 'new-session',
  userId: 'user',
  token: 'synthetic-session-token',
  createdAt: now,
  updatedAt: now,
  expiresAt: now + 24 * 60 * 60 * 1000,
  bcnAssuranceGeneration: 900,
  bcnAssuranceMethod: 'password-totp',
  bcnAuthenticatedAt: now + 123,
  bcnSessionStartedAt: now + 123,
}
const challenge = {
  id: 'challenge',
  identifier: 'synthetic-hashed-challenge',
  value: 'user',
  createdAt: now,
  updatedAt: now,
  expiresAt: now + 60_000,
  bcnAssuranceGeneration: generation,
}

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
      createdAt: now,
      updatedAt: now,
      twoFactorEnabled: true,
      bcnSecurityGeneration: generation,
    }),
    factor: await ctx.db.insert('twoFactor', {
      id: 'factor',
      userId: 'user',
      secret: 'synthetic-encrypted-active-secret',
      backupCodes: 'synthetic-encrypted-active-codes',
      verified: true,
      failedVerificationCount: null,
      lockedUntil: null,
      bcnPendingSecret: null,
      bcnPendingBackupCodes: null,
      bcnPendingSessionId: null,
      bcnPendingGeneration: null,
    }),
  }))
  const create = async (
    workforce?: WorkforceOperation,
    workforceConsumedChallenge?: WorkforceConsumedChallenge,
    overrides: Record<string, unknown> = {},
  ) => {
    if (workforce?.operation === 'totp-sign-in') {
      const factor = await test.run((ctx) => ctx.db.get('twoFactor', ids.factor))
      if (!factor) throw new Error('TEST_FACTOR_REQUIRED')
      workforce = {
        ...workforce,
        replay: {
          digest: 'T'.repeat(43),
          userId: factor.userId,
          factorId: factor.id,
          factorFingerprint: await fingerprintWorkforceFactor(factor.secret),
          matchingCounters: [Math.floor(Date.now() / 30_000)],
        },
      }
    }
    return test.mutation(auth.create, {
      model: 'session',
      data: { ...session, ...overrides },
      workforce,
      workforceConsumedChallenge,
    })
  }
  return { test, ids, create }
}

describe('canonical workforce session creation', () => {
  it('stamps password-only proof and clamps lifetime regardless of caller fields', async () => {
    const { create } = await init()
    expect(await create(password)).toMatchObject({
      bcnAssuranceGeneration: generation,
      bcnAssuranceMethod: 'password-only',
      bcnAuthenticatedAt: now,
      bcnSessionStartedAt: now,
      expiresAt: now + workforceSessionPolicy.idleTimeoutMs,
    })
  })

  it('preserves a shorter provider lifetime', async () => {
    const { create } = await init()
    expect(await create(password, undefined, { expiresAt: now + 1000 })).toMatchObject({
      expiresAt: now + 1000,
    })
  })

  it.each([
    undefined,
    { ...password, operation: 'begin-enrollment', sessionId: 'old' },
    { ...password, operation: 'password-challenge', challengeId: 'challenge' },
    { ...password, operation: 'regenerate-backup-codes', sessionId: 'old' },
  ] satisfies Array<WorkforceOperation | undefined>)(
    'denies unsupported creation %j',
    async (op) => {
      const { create } = await init()
      await expect(create(op)).rejects.toThrow('AUTH_WORKFORCE_SESSION_OPERATION_REQUIRED')
    },
  )

  it.each([
    { label: 'stale', bcnSecurityGeneration: generation + 1 },
    { label: 'unverified', emailVerified: false },
  ])('denies a $label user snapshot', async ({ label: _label, ...patch }) => {
    const { test, ids, create } = await init()
    await test.run((ctx) => ctx.db.patch('user', ids.user, patch))
    await expect(create(password)).rejects.toThrow('AUTH_WORKFORCE_SIGN_IN_STATE_CHANGED')
  })

  it('denies a deleted user and a foreign session owner', async () => {
    const { test, ids, create } = await init()
    await expect(create({ ...password, userId: 'other' })).rejects.toThrow(
      'AUTH_WORKFORCE_SESSION_OPERATION_REQUIRED',
    )
    await test.run((ctx) => ctx.db.delete('user', ids.user))
    await expect(create(password)).rejects.toThrow()
  })

  it('stamps full proof only at the successful TOTP session create path', async () => {
    const { test, ids, create } = await init()
    expect(await create(totp, receipt)).toMatchObject({
      bcnAssuranceGeneration: generation,
      bcnAssuranceMethod: 'password-totp',
      bcnAuthenticatedAt: now,
    })
    expect(await test.run((ctx) => ctx.db.get('user', ids.user))).toMatchObject({
      bcnSecurityGeneration: generation,
    })
  })

  it('denies full proof without replay evidence and does not create a session', async () => {
    const { test } = await init()
    await expect(
      test.mutation(auth.create, {
        model: 'session',
        data: session,
        workforce: totp,
        workforceConsumedChallenge: receipt,
      }),
    ).rejects.toThrow('AUTH_WORKFORCE_REPLAY_PROOF_REQUIRED')
    expect(await test.run((ctx) => ctx.db.query('session').collect())).toEqual([])
  })

  it('does not grant a second session for the same synthetic TOTP proof', async () => {
    const { test, create } = await init()
    await create(totp, receipt)
    await expect(
      create(totp, receipt, { id: 'replayed', token: 'synthetic-replayed' }),
    ).rejects.toThrow('AUTH_WORKFORCE_TOTP_REPLAYED')
    expect(await test.run((ctx) => ctx.db.query('session').collect())).toHaveLength(1)
  })

  it.each([
    undefined,
    { ...receipt, operation: 'recovery-sign-in' },
    { ...receipt, userId: 'other' },
    { ...receipt, challengeId: 'other' },
    { ...receipt, expectedGeneration: generation - 1 },
    { ...receipt, expiresAt: now },
    { ...receipt, expiresAt: Number.NaN },
  ] satisfies Array<WorkforceConsumedChallenge | undefined>)(
    'denies absent, mismatched or expired consumed evidence %j',
    async (proof) => {
      const { create } = await init()
      await expect(create(totp, proof)).rejects.toThrow('AUTH_WORKFORCE_CHALLENGE_RECEIPT_REQUIRED')
    },
  )

  it('rejects a primary challenge that still exists', async () => {
    const { test, create } = await init()
    await test.run((ctx) => ctx.db.insert('verification', challenge))
    await expect(create(totp, receipt)).rejects.toThrow(
      'AUTH_WORKFORCE_SECOND_FACTOR_STATE_INVALID',
    )
  })

  it.each([{ verified: false }, { secret: '' }])(
    'rejects invalid active factor %j',
    async (patch) => {
      const { test, ids, create } = await init()
      await test.run((ctx) => ctx.db.patch('twoFactor', ids.factor, patch))
      await expect(create(totp, receipt)).rejects.toThrow(
        'AUTH_WORKFORCE_SECOND_FACTOR_STATE_INVALID',
      )
    },
  )

  it('gives recovery only restricted proof and invalidates the previous generation', async () => {
    const { test, ids, create } = await init()
    const recovery = { ...totp, operation: 'recovery-sign-in' } as const
    expect(await create(recovery, { ...receipt, ...recovery })).toMatchObject({
      bcnAssuranceMethod: 'password-recovery',
      bcnAssuranceGeneration: generation + 1,
    })
    expect(await test.run((ctx) => ctx.db.get('user', ids.user))).toMatchObject({
      bcnSecurityGeneration: generation + 1,
    })
    await expect(create(totp, receipt, { id: 'later', token: 'later-token' })).rejects.toThrow(
      'AUTH_WORKFORCE_SIGN_IN_STATE_CHANGED',
    )
  })

  it('rolls back a recovery generation change when the containing mutation fails', async () => {
    const { test, ids } = await init()
    await expect(
      test.mutation(async (ctx) => {
        await ctx.runMutation(auth.create, {
          model: 'session',
          data: session,
          workforce: { ...totp, operation: 'recovery-sign-in' },
          workforceConsumedChallenge: { ...receipt, operation: 'recovery-sign-in' },
        })
        throw new Error('TEST_ONLY_FAILURE_AFTER_CREATE')
      }),
    ).rejects.toThrow('TEST_ONLY_FAILURE_AFTER_CREATE')
    expect(await test.run((ctx) => ctx.db.get('user', ids.user))).toMatchObject({
      bcnSecurityGeneration: generation,
    })
    expect(await test.run((ctx) => ctx.db.query('session').collect())).toEqual([])
  })

  it('does not accept consumed challenge metadata on password or non-session creation', async () => {
    const { test, create } = await init()
    await expect(create(password, receipt)).rejects.toThrow(
      'AUTH_WORKFORCE_UNEXPECTED_CHALLENGE_RECEIPT',
    )
    await expect(
      test.mutation(auth.create, {
        model: 'verification',
        data: challenge,
        workforceConsumedChallenge: receipt,
      }),
    ).rejects.toThrow('AUTH_WORKFORCE_UNEXPECTED_CHALLENGE_RECEIPT')
  })
})

describe('server-owned challenge and generation fields', () => {
  it('stamps only an exact reserved primary challenge', async () => {
    const { test } = await init()
    expect(
      await test.mutation(auth.create, {
        model: 'verification',
        data: { ...challenge, bcnAssuranceGeneration: 999 },
        workforce: { ...password, operation: 'password-challenge', challengeId: challenge.id },
      }),
    ).toMatchObject({ bcnAssuranceGeneration: generation })
  })

  it.each([undefined, password])(
    'removes injected challenge proof without primary reservation',
    async (workforce) => {
      const { test } = await init()
      expect(
        await test.mutation(auth.create, {
          model: 'verification',
          data: challenge,
          workforce,
        }),
      ).toMatchObject({ bcnAssuranceGeneration: null })
    },
  )

  it.each([{ id: 'other' }, { value: 'other' }, { expiresAt: now }])(
    'rejects a mismatched primary %j',
    async (patch) => {
      const { test } = await init()
      await expect(
        test.mutation(auth.create, {
          model: 'verification',
          data: { ...challenge, ...patch },
          workforce: { ...password, operation: 'password-challenge', challengeId: challenge.id },
        }),
      ).rejects.toThrow('AUTH_WORKFORCE_PASSWORD_CHALLENGE_INVALID')
    },
  )

  it.each(['updateOne', 'updateMany', 'incrementOne'] as const)(
    'blocks proof mutation through %s',
    async (kind) => {
      const { test, create } = await init()
      await create(password)
      for (const [model, id, field] of [
        ['user', 'user', 'bcnSecurityGeneration'],
        ['session', session.id, 'bcnAssuranceGeneration'],
        ['session', session.id, 'bcnAuthenticatedAt'],
        ['session', session.id, 'bcnSessionStartedAt'],
      ]) {
        const args = { model: model!, where: [{ field: 'id', value: id! }] }
        await expect(
          kind === 'incrementOne'
            ? test.mutation(auth.incrementOne, { ...args, increment: { [field!]: 1 } })
            : test.mutation(auth[kind], { ...args, update: { [field!]: 42 } }),
        ).rejects.toThrow('AUTH_WORKFORCE_PROOF_FIELDS_OWNED')
      }
    },
  )

  it('never extends the idle deadline or resets proof clocks during provider refresh', async () => {
    const { test, create } = await init()
    await create(password)
    vi.setSystemTime(now + 60_000)
    expect(
      await test.mutation(auth.updateOne, {
        model: 'session',
        where: [{ field: 'id', value: session.id }],
        update: { expiresAt: now + 24 * 60 * 60 * 1000, updatedAt: now + 60_000 },
      }),
    ).toMatchObject({
      bcnSessionStartedAt: now,
      bcnAuthenticatedAt: now,
      expiresAt: now + workforceSessionPolicy.idleTimeoutMs,
    })
  })
})
