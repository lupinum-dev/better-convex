/// <reference types="vite/client" />

import type { jwt } from 'better-auth/plugins'
import { convexTest } from 'convex-test'
import { componentsGeneric, defineSchema } from 'convex/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComponentApi } from '../../src/runtime/convex-auth/component/_generated/component'
import authSchema from '../../src/runtime/convex-auth/component/schema'
import type { AuthCtx } from '../../src/runtime/convex-auth/context'
import {
  createAuthComponent,
  readSessionClaims,
} from '../../src/runtime/convex-auth/create-auth-component'
import { createBetterConvexAuth } from '../../src/runtime/convex-auth/create-better-convex-auth'
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

const UNAUTHENTICATED = { code: 'UNAUTHENTICATED', message: 'Authentication required' }

function countingQueries(ctx: AuthCtx) {
  const calls: unknown[] = []
  const counted = new Proxy(ctx, {
    get(target, property, receiver) {
      if (property === 'runQuery') {
        return (reference: unknown, args: unknown) => {
          calls.push(reference)
          return target.runQuery(reference as never, args as never)
        }
      }
      return Reflect.get(target, property, receiver)
    },
  })
  return { calls, counted }
}

async function init() {
  const test = convexTest(rootSchema, rootModules)
  test.registerComponent('sessionAuth', authSchema, authModules)
  await test.mutation(auth.create, { model: 'user', data: user })
  await test.mutation(auth.create, { model: 'session', data: session })
  const client = test.withIdentity(identity)
  const authApi = createBetterConvexAuth(components.sessionAuth)
  // getAuth is exercised through the internal owner so the Better Auth
  // construction can be observed without a live deployment environment.
  const helper = createAuthComponent(components.sessionAuth)
  const createAuth = vi.fn(async () => ({}))
  const assertDenied = async (denied = client) => {
    expect(await denied.query((ctx) => authApi.getUser(ctx))).toBeNull()
    await expect(denied.query((ctx) => authApi.requireUser(ctx))).rejects.toMatchObject({
      data: UNAUTHENTICATED,
    })
    await expect(denied.mutation((ctx) => authApi.getAuth(ctx))).rejects.toMatchObject({
      data: UNAUTHENTICATED,
    })
    await expect(denied.mutation((ctx) => helper.getAuth(createAuth, ctx))).rejects.toMatchObject({
      data: UNAUTHENTICATED,
    })
    expect(createAuth).not.toHaveBeenCalled()
  }
  return { test, client, authApi, helper, createAuth, assertDenied }
}

