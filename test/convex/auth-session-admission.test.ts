/// <reference types="vite/client" />

import { convexTest } from 'convex-test'
import { componentsGeneric, defineSchema } from 'convex/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComponentApi } from '../../src/runtime/convex-auth/component/_generated/component'
import authSchema from '../../src/runtime/convex-auth/component/schema'
import { createAuthComponent } from '../../src/runtime/convex-auth/create-auth-component'
import { INTERNAL_SESSION_HEADER } from '../../src/runtime/convex-auth/internal-session'
import { readAuthSessionAdmission } from '../../src/runtime/convex-auth/session-generation'

const rootModules = import.meta.glob('../fixtures/jwks-rotation/convex/**/*.ts')
const authModules = import.meta.glob('../../src/runtime/convex-auth/component/**/*.ts')
const rootSchema = defineSchema({})
const components = componentsGeneric() as unknown as {
  sessionAuth: ComponentApi<'sessionAuth'>
}
const auth = components.sessionAuth.adapter
const now = 1_700_000_000_000
const identity = { subject: 'user', sid: 'session', token_use: 'convex-session' }
const user = {
  id: 'user',
  name: 'User',
  email: 'user@example.test',
  emailVerified: false,
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

async function init() {
  const test = convexTest(rootSchema, rootModules)
  test.registerComponent('sessionAuth', authSchema, authModules)
  await test.mutation(auth.create, { model: 'user', data: user })
  await test.mutation(auth.create, { model: 'session', data: session })
  const client = test.withIdentity(identity)
  const helper = createAuthComponent(components.sessionAuth)
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
  it('admits a live session through every backend helper without requiring verified email', async () => {
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

  it('denies an expired session through every backend helper', async () => {
    const { assertDenied } = await init()
    vi.setSystemTime(session.expiresAt)
    await assertDenied()
  })

  it('denies a session whose user security generation advanced', async () => {
    const { test, assertDenied } = await init()
    await expect(
      test.mutation(auth.deleteMany, {
        model: 'session',
        where: [{ field: 'userId', value: user.id }],
      }),
    ).resolves.toBe(0)
    await assertDenied()
  })

  it.each(['user', 'session'])(
    'rechecks canonical %s deletion with the same identity',
    async (model) => {
      const { test, client, helper, assertDenied } = await init()
      expect(await client.query((ctx) => helper.safeGetAuthUser(ctx))).not.toBeNull()
      await test.mutation(auth.deleteOne, {
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
  ])('does not treat identity claims as admission %j', async (claims) => {
    const { test, helper, createAuth } = await init()
    const client = test.withIdentity(claims)
    expect(await client.query((ctx) => helper.safeGetAuthUser(ctx))).toBeNull()
    await expect(client.query((ctx) => helper.getAuthUser(ctx))).rejects.toThrow('Unauthenticated')
    await expect(client.mutation((ctx) => helper.getAuth(createAuth, ctx))).rejects.toThrow(
      'Unauthenticated',
    )
    expect(createAuth).not.toHaveBeenCalled()
  })

  it.each([
    { model: 'user', field: 'bcnSecurityGeneration', id: user.id },
    { model: 'session', field: 'bcnAssuranceGeneration', id: session.id },
  ])('keeps $model.$field out of generic adapter writes', async ({ model, field, id }) => {
    const { test, client, helper } = await init()
    const where = [{ field: 'id', value: id }]
    const owned = 'AUTH_SESSION_GENERATION_FIELDS_OWNED'
    await expect(
      test.mutation(auth.updateOne, { model, where, update: { [field]: 7 } }),
    ).rejects.toThrow(owned)
    await expect(
      test.mutation(auth.updateMany, { model, where, update: { [field]: 7 } }),
    ).rejects.toThrow(owned)
    await expect(
      test.mutation(auth.incrementOne, { model, where, increment: { [field]: 1 } }),
    ).rejects.toThrow(owned)
    expect(await client.query((ctx) => helper.safeGetAuthUser(ctx))).toMatchObject(user)
  })

  it('rejects anonymous access', async () => {
    const { test, helper } = await init()
    expect(await test.query((ctx) => helper.safeGetAuthUser(ctx))).toBeNull()
    await expect(test.query((ctx) => helper.getAuthUser(ctx))).rejects.toThrow('Unauthenticated')
  })

  it('revokes more than the bulk-delete limit atomically after a password reset', async () => {
    const test = convexTest(rootSchema, rootModules)
    test.registerComponent('sessionAuth', authSchema, authModules)
    await test.mutation(auth.create, { model: 'user', data: user })
    for (let index = 0; index < 129; index += 1) {
      await test.mutation(auth.create, {
        model: 'session',
        data: {
          ...session,
          id: `session-${index}`,
          token: `token-${index}`,
        },
      })
    }

    const staleIdentity = { ...identity, sid: 'session-128' }
    const staleClient = test.withIdentity(staleIdentity)
    const helper = createAuthComponent(components.sessionAuth)
    expect(await staleClient.query((ctx) => helper.safeGetAuthUser(ctx))).toMatchObject(user)

    await expect(
      test.mutation(auth.deleteMany, {
        model: 'session',
        where: [{ field: 'userId', value: user.id }],
      }),
    ).resolves.toBe(0)

    await expect(
      test.query(auth.findOne, {
        model: 'session',
        select: ['id'],
        where: [{ field: 'id', value: 'session-128' }],
      }),
    ).resolves.toBeNull()
    await expect(
      test.query(auth.findMany, {
        model: 'session',
        paginationOpts: { cursor: null, numItems: 200 },
        where: [{ field: 'userId', value: user.id }],
      }),
    ).resolves.toMatchObject({ page: [] })
    await expect(staleClient.query((ctx) => helper.safeGetAuthUser(ctx))).resolves.toBeNull()

    await test.mutation(auth.create, {
      model: 'session',
      data: { ...session, id: 'session-current', token: 'token-current' },
    })
    await expect(
      test.query(auth.findOne, {
        model: 'session',
        select: ['id'],
        where: [{ field: 'id', value: 'session-current' }],
      }),
    ).resolves.toEqual({ id: 'session-current' })
    const currentClient = test.withIdentity({ ...identity, sid: 'session-current' })
    await expect(currentClient.query((ctx) => helper.safeGetAuthUser(ctx))).resolves.toMatchObject(
      user,
    )
  })
})

describe('canonical session admission', () => {
  const generation = 5

  async function initRows() {
    const test = convexTest(authSchema, authModules)
    const ids = await test.run(async (ctx) => ({
      user: await ctx.db.insert('user', { ...user, bcnSecurityGeneration: generation }),
      session: await ctx.db.insert('session', {
        ...session,
        bcnAssuranceGeneration: generation,
      }),
    }))
    const read = (binding: { sessionId: string; userId?: string } = { sessionId: session.id }) =>
      test.run((ctx) => readAuthSessionAdmission(ctx, binding))
    return { test, ids, read }
  }

  it('returns the live canonical rows with optional exact user binding', async () => {
    const { read } = await initRows()
    expect(await read()).toMatchObject({ user, session })
    expect(await read({ sessionId: session.id, userId: user.id })).toMatchObject({ user, session })
  })

  it.each([
    { sessionId: '' },
    { sessionId: 'missing' },
    { sessionId: session.id, userId: '' },
    { sessionId: session.id, userId: 'other' },
  ])('denies missing session or mismatched identity %j', async (binding) => {
    const { read } = await initRows()
    expect(await read(binding)).toBeNull()
  })

  it.each(['user', 'session'] as const)('denies a deleted canonical %s', async (table) => {
    const { test, ids, read } = await initRows()
    expect(await read()).not.toBeNull()
    await test.run((ctx) => ctx.db.delete(ids[table]))
    expect(await read()).toBeNull()
  })

  it.each([
    { bcnSecurityGeneration: generation + 1 },
    { bcnSecurityGeneration: -1 },
    { bcnSecurityGeneration: 0.5 },
  ])('denies changed or malformed user authority %j', async (patch) => {
    const { test, ids, read } = await initRows()
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
  ])('denies malformed or expired session authority %j', async (patch) => {
    const { test, ids, read } = await initRows()
    await test.run((ctx) => ctx.db.patch('session', ids.session, patch))
    expect(await read()).toBeNull()
  })
})
