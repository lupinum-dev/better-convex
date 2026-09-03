import { getCurrentAuthContext, runWithEndpointContext } from '@better-auth/core/context'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { createAuthEndpoint, createAuthMiddleware } from 'better-auth/api'
import { describe, expect, it, vi } from 'vitest'

import type { WorkforceOperation } from '../../src/runtime/convex-auth/workforce/operations'
import {
  armWorkforceConsumedChallenge,
  getWorkforceOperation,
  relayWorkforceSession,
  reserveWorkforcePasswordChallenge,
  setWorkforceOperation,
  takeWorkforceConsumedChallenge,
} from '../../src/runtime/convex-auth/workforce/request-context'

const first: WorkforceOperation = {
  operation: 'confirm-enrollment',
  userId: 'first-user',
  sessionId: 'first-session',
  expectedGeneration: 3,
}
const second: WorkforceOperation = {
  operation: 'confirm-enrollment',
  userId: 'second-user',
  sessionId: 'second-session',
  expectedGeneration: 7,
}

function fixture(
  options: {
    before?: (path: string) => Promise<void>
    handle?: (path: string) => Promise<void>
  } = {},
) {
  const probe = (path: string) =>
    createAuthEndpoint(path, { method: 'POST' }, async (ctx) => {
      await options.handle?.(path)
      return ctx.json(await getWorkforceOperation())
    })
  return betterAuth({
    baseURL: 'https://workforce-context.example.test',
    secret: 'synthetic-request-context-test-secret-more-than-32-characters',
    database: memoryAdapter({}),
    logger: { disabled: true },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        await options.before?.(ctx.path)
      }),
    },
    plugins: [
      {
        id: 'test-workforce-context',
        endpoints: {
          first: probe('/context-first'),
          second: probe('/context-second'),
          blank: probe('/context-blank'),
        },
      },
    ],
  })
}

