import type { BetterAuthOptions } from 'better-auth'
import { twoFactor } from 'better-auth/plugins'
import type { FunctionArgs } from 'convex/server'
import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'

import { createConvexAuthAdapter } from '../../src/runtime/convex-auth/adapter/create-adapter'
import type { AuthAdapterComponentApi } from '../../src/runtime/convex-auth/types'
import type {
  WorkforceConsumedChallenge,
  WorkforceOperation,
} from '../../src/runtime/convex-auth/workforce/operations'
import {
  armWorkforceConsumedChallenge,
  getWorkforceOperation,
  reserveWorkforcePasswordChallenge,
  takeWorkforceConsumedChallenge,
} from '../../src/runtime/convex-auth/workforce/request-context'
import {
  workforceSchemaOptions,
  workforceSchemaPlugin,
} from '../../src/runtime/convex-auth/workforce/schema'

vi.mock('../../src/runtime/convex-auth/workforce/request-context', () => ({
  getWorkforceOperation: vi.fn(),
  armWorkforceConsumedChallenge: vi.fn(),
  reserveWorkforcePasswordChallenge: vi.fn(),
  takeWorkforceConsumedChallenge: vi.fn(),
}))

const recovery: WorkforceOperation = {
  operation: 'recovery-sign-in',
  userId: 'recovery-user',
  expectedGeneration: 5,
  challengeId: 'server-challenge',
}
const receipt: WorkforceConsumedChallenge = { ...recovery, expiresAt: 200_000 }
const workforceOptions: BetterAuthOptions = {
  ...workforceSchemaOptions,
  plugins: [twoFactor(), workforceSchemaPlugin],
}

function fixture(options: BetterAuthOptions = workforceOptions) {
  const references = {
    create: { operation: 'create' },
    findOne: { operation: 'findOne' },
    updateOne: { operation: 'updateOne' },
    updateMany: { operation: 'updateMany' },
    incrementOne: { operation: 'incrementOne' },
    consumeOne: { operation: 'consumeOne' },
  }
  const ctx = {
    auth: {},
    db: {},
    runQuery: vi.fn(async (_reference: unknown, _args: Record<string, unknown>) => null),
    runMutation: vi.fn(async (_reference: unknown, args: Record<string, unknown>) => {
      if (_reference === references.updateMany) return 1
      if (_reference === references.create) return args.data
      return null
    }),
  }
  // This isolates transport using the repository's existing adapter test seam.
  const adapter = createConvexAuthAdapter(ctx as never, { adapter: references } as never)(options)
  return { adapter, ctx, references }
}

async function createSession(adapter: ReturnType<typeof fixture>['adapter']) {
  return adapter.create({
    model: 'session',
    forceAllowId: true,
    data: {
      id: 'new-session',
      userId: recovery.userId,
      token: 'synthetic-session-token',
      expiresAt: new Date(100_000),
      createdAt: new Date(100),
      updatedAt: new Date(100),
    },
  })
}

async function consumeRecoveryCode(adapter: ReturnType<typeof fixture>['adapter']) {
  // Exact pinned provider operation: backup-codes/index.mjs:216–227.
  return adapter.incrementOne({
    model: 'twoFactor',
    where: [
      { field: 'id', value: 'factor-id' },
      { field: 'backupCodes', value: 'synthetic-old-encrypted-codes' },
    ],
    increment: {},
    set: { backupCodes: 'synthetic-new-encrypted-codes' },
  })
}

async function createVerification(adapter: ReturnType<typeof fixture>['adapter'], value = '0') {
  return adapter.create({
    model: 'verification',
    forceAllowId: true,
    data: {
      id: 'primary-logical-id',
      identifier: 'synthetic-hashed-identifier',
      value,
      expiresAt: new Date(200_000),
      createdAt: new Date(100),
      updatedAt: new Date(100),
    },
  })
}

async function consumeChallenge(adapter: ReturnType<typeof fixture>['adapter']) {
  return adapter.consumeOne({
    model: 'verification',
    where: [{ field: 'identifier', value: 'synthetic-hashed-identifier' }],
  })
}

beforeEach(() => {
  vi.mocked(getWorkforceOperation).mockReset().mockResolvedValue(null)
  vi.mocked(reserveWorkforcePasswordChallenge).mockReset().mockResolvedValue(null)
  vi.mocked(takeWorkforceConsumedChallenge).mockReset().mockResolvedValue(receipt)
  vi.mocked(armWorkforceConsumedChallenge).mockReset().mockResolvedValue(undefined)
})

