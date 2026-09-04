/// <reference types="vite/client" />

import { convexTest } from 'convex-test'
import { componentsGeneric, type ApiFromModules, type FunctionArgs } from 'convex/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComponentApi } from '../../src/runtime/convex-auth/component/_generated/component'
import { fingerprintWorkforceFactor } from '../../src/runtime/convex-auth/workforce/factor-fingerprint'
import type { WorkforceOperation } from '../../src/runtime/convex-auth/workforce/operations'
import schema from '../fixtures/workforce-component/convex/betterAuth/schema'
import type * as seed from '../fixtures/workforce-component/convex/betterAuth/seed'
import rootSchema from '../fixtures/workforce-root/convex/schema'

const rootModules = import.meta.glob('../fixtures/workforce-root/convex/**/*.ts')
const authModules = import.meta.glob('../fixtures/workforce-component/convex/betterAuth/**/*.ts')
const components = componentsGeneric() as unknown as {
  workforceAuth: ComponentApi<'workforceAuth'> & ApiFromModules<{ seed: typeof seed }>
}
const auth = components.workforceAuth.adapter
const now = 1_700_000_000_000
const where = (id: string) => [{ field: 'id', value: id }]

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
})
afterEach(() => vi.useRealTimers())

function init() {
  const test = convexTest(rootSchema, rootModules)
  test.registerComponent('workforceAuth', schema, authModules)
  return test
}
type Test = ReturnType<typeof init>
function read(test: Test, model: string, id: string) {
  return test.query(auth.findOne, { model, where: where(id) })
}
function operation(
  name: 'begin-enrollment' | 'confirm-enrollment',
  generation: number,
  sessionId = 'setup',
): Extract<WorkforceOperation, { sessionId: string }> {
  return {
    operation: name,
    userId: 'user',
    sessionId,
    expectedGeneration: generation,
  }
}
function session(
  test: Test,
  id: string,
  generation: number,
  method: string,
  workforce?: WorkforceOperation,
) {
  const data = {
    id,
    userId: 'user',
    token: `synthetic-${id}`,
    createdAt: now,
    updatedAt: now,
    expiresAt: now + 60_000,
    bcnAssuranceGeneration: generation,
    bcnAssuranceMethod: method,
    bcnAuthenticatedAt: now,
    bcnSessionStartedAt: now,
    ipAddress: null,
    userAgent: null,
  }
  return workforce
    ? test.mutation(auth.create, { model: 'session', workforce, data })
    : test.mutation(components.workforceAuth.seed.session, { data })
}
async function initial(test: Test) {
  await test.mutation(auth.create, {
    model: 'user',
    data: {
      id: 'user',
      name: 'user',
      email: 'user@example.test',
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
      twoFactorEnabled: false,
      bcnSecurityGeneration: 0,
    },
  })
  await session(test, 'setup', 0, 'password-only')
  return test.mutation(auth.create, {
    model: 'twoFactor',
    workforce: operation('begin-enrollment', 0),
    data: {
      id: 'factor',
      userId: 'user',
      secret: 'initial-encrypted-seed',
      backupCodes: 'initial-encrypted-codes',
      verified: false,
      failedVerificationCount: 0,
    },
  })
}
function begin(test: Test, generation: number, sessionId = 'setup', label = 'replacement') {
  return test.mutation(auth.updateOne, {
    model: 'twoFactor',
    where: where('factor'),
    workforce: operation('begin-enrollment', generation, sessionId),
    update: {
      secret: `${label}-encrypted-seed`,
      backupCodes: `${label}-encrypted-codes`,
      verified: true,
    },
  })
}
async function confirmation(test: Test, generation: number, sessionId = 'setup') {
  const factor = await read(test, 'twoFactor', 'factor')
  if (!factor || typeof factor.bcnPendingSecret !== 'string') {
    throw new Error('TEST_PENDING_FACTOR_REQUIRED')
  }
  const fingerprint = await fingerprintWorkforceFactor(factor.bcnPendingSecret)
  return {
    ...operation('confirm-enrollment', generation, sessionId),
    replay: {
      // Stable per synthetic factor flow: retries keep the same replay identity.
      digest: `confirm-${generation}-${fingerprint}`.slice(0, 43),
      userId: 'user',
      factorId: 'factor',
      factorFingerprint: fingerprint,
      matchingCounters: [Math.floor(Date.now() / 30_000)],
    },
  } satisfies WorkforceOperation
}
async function confirm(test: Test, generation: number, sessionId = 'setup') {
  return test.mutation(auth.updateOne, {
    model: 'twoFactor',
    where: where('factor'),
    workforce: await confirmation(test, generation, sessionId),
    update: { verified: true },
  })
}
async function enrolled(test: Test) {
  await initial(test)
  await confirm(test, 1)
  await session(test, 'approved', 2, 'password-totp')
}

