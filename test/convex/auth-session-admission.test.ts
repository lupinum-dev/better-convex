/// <reference types="vite/client" />

import { convexTest } from 'convex-test'
import { componentsGeneric, type ApiFromModules, type FunctionArgs } from 'convex/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComponentApi } from '../../src/runtime/convex-auth/component/_generated/component'
import ordinarySchema from '../../src/runtime/convex-auth/component/schema'
import { createAuthComponent } from '../../src/runtime/convex-auth/create-auth-component'
import { INTERNAL_SESSION_HEADER } from '../../src/runtime/convex-auth/internal-session'
import { workforceSessionPolicy } from '../../src/runtime/convex-auth/workforce/operations'
import schema from '../fixtures/workforce-component/convex/betterAuth/schema'
import type * as seed from '../fixtures/workforce-component/convex/betterAuth/seed'
import rootSchema from '../fixtures/workforce-root/convex/schema'

const rootModules = import.meta.glob('../fixtures/workforce-root/convex/**/*.ts')
const workforceModules = import.meta.glob(
  '../fixtures/workforce-component/convex/betterAuth/**/*.ts',
)
const ordinaryModules = import.meta.glob('../../src/runtime/convex-auth/component/**/*.ts')
const components = componentsGeneric() as unknown as {
  workforceAuth: ComponentApi<'workforceAuth'> & ApiFromModules<{ seed: typeof seed }>
  ordinaryAuth: ComponentApi<'ordinaryAuth'>
}
const now = 1_700_000_000_000
const identity = { subject: 'user', sid: 'session', token_use: 'convex-session' }
const user = {
  id: 'user',
  name: 'User',
  email: 'user@example.test',
  emailVerified: true,
  image: null,
  createdAt: now,
  updatedAt: now,
}
const session = {
  id: 'session',
  userId: user.id,
  token: 'synthetic-session',
  createdAt: now,
  updatedAt: now,
  expiresAt: now + 60_000,
  ipAddress: null,
  userAgent: null,
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
})
afterEach(() => vi.useRealTimers())

async function init({
  userPatch = {},
  sessionPatch = {},
}: {
  userPatch?: Partial<FunctionArgs<typeof components.workforceAuth.seed.user>['data']>
  sessionPatch?: Partial<FunctionArgs<typeof components.workforceAuth.seed.session>['data']>
} = {}) {
  const test = convexTest(rootSchema, rootModules)
  test.registerComponent('workforceAuth', schema, workforceModules)
  await test.mutation(components.workforceAuth.seed.user, {
    data: { ...user, twoFactorEnabled: true, bcnSecurityGeneration: 5, ...userPatch },
  })
  await test.mutation(components.workforceAuth.seed.session, {
    data: {
      ...session,
      bcnAssuranceGeneration: 5,
      bcnAssuranceMethod: 'password-totp',
      bcnAuthenticatedAt: now,
      bcnSessionStartedAt: now,
      ...sessionPatch,
    },
  })
  const client = test.withIdentity(identity)
  const helper = createAuthComponent(components.workforceAuth)
  const createAuth = vi.fn(async () => ({}))
  const assertDenied = async () => {
    expect(await client.query((ctx) => helper.safeGetAuthUser(ctx))).toBeNull()
    await expect(client.query((ctx) => helper.getAuthUser(ctx))).rejects.toThrow('Unauthenticated')
    await expect(client.mutation((ctx) => helper.getAuth(createAuth, ctx))).rejects.toThrow(
      'Unauthenticated',
    )
    expect(createAuth).not.toHaveBeenCalled()
  }
  return { test, client, helper, createAuth, assertDenied }
}

