/// <reference types="vite/client" />

import { convexTest } from 'convex-test'
import { componentsGeneric, defineSchema, httpRouter } from 'convex/server'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComponentApi } from '../../src/runtime/convex-auth/component/_generated/component'
import authSchema from '../../src/runtime/convex-auth/component/schema'

// Better Auth reads node:process, not Vitest's stubbed environment.
const restoreHostEnvironment = await vi.hoisted(async () => {
  const { env } = await import('node:process')
  const previous = { NODE_ENV: env.NODE_ENV, TEST: env.TEST }
  env.NODE_ENV = 'production'
  env.TEST = 'false'
  return () => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) Reflect.deleteProperty(env, name)
      else env[name] = value
    }
  }
})
const { createBetterConvexAuth } =
  await import('../../src/runtime/convex-auth/create-better-convex-auth')
afterAll(restoreHostEnvironment)

const rootModules = import.meta.glob('../fixtures/jwks-rotation/convex/**/*.ts')
const authModules = import.meta.glob('../../src/runtime/convex-auth/component/**/*.ts')
const components = componentsGeneric() as unknown as {
  sessionAuth: ComponentApi<'sessionAuth'>
}

describe('user creation policy with real Better Auth', () => {
  beforeEach(() => {
    vi.stubEnv('SITE_URL', 'https://app.example.test')
    vi.stubEnv('CONVEX_SITE_URL', 'https://deployment.convex.site')
    vi.stubEnv('BETTER_AUTH_SECRETS', `0:${'test-secret'.repeat(4)}`)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  function setup(
    beforeUserCreate: NonNullable<
      NonNullable<Parameters<typeof createBetterConvexAuth>[1]>['beforeUserCreate']
    >,
  ) {
    const test = convexTest(defineSchema({}), rootModules)
    test.registerComponent('sessionAuth', authSchema, authModules)
    const authApi = createBetterConvexAuth(components.sessionAuth, {
      beforeUserCreate,
    })
    const http = httpRouter()
    authApi.registerRoutes(http)
    const signUp = () =>
      test.action(async (ctx) => {
        const route = http.lookup('/api/auth/sign-up/email', 'POST')
        if (!route) throw new Error('Auth route was not registered')
        const handler = route[0] as unknown as {
          _handler: (ctx: unknown, request: Request) => Promise<Response>
        }
        const response = await handler._handler(
          { ...ctx, meta: { getRequestMetadata: async () => ({ ip: '198.51.100.7' }) } },
          new Request('https://deployment.convex.site/api/auth/sign-up/email', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              Origin: 'https://app.example.test',
            },
            body: JSON.stringify({
              name: 'Owner',
              email: 'Owner@Example.test',
              password: 'synthetic-password-for-signup',
            }),
          }),
        )
        return { status: response.status, body: await response.json() }
      })
    const users = () =>
      test.query(components.sessionAuth.adapter.findMany, {
        model: 'user',
        paginationOpts: { cursor: null, numItems: 10 },
      })
    return { signUp, users }
  }

  it('admits a narrow user identity decision without exposing Better Auth hooks', async () => {
    const beforeUserCreate = vi.fn<Parameters<typeof setup>[0]>(async () => {
      return {
        allowed: true,
        user: { email: 'canonical@example.test', id: 'existing-user-id' },
      }
    })
    const { signUp, users } = setup(beforeUserCreate)
    const response = await signUp()
    expect(response.status).toBe(200)
    expect(response.body.user).toMatchObject({
      email: 'canonical@example.test',
      id: 'existing-user-id',
      name: 'Owner',
      emailVerified: false,
    })
    expect(beforeUserCreate).toHaveBeenCalledOnce()
    const { ctx, user } = beforeUserCreate.mock.calls[0]![0]
    expect(ctx.runQuery).toBeTypeOf('function')
    expect(Object.isFrozen(user)).toBe(true)
    expect(user).toEqual({
      email: 'owner@example.test',
      emailVerified: false,
      image: undefined,
      name: 'Owner',
    })
    const stored = await users()
    expect(stored.page).toHaveLength(1)
    expect(stored.page[0]).toMatchObject({
      email: 'canonical@example.test',
      id: 'existing-user-id',
      name: 'Owner',
      emailVerified: false,
    })
  })

  // Better Auth answers a rejected sign-up like a successful one, so the client
  // cannot learn who may sign up. Only application bugs are logged.
  it.each([
    { name: 'explicit denial', callback: async () => ({ allowed: false as const }), log: null },
    {
      name: 'hook failure',
      callback: async () => {
        throw new Error('private hook error text')
      },
      log: { subCode: 'AUTH_USER_CREATE_HOOK_THREW', cause: 'Error: private hook error text' },
    },
    {
      name: 'invalid identity replacement',
      callback: async () => ({ allowed: true as const, user: { id: '  ' } }),
      log: { subCode: 'AUTH_USER_CREATE_INVALID_IDENTITY' },
    },
  ])(
    'rejects $name with the generic sign-up response and creates no user',
    async ({ callback, log }) => {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
      const beforeUserCreate = vi.fn(callback)
      const { signUp, users } = setup(beforeUserCreate)
      const response = await signUp()
      // The same address signing up again gets the existing-account response.
      // Both must match field for field; only generated values may differ.
      const allowed = setup(async () => ({ allowed: true as const }))
      await allowed.signUp()
      const existing = await allowed.signUp()
      const generated = {
        id: expect.any(String),
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      }
      expect(response).toEqual({
        ...existing,
        body: { ...existing.body, user: { ...existing.body.user, ...generated } },
      })
      expect(response.body.token).toBeNull()
      expect(beforeUserCreate).toHaveBeenCalledOnce()
      expect((await users()).page).toEqual([])
      const rejections = errors.mock.calls.filter(
        ([message]) => message === '[better-convex] AUTH_USER_CREATE_REJECTED',
      )
      expect(rejections).toEqual(log ? [['[better-convex] AUTH_USER_CREATE_REJECTED', log]] : [])
    },
  )
})