async function recoveryChallenge(
  test: Test,
  overrides: Partial<FunctionArgs<typeof components.workforceAuth.seed.verification>['data']> = {},
) {
  await test.mutation(components.workforceAuth.seed.verification, {
    data: {
      id: 'challenge',
      identifier: 'synthetic-hashed-challenge',
      value: 'user',
      bcnAssuranceGeneration: 2,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + 60_000,
      ...overrides,
    },
  })
}

function consumeRecovery(
  test: Test,
  overrides: {
    where?: FunctionArgs<typeof auth.incrementOne>['where']
    increment?: Record<string, number>
    set?: Record<string, unknown>
    workforce?: WorkforceOperation
  } = {},
) {
  return test.mutation(auth.incrementOne, {
    model: 'twoFactor',
    where: [
      { field: 'id', value: 'factor' },
      { field: 'backupCodes', value: 'initial-encrypted-codes' },
    ],
    increment: {},
    set: { backupCodes: 'remaining-encrypted-codes' },
    workforce: {
      operation: 'recovery-sign-in',
      userId: 'user',
      challengeId: 'challenge',
      expectedGeneration: 2,
    },
    ...overrides,
  })
}

function regenerate(
  test: Test,
  sessionId = 'approved',
  update = { backupCodes: 'new-encrypted-codes' },
) {
  return test.mutation(auth.updateOne, {
    model: 'twoFactor',
    where: where('factor'),
    update,
    workforce: {
      operation: 'regenerate-backup-codes',
      userId: 'user',
      sessionId,
      expectedGeneration: 2,
    },
  })
}