describe('workforce operation request context', () => {
  it('grants no authority outside a provider endpoint scope', async () => {
    expect(await getWorkforceOperation()).toBeNull()
    await expect(setWorkforceOperation(first)).rejects.toThrow('AUTH_WORKFORCE_CONTEXT_REQUIRED')
    await expect(relayWorkforceSession({ id: 'new', userId: first.userId })).rejects.toThrow(
      'AUTH_WORKFORCE_CONTEXT_REQUIRED',
    )
  })

  it('does not bind from caller body or headers, even inside a real HTTP endpoint', async () => {
    const auth = fixture()
    const response = await auth.handler(
      new Request('https://workforce-context.example.test/api/auth/context-blank', {
        method: 'POST',
        headers: {
          origin: 'https://workforce-context.example.test',
          'content-type': 'application/json',
          'x-workforce-operation': JSON.stringify(first),
        },
        body: JSON.stringify(first),
      }),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toBeNull()
  })

  it('isolates simultaneous endpoints on one auth instance', async () => {
    const ready = Promise.withResolvers<null>()
    let entered = 0
    const auth = fixture({
      before: async (path) => {
        await setWorkforceOperation(path === '/context-first' ? first : second)
        entered += 1
        if (entered === 2) ready.resolve(null)
        await ready.promise
      },
    })
    expect(await Promise.all([auth.api.first(), auth.api.second()])).toEqual([first, second])
    expect(await getWorkforceOperation()).toBeNull()
  })

  it('does not leak an outer binding into nested endpoints sharing provider request state', async () => {
    const auth = fixture({
      before: async (path) => {
        if (path === '/context-first') await setWorkforceOperation(first)
        if (path === '/context-second') await setWorkforceOperation(second)
      },
      handle: async (path) => {
        if (path !== '/context-first') return
        expect(await auth.api.blank()).toBeNull()
        expect(await auth.api.second()).toEqual(second)
        expect(await getWorkforceOperation()).toEqual(first)
      },
    })
    expect(await auth.api.first()).toEqual(first)
    expect(await auth.api.blank()).toBeNull()
  })

  it('does not transfer authority through a cloned endpoint context', async () => {
    const auth = fixture({
      before: async () => {
        await setWorkforceOperation(first)
        const original = await getCurrentAuthContext()
        await runWithEndpointContext(
          { ...original, context: { ...original.context } },
          async () => {
            expect(await getWorkforceOperation()).toBeNull()
            await setWorkforceOperation(second)
            expect(await getWorkforceOperation()).toEqual(second)
          },
        )
        expect(await getWorkforceOperation()).toEqual(first)
      },
    })
    expect(await auth.api.first()).toEqual(first)
  })

  it('copies and freezes the operation and rejects rebinding in the same endpoint', async () => {
    const mutable = { ...first }
    const auth = fixture({
      before: async () => {
        await setWorkforceOperation(mutable)
        mutable.expectedGeneration = 99
        const bound = await getWorkforceOperation()
        expect(Object.isFrozen(bound)).toBe(true)
        await expect(setWorkforceOperation(second)).rejects.toThrow(
          'AUTH_WORKFORCE_OPERATION_ALREADY_BOUND',
        )
      },
    })
    expect(await auth.api.first()).toEqual(first)
  })

  it('relays only the session ID while preserving owner, operation and generation', async () => {
    const auth = fixture({
      before: async () => {
        await setWorkforceOperation(first)
        await relayWorkforceSession({ id: 'restricted-successor', userId: first.userId })
      },
    })
    expect(await auth.api.first()).toEqual({ ...first, sessionId: 'restricted-successor' })
  })

  it.each(['', '   '])('rejects an empty successor ID %j', async (id) => {
    const auth = fixture({
      before: async () => {
        await setWorkforceOperation(first)
        await expect(relayWorkforceSession({ id, userId: first.userId })).rejects.toThrow(
          'AUTH_WORKFORCE_RELAY_INVALID',
        )
      },
    })
    expect(await auth.api.first()).toEqual(first)
  })

  it('rejects another user and leaves the existing binding unchanged', async () => {
    const auth = fixture({
      before: async () => {
        await setWorkforceOperation(first)
        await expect(relayWorkforceSession({ id: 'new', userId: second.userId })).rejects.toThrow(
          'AUTH_WORKFORCE_RELAY_INVALID',
        )
      },
    })
    expect(await auth.api.first()).toEqual(first)
  })

  it.each<WorkforceOperation>([
    { ...first, operation: 'begin-enrollment' },
    { ...first, operation: 'regenerate-backup-codes' },
    { operation: 'password-sign-in', userId: first.userId, expectedGeneration: 3 },
    {
      operation: 'totp-sign-in',
      userId: first.userId,
      expectedGeneration: 3,
      challengeId: 'challenge',
    },
    {
      operation: 'recovery-sign-in',
      userId: first.userId,
      expectedGeneration: 3,
      challengeId: 'challenge',
    },
  ])('does not relay $operation', async (operation) => {
    const auth = fixture({
      before: async () => {
        await setWorkforceOperation(operation)
        await expect(relayWorkforceSession({ id: 'new', userId: first.userId })).rejects.toThrow(
          'AUTH_WORKFORCE_RELAY_INVALID',
        )
      },
    })
    expect(await auth.api.first()).toEqual(operation)
  })

  it('does not relay an endpoint with no binding', async () => {
    const auth = fixture({
      before: async () => {
        await expect(relayWorkforceSession({ id: 'new', userId: first.userId })).rejects.toThrow(
          'AUTH_WORKFORCE_RELAY_INVALID',
        )
      },
    })
    expect(await auth.api.first()).toBeNull()
  })
})

const mfa = {
  operation: 'totp-sign-in',
  userId: 'receipt-user',
  expectedGeneration: 4,
  challengeId: 'primary-challenge',
} satisfies WorkforceOperation

function consumedRow() {
  return {
    id: mfa.challengeId,
    value: mfa.userId,
    bcnAssuranceGeneration: mfa.expectedGeneration,
    expiresAt: Date.now() + 60_000,
  }
}

async function inOperation(operation: WorkforceOperation, handle: () => Promise<void>) {
  const auth = fixture({
    before: async () => setWorkforceOperation(operation),
    handle,
  })
  await auth.api.first()
}

describe('one-use workforce consumed challenge receipt', () => {
  it('grants no receipt without endpoint scope or without an MFA binding', async () => {
    await armWorkforceConsumedChallenge(consumedRow())
    expect(await takeWorkforceConsumedChallenge(mfa.userId)).toBeNull()
    await inOperation(first, async () => {
      await armWorkforceConsumedChallenge(consumedRow())
      expect(await takeWorkforceConsumedChallenge(mfa.userId)).toBeNull()
    })
  })

  it.each(['totp-sign-in', 'recovery-sign-in'] as const)(
    'returns a frozen matching %s receipt once without changing the operation',
    async (operation) => {
      const bound = { ...mfa, operation }
      await inOperation(bound, async () => {
        const row = consumedRow()
        await armWorkforceConsumedChallenge(row)
        const receipt = await takeWorkforceConsumedChallenge(mfa.userId)
        expect(receipt).toEqual({ ...bound, expiresAt: row.expiresAt })
        expect(Object.isFrozen(receipt)).toBe(true)
        expect(await getWorkforceOperation()).toEqual(bound)
        await expect(takeWorkforceConsumedChallenge(mfa.userId)).rejects.toThrow(
          'AUTH_WORKFORCE_CHALLENGE_RECEIPT_REQUIRED',
        )
        await expect(armWorkforceConsumedChallenge(row)).rejects.toThrow(
          'AUTH_WORKFORCE_CHALLENGE_ALREADY_RECORDED',
        )
      })
    },
  )

  it('ignores null, companion, and unrelated rows without consuming the receipt slot', async () => {
    await inOperation(mfa, async () => {
      for (const row of [
        null,
        { id: 'attempts', value: '0' },
        { id: 'other', value: mfa.userId },
      ]) {
        await armWorkforceConsumedChallenge(row)
      }
      await armWorkforceConsumedChallenge(consumedRow())
      expect(await takeWorkforceConsumedChallenge(mfa.userId)).toMatchObject(mfa)
    })
  })

  it.each([
    { value: 'other-user' },
    { bcnAssuranceGeneration: 3 },
    { bcnAssuranceGeneration: undefined },
    { expiresAt: 0 },
    { expiresAt: -1 },
    { expiresAt: Number.NaN },
    { expiresAt: Number.POSITIVE_INFINITY },
    { expiresAt: Number.MAX_SAFE_INTEGER + 1 },
    { expiresAt: new Date() },
    { expiresAt: String(Date.now() + 60_000) },
  ])('rejects malformed matching primary data and prevents repair %j', async (patch) => {
    await inOperation(mfa, async () => {
      await expect(armWorkforceConsumedChallenge({ ...consumedRow(), ...patch })).rejects.toThrow(
        'AUTH_WORKFORCE_CONSUMED_CHALLENGE_INVALID',
      )
      await expect(armWorkforceConsumedChallenge(consumedRow())).rejects.toThrow(
        'AUTH_WORKFORCE_CHALLENGE_ALREADY_RECORDED',
      )
      await expect(takeWorkforceConsumedChallenge(mfa.userId)).rejects.toThrow(
        'AUTH_WORKFORCE_CHALLENGE_RECEIPT_REQUIRED',
      )
    })
  })

  it('rejects expiry at the exact current boundary', async () => {
    await inOperation(mfa, async () => {
      await expect(
        armWorkforceConsumedChallenge({ ...consumedRow(), expiresAt: Date.now() }),
      ).rejects.toThrow('AUTH_WORKFORCE_CONSUMED_CHALLENGE_INVALID')
    })
  })

  it('rejects repeated arming before a take', async () => {
    await inOperation(mfa, async () => {
      await armWorkforceConsumedChallenge(consumedRow())
      await expect(armWorkforceConsumedChallenge(consumedRow())).rejects.toThrow(
        'AUTH_WORKFORCE_CHALLENGE_ALREADY_RECORDED',
      )
    })
  })

  it('burns a receipt that expires between consume and session insert', async () => {
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    try {
      await inOperation(mfa, async () => {
        await armWorkforceConsumedChallenge({ ...consumedRow(), expiresAt: now + 100 })
        clock.mockReturnValue(now + 100)
        await expect(takeWorkforceConsumedChallenge(mfa.userId)).rejects.toThrow(
          'AUTH_WORKFORCE_CHALLENGE_RECEIPT_REQUIRED',
        )
        await expect(armWorkforceConsumedChallenge(consumedRow())).rejects.toThrow(
          'AUTH_WORKFORCE_CHALLENGE_ALREADY_RECORDED',
        )
      })
    } finally {
      clock.mockRestore()
    }
  })

  it('burns a missing receipt and rejects late arming', async () => {
    await inOperation(mfa, async () => {
      await expect(takeWorkforceConsumedChallenge(mfa.userId)).rejects.toThrow(
        'AUTH_WORKFORCE_CHALLENGE_RECEIPT_REQUIRED',
      )
      await expect(armWorkforceConsumedChallenge(consumedRow())).rejects.toThrow(
        'AUTH_WORKFORCE_CHALLENGE_ALREADY_RECORDED',
      )
    })
  })

  it('burns the receipt on a wrong session owner', async () => {
    await inOperation(mfa, async () => {
      await armWorkforceConsumedChallenge(consumedRow())
      await expect(takeWorkforceConsumedChallenge('other-user')).rejects.toThrow(
        'AUTH_WORKFORCE_CHALLENGE_RECEIPT_REQUIRED',
      )
      await expect(takeWorkforceConsumedChallenge(mfa.userId)).rejects.toThrow(
        'AUTH_WORKFORCE_CHALLENGE_RECEIPT_REQUIRED',
      )
    })
  })

  it('admits only one concurrent take before the caller can await an insert', async () => {
    await inOperation(mfa, async () => {
      await armWorkforceConsumedChallenge(consumedRow())
      const results = await Promise.allSettled([
        takeWorkforceConsumedChallenge(mfa.userId),
        takeWorkforceConsumedChallenge(mfa.userId),
      ])
      expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected'])
    })
  })

  it('does not expose an outer receipt to a nested endpoint or preserve it after an abort', async () => {
    const auth = fixture({
      before: async (path) => {
        if (path === '/context-first') {
          await setWorkforceOperation(mfa)
          await armWorkforceConsumedChallenge(consumedRow())
        }
      },
      handle: async (path) => {
        if (path === '/context-first') {
          expect(await auth.api.blank()).toBeNull()
          throw new Error('Synthetic provider abort after primary consumption')
        }
        expect(await takeWorkforceConsumedChallenge(mfa.userId)).toBeNull()
      },
    })
    await expect(auth.api.first()).rejects.toThrow('Synthetic provider abort')
    expect(await auth.api.blank()).toBeNull()
  })
})

describe('primary workforce password challenge reservation', () => {
  const password: WorkforceOperation = {
    operation: 'password-sign-in',
    userId: '0',
    expectedGeneration: 2,
  }

  it('reserves one primary before dispatch even when the attempts value equals the user ID', async () => {
    await inOperation(password, async () => {
      expect(await reserveWorkforcePasswordChallenge({ id: 'primary', value: '0' })).toEqual({
        ...password,
        operation: 'password-challenge',
        challengeId: 'primary',
      })
      // A failed/unknown component response must not reopen the reservation.
      await Promise.resolve()
      expect(await reserveWorkforcePasswordChallenge({ id: 'attempts', value: '0' })).toBeNull()
      expect(await reserveWorkforcePasswordChallenge({ id: 'retry', value: '0' })).toBeNull()
      expect(await getWorkforceOperation()).toEqual(password)
    })
  })

  it('admits only one concurrent primary reservation', async () => {
    await inOperation(password, async () => {
      const results = await Promise.all([
        reserveWorkforcePasswordChallenge({ id: 'primary-a', value: '0' }),
        reserveWorkforcePasswordChallenge({ id: 'primary-b', value: '0' }),
      ])
      expect(results.filter(Boolean)).toHaveLength(1)
    })
  })

  it('ignores unrelated values and scopes without reserving', async () => {
    expect(await reserveWorkforcePasswordChallenge({ id: 'primary', value: '0' })).toBeNull()
    await inOperation(first, async () => {
      expect(await reserveWorkforcePasswordChallenge({ id: 'primary', value: '0' })).toBeNull()
    })
    await inOperation(password, async () => {
      expect(
        await reserveWorkforcePasswordChallenge({ id: 'unrelated', value: 'different' }),
      ).toBeNull()
      expect(await reserveWorkforcePasswordChallenge({ id: 'primary', value: '0' })).not.toBeNull()
    })
  })

  it.each([undefined, '', ' ', ' padded ', 4])(
    'validates the primary logical ID before reservation %j',
    async (id) => {
      await inOperation(password, async () => {
        await expect(reserveWorkforcePasswordChallenge({ id, value: '0' })).rejects.toThrow(
          'AUTH_WORKFORCE_PASSWORD_CHALLENGE_INVALID',
        )
      })
    },
  )

  it('does not accept the derived challenge operation as an endpoint binding', async () => {
    const auth = fixture({
      before: async () => {
        await expect(
          setWorkforceOperation({
            ...password,
            operation: 'password-challenge',
            challengeId: 'primary',
          }),
        ).rejects.toThrow('AUTH_WORKFORCE_DERIVED_OPERATION_FORBIDDEN')
      },
    })
    expect(await auth.api.first()).toBeNull()
  })
})