describe('workforce adapter request-operation transport', () => {
  it('matches the generated component operation arguments without widening them', () => {
    type Api = AuthAdapterComponentApi['adapter']
    expectTypeOf<FunctionArgs<Api['create']>['workforce']>().toEqualTypeOf<
      WorkforceOperation | undefined
    >()
    expectTypeOf<FunctionArgs<Api['updateOne']>['workforce']>().toEqualTypeOf<
      WorkforceOperation | undefined
    >()
    expectTypeOf<FunctionArgs<Api['incrementOne']>['workforce']>().toEqualTypeOf<
      WorkforceOperation | undefined
    >()
    expectTypeOf<FunctionArgs<Api['findOne']>['workforce']>().toEqualTypeOf<
      WorkforceOperation | undefined
    >()
    expectTypeOf<FunctionArgs<Api['create']>['workforceConsumedChallenge']>().toEqualTypeOf<
      WorkforceConsumedChallenge | undefined
    >()
  })

  it('forwards confirmation only to the factor read', async () => {
    const h = fixture()
    const operation: WorkforceOperation = {
      operation: 'confirm-enrollment',
      userId: recovery.userId,
      expectedGeneration: 5,
      sessionId: 'restricted-session',
    }
    vi.mocked(getWorkforceOperation).mockResolvedValue(operation)
    await h.adapter.findOne({
      model: 'twoFactor',
      where: [{ field: 'userId', value: recovery.userId }],
    })
    expect(h.ctx.runQuery).toHaveBeenLastCalledWith(
      h.references.findOne,
      expect.objectContaining({ workforce: operation }),
    )
    await h.adapter.findOne({ model: 'user', where: [{ field: 'id', value: recovery.userId }] })
    expect(h.ctx.runQuery.mock.calls.at(-1)?.[1]).not.toHaveProperty('workforce')
  })

  it('does not project the active factor during a recovery sign-in', async () => {
    const h = fixture()
    vi.mocked(getWorkforceOperation).mockResolvedValue(recovery)
    await h.adapter.findOne({
      model: 'twoFactor',
      where: [{ field: 'userId', value: recovery.userId }],
    })
    expect(h.ctx.runQuery.mock.calls.at(-1)?.[1]).not.toHaveProperty('workforce')
  })

  it('takes the server-bound receipt before dispatching final session creation', async () => {
    const h = fixture()
    vi.mocked(getWorkforceOperation).mockResolvedValue(recovery)
    await createSession(h.adapter)
    expect(h.ctx.runMutation).toHaveBeenCalledOnce()
    expect(h.ctx.runMutation).toHaveBeenCalledWith(
      h.references.create,
      expect.objectContaining({
        workforce: recovery,
        workforceConsumedChallenge: receipt,
        model: 'session',
        data: expect.objectContaining({ userId: recovery.userId, expiresAt: 100_000 }),
      }),
    )
    expect(takeWorkforceConsumedChallenge).toHaveBeenCalledExactlyOnceWith(recovery.userId)
    expect(vi.mocked(takeWorkforceConsumedChallenge).mock.invocationCallOrder[0]).toBeLessThan(
      h.ctx.runMutation.mock.invocationCallOrder[0]!,
    )
  })

  it('does not dispatch a session insert when receipt validation fails', async () => {
    const h = fixture()
    vi.mocked(getWorkforceOperation).mockResolvedValue(recovery)
    vi.mocked(takeWorkforceConsumedChallenge).mockRejectedValue(
      new Error('AUTH_WORKFORCE_CHALLENGE_RECEIPT_REQUIRED'),
    )
    await expect(createSession(h.adapter)).rejects.toThrow(
      'AUTH_WORKFORCE_CHALLENGE_RECEIPT_REQUIRED',
    )
    expect(h.ctx.runMutation).not.toHaveBeenCalled()
  })

  it('never rearms the receipt after a failed session insert', async () => {
    const h = fixture()
    vi.mocked(getWorkforceOperation).mockResolvedValue(recovery)
    h.ctx.runMutation.mockRejectedValueOnce(new Error('synthetic-insert-failure'))
    await expect(createSession(h.adapter)).rejects.toThrow('synthetic-insert-failure')
    expect(takeWorkforceConsumedChallenge).toHaveBeenCalledOnce()
    expect(armWorkforceConsumedChallenge).not.toHaveBeenCalled()
  })

  it('reserves the normalized primary ID before the component create call', async () => {
    const h = fixture()
    const primary = {
      operation: 'password-challenge',
      userId: '0',
      expectedGeneration: 5,
      challengeId: 'primary-logical-id',
    } satisfies WorkforceOperation
    vi.mocked(reserveWorkforcePasswordChallenge).mockResolvedValueOnce(primary)
    await createVerification(h.adapter)
    expect(reserveWorkforcePasswordChallenge).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: 'primary-logical-id', value: '0', expiresAt: 200_000 }),
    )
    expect(h.ctx.runMutation).toHaveBeenCalledWith(
      h.references.create,
      expect.objectContaining({ workforce: primary }),
    )
    expect(vi.mocked(reserveWorkforcePasswordChallenge).mock.invocationCallOrder[0]).toBeLessThan(
      h.ctx.runMutation.mock.invocationCallOrder[0]!,
    )
    expect(getWorkforceOperation).not.toHaveBeenCalled()
  })

  it('does not inherit a password operation for companion or unrelated verification creates', async () => {
    const h = fixture()
    vi.mocked(getWorkforceOperation).mockResolvedValue({
      operation: 'password-sign-in',
      userId: '0',
      expectedGeneration: 5,
    })
    await createVerification(h.adapter)
    expect(h.ctx.runMutation.mock.calls[0]?.[1]).not.toHaveProperty('workforce')
    expect(getWorkforceOperation).not.toHaveBeenCalled()
  })

  it('does not dispatch when primary reservation validation fails', async () => {
    const h = fixture()
    vi.mocked(reserveWorkforcePasswordChallenge).mockRejectedValueOnce(
      new Error('AUTH_WORKFORCE_PASSWORD_CHALLENGE_INVALID'),
    )
    await expect(createVerification(h.adapter)).rejects.toThrow(
      'AUTH_WORKFORCE_PASSWORD_CHALLENGE_INVALID',
    )
    expect(h.ctx.runMutation).not.toHaveBeenCalled()
  })

  it('arms only the committed consume winner before provider date conversion', async () => {
    const h = fixture()
    const winner = {
      id: recovery.challengeId,
      identifier: 'synthetic-hashed-identifier',
      value: recovery.userId,
      expiresAt: 200_000,
      createdAt: 100,
      updatedAt: 100,
      bcnAssuranceGeneration: recovery.expectedGeneration,
    }
    h.ctx.runMutation.mockResolvedValueOnce(winner)
    const consumed = await consumeChallenge(h.adapter)
    expect(armWorkforceConsumedChallenge).toHaveBeenCalledExactlyOnceWith(winner)
    expect(consumed).toMatchObject({ expiresAt: new Date(200_000) })
    expect(h.ctx.runMutation.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(armWorkforceConsumedChallenge).mock.invocationCallOrder[0]!,
    )
    expect(h.ctx.runQuery).not.toHaveBeenCalled()
  })

  it('does not arm from a failed consume mutation', async () => {
    const h = fixture()
    h.ctx.runMutation.mockRejectedValueOnce(new Error('synthetic-consume-failure'))
    await expect(consumeChallenge(h.adapter)).rejects.toThrow('synthetic-consume-failure')
    expect(armWorkforceConsumedChallenge).not.toHaveBeenCalled()
  })

  it('passes a losing null consume result without fabricating a receipt', async () => {
    const h = fixture()
    await expect(consumeChallenge(h.adapter)).resolves.toBeNull()
    expect(armWorkforceConsumedChallenge).toHaveBeenCalledExactlyOnceWith(null)
  })

  it('does not arm from consumption of another model', async () => {
    const h = fixture()
    await h.adapter.consumeOne({ model: 'session', where: [{ field: 'id', value: 'session' }] })
    expect(armWorkforceConsumedChallenge).not.toHaveBeenCalled()
  })

  it('keeps ordinary verification creates and consumes outside workforce context', async () => {
    const h = fixture({ plugins: [twoFactor()] })
    await createVerification(h.adapter)
    await consumeChallenge(h.adapter)
    expect(reserveWorkforcePasswordChallenge).not.toHaveBeenCalled()
    expect(armWorkforceConsumedChallenge).not.toHaveBeenCalled()
    expect(takeWorkforceConsumedChallenge).not.toHaveBeenCalled()
    expect(getWorkforceOperation).not.toHaveBeenCalled()
    for (const [, args] of h.ctx.runMutation.mock.calls) {
      expect(args).not.toHaveProperty('workforce')
      expect(args).not.toHaveProperty('workforceConsumedChallenge')
    }
  })

  it('forwards confirmation metadata on updateOne without changing the provider patch', async () => {
    const h = fixture()
    const operation: WorkforceOperation = {
      operation: 'confirm-enrollment',
      userId: recovery.userId,
      expectedGeneration: 5,
      sessionId: 'restricted-session',
    }
    vi.mocked(getWorkforceOperation).mockResolvedValue(operation)
    await h.adapter.update({
      model: 'twoFactor',
      where: [{ field: 'id', value: 'factor-id' }],
      update: { verified: true },
    })
    expect(h.ctx.runMutation).toHaveBeenCalledWith(
      h.references.updateOne,
      expect.objectContaining({
        workforce: operation,
        where: [expect.objectContaining({ field: 'id', value: 'factor-id' })],
        update: { verified: true },
      }),
    )
  })

  it('preserves the recovery-code CAS guards and empty increment in one mutation', async () => {
    const h = fixture()
    vi.mocked(getWorkforceOperation).mockResolvedValue(recovery)
    await consumeRecoveryCode(h.adapter)
    expect(h.ctx.runQuery).not.toHaveBeenCalled()
    expect(h.ctx.runMutation).toHaveBeenCalledOnce()
    expect(h.ctx.runMutation).toHaveBeenCalledWith(h.references.incrementOne, {
      model: 'twoFactor',
      where: [
        { field: 'id', value: 'factor-id', operator: 'eq', connector: 'AND', mode: 'sensitive' },
        {
          field: 'backupCodes',
          value: 'synthetic-old-encrypted-codes',
          operator: 'eq',
          connector: 'AND',
          mode: 'sensitive',
        },
      ],
      increment: {},
      set: { backupCodes: 'synthetic-new-encrypted-codes' },
      onUpdateHandle: undefined,
      workforce: recovery,
    })
  })

  it('omits the argument when a workforce adapter has no endpoint operation', async () => {
    const h = fixture()
    await createSession(h.adapter)
    await h.adapter.update({
      model: 'twoFactor',
      where: [{ field: 'id', value: 'factor-id' }],
      update: { verified: true },
    })
    await consumeRecoveryCode(h.adapter)
    expect(h.ctx.runMutation).toHaveBeenCalledTimes(3)
    for (const [, args] of h.ctx.runMutation.mock.calls)
      expect(args).not.toHaveProperty('workforce')
  })

  it('does not read or transmit operation metadata for ordinary auth', async () => {
    const h = fixture({ plugins: [twoFactor()] })
    vi.mocked(getWorkforceOperation).mockResolvedValue(recovery)
    await createSession(h.adapter)
    await h.adapter.update({
      model: 'twoFactor',
      where: [{ field: 'id', value: 'factor-id' }],
      update: { verified: true },
    })
    await consumeRecoveryCode(h.adapter)
    expect(getWorkforceOperation).not.toHaveBeenCalled()
    for (const [, args] of h.ctx.runMutation.mock.calls)
      expect(args).not.toHaveProperty('workforce')
  })

  it('does not read request metadata for an unrelated bulk profile update', async () => {
    const h = fixture()
    vi.mocked(getWorkforceOperation).mockResolvedValue(recovery)
    await h.adapter.updateMany({
      model: 'user',
      where: [{ field: 'id', value: recovery.userId }],
      update: { name: 'Updated name' },
    })
    expect(getWorkforceOperation).not.toHaveBeenCalled()
    expect(h.ctx.runMutation.mock.calls[0]?.[1]).not.toHaveProperty('workforce')
  })

  it('ignores caller-supplied operation properties on adapter inputs', async () => {
    const h = fixture()
    vi.mocked(getWorkforceOperation).mockResolvedValue(recovery)
    const input = {
      model: 'twoFactor',
      where: [{ field: 'id', value: 'factor-id' }],
      update: { verified: true },
      workforce: { ...recovery, expectedGeneration: 999 },
    }
    await h.adapter.update(input)
    expect(h.ctx.runMutation.mock.calls[0]?.[1].workforce).toEqual(recovery)
  })

  it.each<BetterAuthOptions>([
    { plugins: [{ id: workforceSchemaPlugin.id }] },
    { plugins: [twoFactor(), workforceSchemaPlugin] },
    { ...workforceOptions, session: { additionalFields: {} } },
  ])('rejects a present workforce plugin without its complete schema', (options) => {
    expect(() => fixture(options)).toThrow('AUTH_WORKFORCE_SCHEMA_MISMATCH')
  })
})
