/// <reference types="vite/client" />

import { convexTest } from 'convex-test'
import {
  componentsGeneric,
  makeFunctionReference,
  type ApiFromModules,
  type FunctionArgs,
} from 'convex/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComponentApi } from '../../src/runtime/convex-auth/component/_generated/component'
import { workforceSessionPolicy } from '../../src/runtime/convex-auth/workforce/operations'
import { getWorkforceSessionAssurance } from '../../src/runtime/convex-auth/workforce/session-assurance'
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
const whereId = (id: string) => [{ field: 'id', value: id }]

function init() {
  const test = convexTest(rootSchema, rootModules)
  test.registerComponent('workforceAuth', schema, authModules)
  return test
}

type Test = ReturnType<typeof init>

function user(test: Test, id = 'user', generation = 0) {
  const data = {
    id,
    name: id,
    email: `${id}@example.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
    bcnSecurityGeneration: generation,
    image: null,
    twoFactorEnabled: null,
  }
  return generation === 0
    ? test.mutation(auth.create, { model: 'user', data })
    : test.mutation(components.workforceAuth.seed.user, { data })
}

function account(test: Test, id = 'password', owner = 'user', provider = 'credential') {
  return test.mutation(auth.create, {
    model: 'account',
    data: {
      id,
      issuer: provider,
      accountId: id,
      providerId: provider,
      userId: owner,
      password: provider === 'credential' ? 'hash-initial' : null,
      createdAt: now,
      updatedAt: now,
    },
  })
}

function find(test: Test, model: string, id: string) {
  return test.query(auth.findOne, { model, where: whereId(id) })
}

async function expectGeneration(test: Test, generation: number, id = 'user') {
  expect(await find(test, 'user', id)).toMatchObject({ bcnSecurityGeneration: generation })
}

describe('authenticated password-change actor validation', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(now)
  })
  afterEach(() => vi.restoreAllMocks())

  const operation = {
    operation: 'change-password',
    userId: 'user',
    sessionId: 'approved-session',
    expectedGeneration: 1,
  } as const

  async function initChange(
    sessionPatch: Partial<FunctionArgs<typeof components.workforceAuth.seed.session>['data']> = {},
  ) {
    const test = init()
    await user(test)
    await account(test)
    await test.mutation(components.workforceAuth.seed.session, {
      data: {
        id: operation.sessionId,
        userId: operation.userId,
        token: 'test-only-password-change-session',
        createdAt: now,
        updatedAt: now,
        expiresAt: now + 60_000,
        bcnAssuranceGeneration: operation.expectedGeneration,
        bcnAssuranceMethod: 'password-totp',
        bcnAuthenticatedAt: now,
        bcnSessionStartedAt: now,
        ipAddress: null,
        userAgent: null,
        ...sessionPatch,
      },
    })
    const change = () =>
      test.mutation(auth.updateOne, {
        model: 'account',
        where: whereId('password'),
        update: { password: 'hash-authenticated-change' },
        workforce: operation,
      })
    return { test, change }
  }

  it('changes the credential and invalidates sessions under current fresh full assurance', async () => {
    const { test, change } = await initChange()
    expect(await change()).toMatchObject({ password: 'hash-authenticated-change' })
    await expectGeneration(test, 2)
    await expect(change()).resolves.toMatchObject({ password: 'hash-authenticated-change' })
    await expectGeneration(test, 2)
  })

  it('rejects a password change admitted before a completed reset and preserves the recovered credential', async () => {
    const { test, change } = await initChange()
    // The request captured operation at generation 1 before provider password
    // verification. Reset commits before that request's final credential write.
    await test.mutation(auth.updateMany, {
      model: 'account',
      where: whereId('password'),
      update: { password: 'hash-recovered' },
    })
    await expectGeneration(test, 2)
    await expect(change()).rejects.toThrow('AUTH_WORKFORCE_PASSWORD_CHANGE_AUTH_REQUIRED')
    expect(await find(test, 'account', 'password')).toMatchObject({ password: 'hash-recovered' })
    await expectGeneration(test, 2)
  })

  it('rejects a revoked initiating session before credential mutation', async () => {
    const { test, change } = await initChange()
    await test.mutation(auth.deleteOne, { model: 'session', where: whereId(operation.sessionId) })
    await expect(change()).rejects.toThrow('AUTH_WORKFORCE_PASSWORD_CHANGE_AUTH_REQUIRED')
    expect(await find(test, 'account', 'password')).toMatchObject({ password: 'hash-initial' })
    await expectGeneration(test, 1)
  })

  it.each([
    { bcnAssuranceMethod: 'password-only' },
    { bcnAssuranceMethod: 'password-recovery' },
    { bcnAssuranceMethod: 'totp-enrollment' },
    { bcnAssuranceGeneration: 0 },
    { expiresAt: now },
    { bcnAuthenticatedAt: now + 1 },
    {
      bcnAuthenticatedAt: now - workforceSessionPolicy.freshAuthenticationMs,
      bcnSessionStartedAt: now - workforceSessionPolicy.freshAuthenticationMs,
    },
    { bcnSessionStartedAt: now - workforceSessionPolicy.absoluteLifetimeMs },
  ])('rejects insufficient initiating proof %j without invalidation', async (patch) => {
    const { test, change } = await initChange(patch)
    await expect(change()).rejects.toThrow('AUTH_WORKFORCE_PASSWORD_CHANGE_AUTH_REQUIRED')
    expect(await find(test, 'account', 'password')).toMatchObject({ password: 'hash-initial' })
    await expectGeneration(test, 1)
  })

  it('rejects a changed mailbox verification state at commit', async () => {
    const { test, change } = await initChange()
    await test.mutation(auth.updateOne, {
      model: 'user',
      where: whereId('user'),
      update: { emailVerified: false },
    })
    await expect(change()).rejects.toThrow('AUTH_WORKFORCE_PASSWORD_CHANGE_AUTH_REQUIRED')
    await expectGeneration(test, 1)
  })

  it('does not use one user’s full session to change another credential', async () => {
    const { test } = await initChange()
    await user(test, 'other')
    await account(test, 'other-password', 'other')
    await expect(
      test.mutation(auth.updateOne, {
        model: 'account',
        where: whereId('other-password'),
        update: { password: 'hash-authenticated-change' },
        workforce: operation,
      }),
    ).rejects.toThrow('AUTH_WORKFORCE_PASSWORD_CHANGE_INVALID')
    expect(await find(test, 'account', 'other-password')).toMatchObject({
      password: 'hash-initial',
    })
    await expectGeneration(test, 1, 'other')
  })
})

describe('workforce credential invalidation in the canonical component mutation', () => {
  it.each(['create', 'update', 'delete'] as const)(
    'rolls back the credential and generation when the post-%s trigger fails',
    async (operation) => {
      const test = init()
      await user(test)
      if (operation !== 'create') await account(test)
      const originalOwner = await find(test, 'user', 'user')
      const originalCredential = await find(test, 'account', 'password')
      const change = makeFunctionReference<'mutation', Record<string, never>, null>(
        `credentialHarness:${operation}WithRejectingTrigger`,
      )

      await expect(test.mutation(change, {})).rejects.toThrow(
        'AUTH_WORKFORCE_TRIGGER_FAULT_INJECTED',
      )

      expect(await find(test, 'user', 'user')).toEqual(originalOwner)
      expect(await find(test, 'account', 'password')).toEqual(originalCredential)
    },
  )

  it('makes a persisted proof fail the live predicate without deleting the session', async () => {
    const test = init()
    await user(test)
    await account(test)
    await test.mutation(components.workforceAuth.seed.session, {
      data: {
        id: 'approved-session',
        userId: 'user',
        token: 'test-only-session-token',
        createdAt: now,
        updatedAt: now,
        expiresAt: now + 60_000,
        bcnAssuranceGeneration: 1,
        bcnAssuranceMethod: 'password-totp',
        bcnAuthenticatedAt: now,
        bcnSessionStartedAt: now,
        ipAddress: null,
        userAgent: null,
      },
    })
    const session = await find(test, 'session', 'approved-session')
    const proof = async () =>
      getWorkforceSessionAssurance({
        user: await find(test, 'user', 'user'),
        session,
        now,
        absoluteLifetimeMs: 60_000,
      })
    expect(await proof()).toMatchObject({ method: 'password-totp', generation: 1 })
    await test.mutation(auth.updateMany, {
      model: 'account',
      where: whereId('password'),
      update: { password: 'hash-reset' },
    })
    expect(await proof()).toBeNull()
    expect(await find(test, 'session', 'approved-session')).toEqual(session)
  })

  it('serializes simultaneous password writes without losing an invalidation', async () => {
    const test = init()
    await user(test)
    await account(test)
    await Promise.all(
      ['hash-first', 'hash-second'].map((password) =>
        test.mutation(auth.updateOne, {
          model: 'account',
          where: whereId('password'),
          update: { password },
        }),
      ),
    )
    await expectGeneration(test, 3)
    expect(['hash-first', 'hash-second']).toContain(
      (await find(test, 'account', 'password'))?.password,
    )
  })

  it('rejects credential creation when the owner generation is invalid', async () => {
    for (const generation of [-1, 0.5, Number.MAX_SAFE_INTEGER]) {
      const test = init()
      await user(test, 'user', generation)
      await expect(account(test)).rejects.toThrow('AUTH_WORKFORCE_GENERATION_INVALID')
      expect(await find(test, 'account', 'password')).toBeNull()
      await expectGeneration(test, generation)
    }
  })

  it('advances on credential creation, not unrelated account/profile changes', async () => {
    const test = init()
    await user(test)
    await account(test, 'oauth', 'user', 'example-provider')
    await expectGeneration(test, 0)
    await account(test)
    await expectGeneration(test, 1)
    await test.mutation(auth.updateOne, {
      model: 'account',
      where: whereId('password'),
      update: { password: 'hash-initial', updatedAt: now + 1 },
    })
    await test.mutation(auth.updateOne, {
      model: 'account',
      where: whereId('oauth'),
      update: { accessToken: 'opaque-test-token' },
    })
    await expectGeneration(test, 1)
  })

  it.each(['updateOne', 'updateMany', 'incrementOne'] as const)(
    '%s binds the new hash and invalidation to one write',
    async (operation) => {
      const test = init()
      await user(test)
      await account(test)
      if (operation === 'incrementOne') {
        await test.mutation(auth.incrementOne, {
          model: 'account',
          where: whereId('password'),
          increment: {},
          set: { password: 'hash-reset' },
        })
      } else {
        await test.mutation(auth[operation], {
          model: 'account',
          where: whereId('password'),
          update: { password: 'hash-reset' },
        })
      }
      expect(await find(test, 'account', 'password')).toMatchObject({ password: 'hash-reset' })
      await expectGeneration(test, 2)
    },
  )

  it('invalidates both owners when a credential moves, and on provider changes', async () => {
    const test = init()
    await user(test)
    await user(test, 'other')
    await account(test)
    await test.mutation(auth.updateOne, {
      model: 'account',
      where: whereId('password'),
      update: { userId: 'other' },
    })
    await expectGeneration(test, 2)
    await expectGeneration(test, 1, 'other')
    await test.mutation(auth.updateOne, {
      model: 'account',
      where: whereId('password'),
      update: { providerId: 'example-provider' },
    })
    await expectGeneration(test, 2, 'other')
  })

  it.each(['deleteOne', 'deleteMany', 'consumeOne'] as const)(
    '%s invalidates a surviving credential owner',
    async (operation) => {
      const test = init()
      await user(test)
      await account(test)
      await test.mutation(auth[operation], { model: 'account', where: whereId('password') })
      expect(await find(test, 'account', 'password')).toBeNull()
      await expectGeneration(test, 2)
    },
  )

  it('does not invalidate for deleting a non-credential account', async () => {
    const test = init()
    await user(test)
    await account(test, 'oauth', 'user', 'example-provider')
    await test.mutation(auth.deleteOne, { model: 'account', where: whereId('oauth') })
    await expectGeneration(test, 0)
  })

  it('permits full user deletion even when its generation cannot advance', async () => {
    const test = init()
    await user(test, 'user', Number.MAX_SAFE_INTEGER - 1)
    await account(test)
    await test.mutation(auth.deleteOne, { model: 'user', where: whereId('user') })
    expect(await find(test, 'account', 'password')).toBeNull()
    expect(await find(test, 'user', 'user')).toBeNull()
  })

  it.each([
    'updateOne',
    'updateMany',
    'incrementOne',
    'deleteOne',
    'deleteMany',
    'consumeOne',
  ] as const)(
    '%s fails closed and preserves the credential when generation is exhausted',
    async (operation) => {
      const test = init()
      await user(test, 'user', Number.MAX_SAFE_INTEGER - 1)
      await account(test)
      const args = { model: 'account', where: whereId('password') }
      const change =
        operation === 'incrementOne'
          ? test.mutation(auth.incrementOne, {
              ...args,
              increment: {},
              set: { password: 'hash-reset' },
            })
          : operation === 'updateOne' || operation === 'updateMany'
            ? test.mutation(auth[operation], { ...args, update: { password: 'hash-reset' } })
            : test.mutation(auth[operation], args)
      await expect(change).rejects.toThrow('AUTH_WORKFORCE_GENERATION_INVALID')
      expect(await find(test, 'account', 'password')).toMatchObject({ password: 'hash-initial' })
      await expectGeneration(test, Number.MAX_SAFE_INTEGER)
    },
  )

  it('rolls back earlier writes when a later bulk credential invalidation fails', async () => {
    const test = init()
    await user(test)
    await user(test, 'exhausted', Number.MAX_SAFE_INTEGER - 1)
    await account(test, 'first')
    await account(test, 'second', 'exhausted')
    await expect(
      test.mutation(auth.updateMany, {
        model: 'account',
        where: [{ field: 'providerId', value: 'credential' }],
        update: { password: 'hash-reset' },
      }),
    ).rejects.toThrow('AUTH_WORKFORCE_GENERATION_INVALID')
    await expectGeneration(test, 1)
    await expectGeneration(test, Number.MAX_SAFE_INTEGER, 'exhausted')
    expect(await find(test, 'account', 'first')).toMatchObject({ password: 'hash-initial' })
    expect(await find(test, 'account', 'second')).toMatchObject({ password: 'hash-initial' })
  })

  it('does not invalidate an owner when a relationship or unique constraint fails', async () => {
    const test = init()
    await user(test)
    await account(test)
    await expect(account(test)).rejects.toThrow('AUTH_UNIQUE_CONFLICT')
    await expect(
      test.mutation(auth.updateOne, {
        model: 'account',
        where: whereId('password'),
        update: { userId: 'missing', password: 'hash-reset' },
      }),
    ).rejects.toThrow('AUTH_REFERENCE_TARGET_MISSING')
    await expectGeneration(test, 1)
    expect(await find(test, 'account', 'password')).toMatchObject({
      userId: 'user',
      password: 'hash-initial',
    })
  })

  it('rolls back all bulk deletions and invalidations when one owner cannot advance', async () => {
    const test = init()
    await user(test)
    await user(test, 'exhausted', Number.MAX_SAFE_INTEGER - 1)
    await account(test, 'first')
    await account(test, 'second', 'exhausted')
    await expect(
      test.mutation(auth.deleteMany, {
        model: 'account',
        where: [{ field: 'providerId', value: 'credential' }],
      }),
    ).rejects.toThrow('AUTH_WORKFORCE_GENERATION_INVALID')
    await expectGeneration(test, 1)
    await expectGeneration(test, Number.MAX_SAFE_INTEGER, 'exhausted')
    expect(await find(test, 'account', 'first')).not.toBeNull()
    expect(await find(test, 'account', 'second')).not.toBeNull()
  })
})