describe('canonical recovery code writes', () => {
  it('consumes once with exact guards without granting assurance or advancing generation', async () => {
    const test = init()
    await enrolled(test)
    await recoveryChallenge(test)
    expect(await consumeRecovery(test)).toMatchObject({
      backupCodes: 'remaining-encrypted-codes',
    })
    expect(await consumeRecovery(test)).toBeNull()
    expect(await read(test, 'user', 'user')).toMatchObject({
      bcnSecurityGeneration: 2,
    })
    expect(await read(test, 'verification', 'challenge')).not.toBeNull()
    expect(await read(test, 'session', 'approved')).toMatchObject({
      bcnAssuranceGeneration: 2,
    })
  })

  it('admits only one competing consumption of the same code snapshot', async () => {
    const test = init()
    await enrolled(test)
    await recoveryChallenge(test)
    const results = await Promise.all([consumeRecovery(test), consumeRecovery(test)])
    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it.each([
    { label: 'missing code guard', where: where('factor') },
    {
      label: 'duplicate guard',
      where: [...where('factor'), ...where('factor')],
    },
    {
      label: 'OR',
      where: [
        { field: 'id', value: 'factor' },
        {
          field: 'backupCodes',
          value: 'initial-encrypted-codes',
          connector: 'OR' as const,
        },
      ],
    },
    {
      label: 'case insensitive',
      where: [
        { field: 'id', value: 'factor', mode: 'insensitive' as const },
        { field: 'backupCodes', value: 'initial-encrypted-codes' },
      ],
    },
    {
      label: 'extra write',
      set: {
        backupCodes: 'remaining-encrypted-codes',
        failedVerificationCount: 0,
      },
    },
    { label: 'counter increment', increment: { failedVerificationCount: 1 } },
    { label: 'empty ciphertext', set: { backupCodes: '' } },
    { label: 'unchanged ciphertext', set: { backupCodes: 'initial-encrypted-codes' } },
  ])('rejects $label without changing codes', async ({ label: _label, ...overrides }) => {
    const test = init()
    await enrolled(test)
    await recoveryChallenge(test)
    await expect(consumeRecovery(test, overrides)).rejects.toThrow(
      'AUTH_WORKFORCE_RECOVERY_CAS_REQUIRED',
    )
    expect(await read(test, 'twoFactor', 'factor')).toMatchObject({
      backupCodes: 'initial-encrypted-codes',
    })
  })

  it.each([
    { label: 'expired', expiresAt: now },
    { label: 'wrong user', value: 'other' },
    { label: 'stale generation', bcnAssuranceGeneration: 1 },
    { label: 'missing generation', bcnAssuranceGeneration: null },
  ])('rejects a $label challenge', async ({ label: _label, ...overrides }) => {
    const test = init()
    await enrolled(test)
    await recoveryChallenge(test, overrides)
    await expect(consumeRecovery(test)).rejects.toThrow('AUTH_WORKFORCE_RECOVERY_CHALLENGE_INVALID')
  })

  it('rejects a missing challenge and an ordinary unbound code update', async () => {
    const test = init()
    await enrolled(test)
    await expect(consumeRecovery(test)).rejects.toThrow('AUTH_WORKFORCE_RECOVERY_CHALLENGE_INVALID')
    await expect(consumeRecovery(test, { workforce: undefined })).rejects.toThrow(
      'AUTH_WORKFORCE_OPERATION_REQUIRED',
    )
    await expect(
      test.mutation(auth.updateOne, {
        model: 'twoFactor',
        where: where('factor'),
        update: { backupCodes: 'forged' },
        workforce: {
          operation: 'recovery-sign-in',
          userId: 'user',
          challengeId: 'challenge',
          expectedGeneration: 2,
        },
      }),
    ).rejects.toThrow('AUTH_WORKFORCE_OPERATION_REQUIRED')
  })

  it('rejects a challenge captured before another credential change', async () => {
    const test = init()
    await enrolled(test)
    await recoveryChallenge(test)
    await begin(test, 2, 'approved')
    await expect(consumeRecovery(test)).rejects.toThrow('AUTH_WORKFORCE_RECOVERY_CHALLENGE_INVALID')
    expect(await read(test, 'twoFactor', 'factor')).toMatchObject({
      backupCodes: 'initial-encrypted-codes',
    })
  })

  it('rotates codes with fresh TOTP approval and invalidates every existing session', async () => {
    const test = init()
    await enrolled(test)
    expect(await regenerate(test)).toMatchObject({
      backupCodes: 'new-encrypted-codes',
      secret: 'initial-encrypted-seed',
      bcnPendingSecret: null,
    })
    expect(await read(test, 'user', 'user')).toMatchObject({
      bcnSecurityGeneration: 3,
    })
    expect(await read(test, 'session', 'approved')).toBeNull()
    await expect(regenerate(test)).rejects.toThrow('AUTH_WORKFORCE_CONTINUATION_INVALID')
  })

  it('rejects backup regeneration that also changes the seed', async () => {
    const test = init()
    await enrolled(test)
    await expect(
      test.mutation(auth.updateOne, {
        model: 'twoFactor',
        where: where('factor'),
        update: { backupCodes: 'new-encrypted-codes', secret: 'unverified-new-seed' },
        workforce: {
          operation: 'regenerate-backup-codes',
          userId: 'user',
          sessionId: 'approved',
          expectedGeneration: 2,
        },
      }),
    ).rejects.toThrow('AUTH_WORKFORCE_BACKUP_REGENERATION_INVALID')
    expect(await read(test, 'twoFactor', 'factor')).toMatchObject({
      secret: 'initial-encrypted-seed',
    })
  })

  it('requires fresh ceremony approval even when the session has not expired', async () => {
    const test = init()
    await enrolled(test)
    await test.mutation(components.workforceAuth.seed.session, {
      data: {
        id: 'long-lived',
        userId: 'user',
        token: 'synthetic-long-lived',
        createdAt: now,
        updatedAt: now,
        expiresAt: now + 600_000,
        bcnAssuranceGeneration: 2,
        bcnAssuranceMethod: 'password-totp',
        bcnAuthenticatedAt: now,
        bcnSessionStartedAt: now,
        ipAddress: null,
        userAgent: null,
      },
    })
    vi.setSystemTime(now + 300_000)
    await expect(regenerate(test, 'long-lived')).rejects.toThrow(
      'AUTH_WORKFORCE_FRESH_AUTH_REQUIRED',
    )
    await expect(begin(test, 2, 'long-lived')).rejects.toThrow('AUTH_WORKFORCE_FRESH_AUTH_REQUIRED')
  })

  it.each(['password-only', 'password-recovery', 'totp-enrollment', 'none'])(
    'does not regenerate using %s approval',
    async (method) => {
      const test = init()
      await enrolled(test)
      await session(test, 'restricted', 2, method)
      await expect(regenerate(test, 'restricted')).rejects.toThrow(
        'AUTH_WORKFORCE_FRESH_AUTH_REQUIRED',
      )
    },
  )
})

describe('canonical pending factor transitions', () => {
  it('does not promote a pending factor without replay evidence', async () => {
    const test = init()
    await initial(test)
    await expect(
      test.mutation(auth.updateOne, {
        model: 'twoFactor',
        where: where('factor'),
        workforce: operation('confirm-enrollment', 1),
        update: { verified: true },
      }),
    ).rejects.toThrow('AUTH_WORKFORCE_REPLAY_PROOF_REQUIRED')
    expect(await read(test, 'twoFactor', 'factor')).toMatchObject({
      secret: '',
      verified: false,
      bcnPendingSecret: 'initial-encrypted-seed',
    })
    expect(await read(test, 'user', 'user')).toMatchObject({
      twoFactorEnabled: false,
      bcnSecurityGeneration: 1,
    })
  })

  it('rolls back the replay marker together with failed factor promotion', async () => {
    const test = init()
    await initial(test)
    const workforce = await confirmation(test, 1)
    const before = await read(test, 'twoFactor', 'factor')
    await expect(
      test.mutation(async (ctx) => {
        await ctx.runMutation(auth.updateOne, {
          model: 'twoFactor',
          where: where('factor'),
          workforce,
          update: { verified: true },
        })
        throw new Error('TEST_FACTOR_PROMOTION_ROLLBACK')
      }),
    ).rejects.toThrow('TEST_FACTOR_PROMOTION_ROLLBACK')
    expect(await read(test, 'twoFactor', 'factor')).toEqual(before)
    expect(
      await read(test, 'verification', `bcn-totp-replay:${workforce.replay.digest}`),
    ).toBeNull()
    expect(await read(test, 'user', 'user')).toMatchObject({
      twoFactorEnabled: false,
      bcnSecurityGeneration: 1,
    })
    expect(await read(test, 'session', 'setup')).toMatchObject({
      bcnAssuranceMethod: 'totp-enrollment',
      bcnAssuranceGeneration: 1,
    })
    await confirm(test, 1)
    expect(
      await read(test, 'verification', `bcn-totp-replay:${workforce.replay.digest}`),
    ).not.toBeNull()
  })

  it('projects only the bound pending seed through the real component read', async () => {
    const test = init()
    await enrolled(test)
    await begin(test, 2, 'approved')
    const projected = await test.query(auth.findOne, {
      model: 'twoFactor',
      where: where('factor'),
      select: ['secret', 'verified'],
      workforce: operation('confirm-enrollment', 3, 'approved'),
    })
    expect(projected).toEqual({ secret: 'replacement-encrypted-seed', verified: false })
    expect(await read(test, 'twoFactor', 'factor')).toMatchObject({
      secret: 'initial-encrypted-seed',
      verified: true,
    })
    await expect(
      test.query(auth.findOne, {
        model: 'twoFactor',
        where: where('factor'),
        workforce: operation('confirm-enrollment', 2, 'approved'),
      }),
    ).rejects.toThrow('AUTH_WORKFORCE_CONTINUATION_INVALID')
  })

  it('defers the initial user flag and commits it only with verified factor promotion', async () => {
    const test = init()
    expect(await initial(test)).toMatchObject({
      secret: '',
      backupCodes: '',
      verified: false,
      bcnPendingSecret: 'initial-encrypted-seed',
      bcnPendingSessionId: 'setup',
      bcnPendingGeneration: 1,
    })
    const updated = await test.mutation(auth.updateOne, {
      model: 'user',
      where: where('user'),
      update: { twoFactorEnabled: true },
      workforce: operation('confirm-enrollment', 1),
    })
    expect(updated).toMatchObject({ twoFactorEnabled: false })
    expect(await read(test, 'user', 'user')).toMatchObject({
      twoFactorEnabled: false,
    })
    expect(await confirm(test, 1)).toMatchObject({
      secret: 'initial-encrypted-seed',
      backupCodes: 'initial-encrypted-codes',
      verified: true,
      bcnPendingSecret: null,
      bcnPendingBackupCodes: null,
      bcnPendingSessionId: null,
      bcnPendingGeneration: null,
    })
    expect(await read(test, 'user', 'user')).toMatchObject({
      twoFactorEnabled: true,
      bcnSecurityGeneration: 2,
    })
    expect(await read(test, 'session', 'setup')).toMatchObject({
      bcnAssuranceMethod: 'none',
      bcnAssuranceGeneration: 2,
    })
  })

  it('preserves active credentials throughout replacement and swaps them only at confirmation', async () => {
    const test = init()
    await enrolled(test)
    expect(await begin(test, 2, 'approved')).toMatchObject({
      secret: 'initial-encrypted-seed',
      backupCodes: 'initial-encrypted-codes',
      verified: true,
      bcnPendingSecret: 'replacement-encrypted-seed',
      bcnPendingGeneration: 3,
    })
    expect(await read(test, 'session', 'approved')).toMatchObject({
      bcnAssuranceMethod: 'totp-enrollment',
    })
    expect(await confirm(test, 3, 'approved')).toMatchObject({
      secret: 'replacement-encrypted-seed',
      backupCodes: 'replacement-encrypted-codes',
      verified: true,
    })
  })

  it('moves only the designated pending binding during provider rotation and preserves its lifetime', async () => {
    const test = init()
    await initial(test)
    vi.setSystemTime(now + 1000)
    const next = await session(test, 'successor', -1, 'none', operation('confirm-enrollment', 1))
    expect(next).toMatchObject({
      bcnSessionStartedAt: now,
      bcnAuthenticatedAt: now,
      bcnAssuranceMethod: 'totp-enrollment',
      bcnAssuranceGeneration: 1,
      expiresAt: now + 60_000,
    })
    expect(await read(test, 'twoFactor', 'factor')).toMatchObject({
      bcnPendingSessionId: 'successor',
    })
    await expect(confirm(test, 1)).rejects.toThrow('AUTH_WORKFORCE_PENDING_FACTOR_INVALID')
    await confirm(test, 1, 'successor')
  })

  it('permits fresh initial restart after a lost setup response but not password-only replacement', async () => {
    const test = init()
    await initial(test)
    await session(test, 'fresh-password', 1, 'password-only')
    await begin(test, 1, 'fresh-password', 'initial-restart')
    await confirm(test, 2, 'fresh-password')
    await session(test, 'weak', 3, 'password-only')
    await expect(begin(test, 3, 'weak')).rejects.toThrow('AUTH_WORKFORCE_FRESH_AUTH_REQUIRED')
  })

  it('permits a new approved session to restart replacement while retaining the old factor', async () => {
    const test = init()
    await enrolled(test)
    await begin(test, 2, 'approved')
    await session(test, 'new-full-login', 3, 'password-totp')
    await begin(test, 3, 'new-full-login', 'retry')
    await expect(confirm(test, 3, 'approved')).rejects.toThrow(
      'AUTH_WORKFORCE_CONTINUATION_INVALID',
    )
    expect(await read(test, 'twoFactor', 'factor')).toMatchObject({
      secret: 'initial-encrypted-seed',
    })
    await confirm(test, 4, 'new-full-login')
  })

  it('serializes competing replacement requests at one captured generation', async () => {
    const test = init()
    await enrolled(test)
    const results = await Promise.allSettled([
      begin(test, 2, 'approved', 'a'),
      begin(test, 2, 'approved', 'b'),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(await read(test, 'user', 'user')).toMatchObject({
      bcnSecurityGeneration: 3,
    })
  })

  it('rejects seed proof captured before a concurrent replacement restart', async () => {
    const test = init()
    await initial(test)
    await begin(test, 1)
    await expect(confirm(test, 1)).rejects.toThrow('AUTH_WORKFORCE_CONTINUATION_INVALID')
    expect(await read(test, 'twoFactor', 'factor')).toMatchObject({
      verified: false,
      bcnPendingGeneration: 2,
    })
  })

  it.each(['none', 'unknown'])(
    'rejects %s sessions even with a matching generation',
    async (method) => {
      const test = init()
      await initial(test)
      await session(test, 'unapproved', 1, method)
      await expect(begin(test, 1, 'unapproved')).rejects.toThrow(
        'AUTH_WORKFORCE_FRESH_AUTH_REQUIRED',
      )
    },
  )

  it('rejects expired or stale-freshness approval without changing active credentials', async () => {
    const test = init()
    await enrolled(test)
    vi.setSystemTime(now + 60_000)
    await expect(begin(test, 2, 'approved')).rejects.toThrow('AUTH_WORKFORCE_CONTINUATION_INVALID')
    expect(await read(test, 'twoFactor', 'factor')).toMatchObject({
      secret: 'initial-encrypted-seed',
      bcnPendingSecret: null,
    })
  })

  it('rejects raw flag, pending-field and surviving-factor deletion bypasses', async () => {
    const test = init()
    await enrolled(test)
    await expect(
      test.mutation(auth.updateOne, {
        model: 'user',
        where: where('user'),
        update: { twoFactorEnabled: false },
      }),
    ).rejects.toThrow('AUTH_WORKFORCE_FACTOR_FLAG_FORBIDDEN')
    await expect(
      test.mutation(auth.updateOne, {
        model: 'twoFactor',
        where: where('factor'),
        update: { bcnPendingSecret: 'forged' },
      }),
    ).rejects.toThrow('AUTH_WORKFORCE_PENDING_FIELDS_OWNED')
    await expect(
      test.mutation(auth.updateOne, {
        model: 'twoFactor',
        where: where('factor'),
        update: { secret: 'forged' },
      }),
    ).rejects.toThrow('AUTH_WORKFORCE_OPERATION_REQUIRED')
    await expect(
      test.mutation(auth.deleteOne, {
        model: 'twoFactor',
        where: where('factor'),
      }),
    ).rejects.toThrow('AUTH_WORKFORCE_FACTOR_DELETE_FORBIDDEN')
    await test.mutation(auth.deleteOne, {
      model: 'user',
      where: where('user'),
    })
    expect(await read(test, 'twoFactor', 'factor')).toBeNull()
  })
})