describe('backend helpers use canonical component admission', () => {
  it('accepts full assurance through existing helpers without a workforce option', async () => {
    const { client, helper, createAuth } = await init()
    expect(await client.query((ctx) => helper.safeGetAuthUser(ctx))).toMatchObject(user)
    expect(await client.query((ctx) => helper.getAuthUser(ctx))).toMatchObject(user)
    const headers = await client.mutation(async (ctx) => {
      const admitted = await helper.getAuth(createAuth, ctx)
      return {
        authorization: admitted.headers.get('authorization'),
        internal: admitted.headers.get(INTERNAL_SESSION_HEADER),
      }
    })
    expect(headers).toEqual({ authorization: `Bearer ${session.token}`, internal: '1' })
    expect(createAuth).toHaveBeenCalledOnce()
  })

  it.each(['password-only', 'totp-enrollment', 'password-recovery', 'none'])(
    'denies %s through every backend helper',
    async (bcnAssuranceMethod) => {
      const { assertDenied } = await init({ sessionPatch: { bcnAssuranceMethod } })
      await assertDenied()
    },
  )

  it.each([
    { userPatch: { emailVerified: false } },
    { userPatch: { bcnSecurityGeneration: 6 } },
    { sessionPatch: { bcnAssuranceGeneration: 0 } },
    { sessionPatch: { expiresAt: now } },
    { sessionPatch: { bcnAuthenticatedAt: now + 1 } },
    { sessionPatch: { bcnSessionStartedAt: now - workforceSessionPolicy.absoluteLifetimeMs } },
  ])('denies invalid live authority %j through every backend helper', async (patch) => {
    const { assertDenied } = await init(patch)
    await assertDenied()
  })

  it.each(['user', 'session'])(
    'rechecks canonical %s deletion with the same identity',
    async (model) => {
      const { test, client, helper, assertDenied } = await init()
      expect(await client.query((ctx) => helper.safeGetAuthUser(ctx))).not.toBeNull()
      await test.mutation(components.workforceAuth.adapter.deleteOne, {
        model,
        where: [{ field: 'id', value: model === 'user' ? user.id : session.id }],
      })
      await assertDenied()
    },
  )

  it.each([
    { ...identity, subject: 'other' },
    { ...identity, sid: 'missing' },
    { ...identity, sid: '' },
    { subject: 'user', token_use: 'convex-session' },
    { ...identity, token_use: 'oauth-access' },
  ])('does not treat identity claims as assurance %j', async (claims) => {
    const { test, helper, createAuth } = await init()
    const client = test.withIdentity(claims)
    expect(await client.query((ctx) => helper.safeGetAuthUser(ctx))).toBeNull()
    await expect(client.query((ctx) => helper.getAuthUser(ctx))).rejects.toThrow('Unauthenticated')
    await expect(client.mutation((ctx) => helper.getAuth(createAuth, ctx))).rejects.toThrow(
      'Unauthenticated',
    )
    expect(createAuth).not.toHaveBeenCalled()
  })

  it('rejects anonymous access', async () => {
    const { test, helper } = await init()
    expect(await test.query((ctx) => helper.safeGetAuthUser(ctx))).toBeNull()
    await expect(test.query((ctx) => helper.getAuthUser(ctx))).rejects.toThrow('Unauthenticated')
  })

  it('preserves ordinary-schema helpers without requiring workforce fields or verified email', async () => {
    const test = convexTest(rootSchema, rootModules)
    test.registerComponent('ordinaryAuth', ordinarySchema, ordinaryModules)
    await test.mutation(components.ordinaryAuth.adapter.create, {
      model: 'user',
      data: { ...user, emailVerified: false },
    })
    await test.mutation(components.ordinaryAuth.adapter.create, { model: 'session', data: session })
    const helper = createAuthComponent(components.ordinaryAuth)
    const client = test.withIdentity(identity)
    expect(await client.query((ctx) => helper.getAuthUser(ctx))).toMatchObject({
      ...user,
      emailVerified: false,
    })
    expect(
      await client.mutation(async (ctx) =>
        (await helper.getAuth(async () => ({}), ctx)).headers.get('authorization'),
      ),
    ).toBe(`Bearer ${session.token}`)
  })
})