describe('backend helpers use canonical component admission', () => {
  it('rejects an issuer returned by defineSessionClaims at real factory token issuance', async () => {
    vi.stubEnv('SITE_URL', 'https://app.example.test')
    vi.stubEnv('CONVEX_SITE_URL', 'https://deployment.convex.site')
    vi.stubEnv('BETTER_AUTH_SECRETS', `0:${'test-secret'.repeat(4)}`)
    const defineSessionClaims = vi.fn(() => ({ iss: 'forged' }))
    try {
      const { test } = await init()
      await test.mutation(auth.updateOne, {
        model: 'session',
        where: [{ field: 'id', value: session.id }],
        update: { expiresAt: now + 7 * 24 * 60 * 60 * 1000 },
      })
      const authApi = createBetterConvexAuth(components.sessionAuth, { defineSessionClaims })
      const result = await test.mutation(async (ctx) => {
        const instance = await authApi.createAuth(ctx)
        // The public factory keeps Better Auth's plugin context opaque.
        const context = (await instance.$context) as {
          getPlugin(id: 'jwt'): ReturnType<typeof jwt> | undefined
        }
        const jwtPlugin = context.getPlugin('jwt')!
        const sign = vi.spyOn(jwtPlugin.endpoints, 'signJWT')
        try {
          const response = await instance.handler(
            new Request('https://app.example.test/api/auth/convex/token', {
              headers: {
                authorization: `Bearer ${session.token}`,
                [INTERNAL_SESSION_HEADER]: '1',
                'x-bcn-verified-client-ip': '192.0.2.1',
              },
            }),
          )
          return { status: response.status, signed: sign.mock.calls.length }
        } finally {
          sign.mockRestore()
        }
      })
      expect(defineSessionClaims).toHaveBeenCalledOnce()
      expect(result.status).toBeGreaterThanOrEqual(500)
      expect(result.signed).toBe(0)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('admits a live session through every backend helper without requiring verified email', async () => {
    const { client, authApi, helper, createAuth } = await init()
    expect(await client.query((ctx) => authApi.getUser(ctx))).toMatchObject(user)
    expect(await client.query((ctx) => authApi.requireUser(ctx))).toMatchObject(user)
    expect(await client.query((ctx) => readSessionClaims(ctx))).toEqual({
      sessionId: session.id,
      userId: user.id,
    })
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

  it('reads the live user with exactly one component query and no admission state', async () => {
    const { client, authApi } = await init()
    const result = await client.query(async (ctx) => {
      const { calls, counted } = countingQueries(ctx)
      const admitted = await authApi.getUser(counted)
      const required = await authApi.requireUser(counted)
      return { admitted, required, calls: calls.length }
    })
    expect(result.calls).toBe(2)
    expect(result.admitted).toMatchObject(user)
    expect(result.required).toMatchObject(user)
    expect(Object.keys(result.admitted!).filter((field) => field.startsWith('bcn'))).toEqual([])

    const claimsOnly = await client.query(async (ctx) => {
      const { calls, counted } = countingQueries(ctx)
      await readSessionClaims(counted)
      return calls.length
    })
    expect(claimsOnly).toBe(0)
  })

  it('denies an expired session through every backend helper', async () => {
    const { assertDenied } = await init()
    vi.setSystemTime(session.expiresAt)
    await assertDenied()
  })

  it('denies a session whose user security generation advanced', async () => {
    const { test, client, assertDenied } = await init()
    await expect(
      test.mutation(auth.deleteMany, {
        model: 'session',
        where: [{ field: 'userId', value: user.id }],
      }),
    ).resolves.toBe(0)
    await assertDenied()
    // The internal claims reader is not revocation-aware; admission is.
    expect(await client.query((ctx) => readSessionClaims(ctx))).toEqual({
      sessionId: session.id,
      userId: user.id,
    })
  })

  it('keeps a superseded-generation token denied after a new session is admitted', async () => {
    const { test, authApi, assertDenied } = await init()
    await expect(
      test.mutation(auth.deleteMany, {
        model: 'session',
        where: [{ field: 'userId', value: user.id }],
      }),
    ).resolves.toBe(0)
    await test.mutation(auth.create, {
      model: 'session',
      data: { ...session, id: 'session-next', token: 'token-next' },
    })
    await assertDenied()
    const next = test.withIdentity({ ...identity, sid: 'session-next' })
    expect(await next.query((ctx) => authApi.getUser(ctx))).toMatchObject(user)
  })

  it.each(['user', 'session'])(
    'rechecks canonical %s deletion with the same identity',
    async (model) => {
      const { test, client, authApi, assertDenied } = await init()
      expect(await client.query((ctx) => authApi.getUser(ctx))).not.toBeNull()
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
    { subject: 'user', sid: 'session' },
    { ...identity, token_use: 'oauth-access' },
    { ...identity, token_use: 'Convex-Session' },
  ])('does not treat identity claims as admission %j', async (claims) => {
    const { test, assertDenied } = await init()
    const denied = test.withIdentity(claims)
    await assertDenied(denied)
    if (claims.token_use !== 'convex-session' || !claims.sid) {
      expect(await denied.query((ctx) => readSessionClaims(ctx))).toBeNull()
    }
  })

  it.each([
    { model: 'user', field: 'bcnSecurityGeneration', id: user.id },
    { model: 'session', field: 'bcnAssuranceGeneration', id: session.id },
  ])('keeps $model.$field out of generic adapter writes', async ({ model, field, id }) => {
    const { test, client, authApi } = await init()
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
    expect(await client.query((ctx) => authApi.getUser(ctx))).toMatchObject(user)
  })

  it('rejects anonymous access', async () => {
    const { test, authApi } = await init()
    expect(await test.query((ctx) => authApi.getUser(ctx))).toBeNull()
    expect(await test.query((ctx) => readSessionClaims(ctx))).toBeNull()
    await expect(test.query((ctx) => authApi.requireUser(ctx))).rejects.toMatchObject({
      data: UNAUTHENTICATED,
    })
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
    const authApi = createBetterConvexAuth(components.sessionAuth)
    expect(await staleClient.query((ctx) => authApi.getUser(ctx))).toMatchObject(user)

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
    await expect(staleClient.query((ctx) => authApi.getUser(ctx))).resolves.toBeNull()

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
    await expect(currentClient.query((ctx) => authApi.getUser(ctx))).resolves.toMatchObject(user)
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
