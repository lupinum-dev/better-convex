/// <reference types="vite/client" />

import type { AuthContext } from 'better-auth'
import { convexTest } from 'convex-test'
import { componentsGeneric, defineSchema, getFunctionAddress, httpRouter } from 'convex/server'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComponentApi } from '../../src/runtime/convex-auth/component/_generated/component'
import authSchema from '../../src/runtime/convex-auth/component/schema'

// Cookie-less POST requests must pass Better Auth's production origin checks.
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
const component = (componentsGeneric() as unknown as { sessionAuth: ComponentApi<'sessionAuth'> })
  .sessionAuth
const systemConflict =
  'Documents read from or written to the table "rateLimit" changed while this mutation was being run and on every subsequent retry.'

beforeEach(() => {
  vi.stubEnv('SITE_URL', 'https://app.example.test')
  vi.stubEnv('CONVEX_SITE_URL', 'https://deployment.convex.site')
  vi.stubEnv('BETTER_AUTH_SECRETS', `0:${'test-secret'.repeat(4)}`)
})
afterEach(() => {
  vi.unstubAllEnvs()
})

function setup() {
  const test = convexTest(defineSchema({}), rootModules)
  test.registerComponent('sessionAuth', authSchema, authModules)
  const auth = createBetterConvexAuth(component)
  const http = httpRouter()
  auth.registerRoutes(http)
  return { test, auth, http }
}

describe('rate-limit retries with real Better Auth', () => {
  it.each([
    [
      'two uncommitted conflicts',
      systemConflict,
      2,
      3,
      401,
      '{"message":"Invalid email or password","code":"INVALID_EMAIL_OR_PASSWORD"}',
    ],
    ['six uncommitted conflicts', systemConflict, 6, 6, 500, '{"code":"AUTH_HANDLER_FAILED"}'],
    [
      'an invalid rate-limit row',
      'AUTH_RATE_LIMIT_ROW_INVALID',
      1,
      1,
      500,
      '{"code":"AUTH_HANDLER_FAILED"}',
    ],
    [
      'an unconfirmed concurrency error',
      'optimistic concurrency control failure',
      1,
      1,
      500,
      '{"code":"AUTH_HANDLER_FAILED"}',
    ],
  ] as const)(
    'handles %s through the sign-in route',
    async (_label, message, failures, expectedAttempts, status, body) => {
      const { test, http } = setup()
      const result = await test.action(async (ctx) => {
        let attempts = 0
        const runMutation: typeof ctx.runMutation = async (reference, ...args) => {
          if (
            getFunctionAddress(reference).reference ===
            getFunctionAddress(component.adapter.consumeRateLimit).reference
          ) {
            attempts += 1
            if (attempts <= failures) throw new Error(message)
          }
          return ctx.runMutation(reference, ...args)
        }
        const route = http.lookup('/api/auth/sign-in/email', 'POST')
        if (!route) throw new Error('Auth route was not registered')
        const handler = route[0] as unknown as {
          _handler: (ctx: unknown, request: Request) => Promise<Response>
        }
        const response = await handler._handler(
          {
            ...ctx,
            runMutation,
            meta: { getRequestMetadata: async () => ({ ip: '198.51.100.7' }) },
          },
          new Request('https://deployment.convex.site/api/auth/sign-in/email', {
            method: 'POST',
            headers: { origin: 'https://app.example.test', 'content-type': 'application/json' },
            body: JSON.stringify({
              email: 'missing@example.test',
              password: 'synthetic-password-123',
            }),
          }),
        )
        return { attempts, status: response.status, body: await response.text() }
      })
      // A missing user reaches the real sign-in handler only after storage succeeds.
      expect(result).toEqual({ attempts: expectedAttempts, status, body })
    },
  )

  it('does not retry an uncommitted conflict inside a mutation context', async () => {
    const { test, auth } = setup()
    await test.mutation(async (ctx) => {
      let attempts = 0
      const runMutation: typeof ctx.runMutation = async (reference, ...args) => {
        if (
          getFunctionAddress(reference).reference ===
          getFunctionAddress(component.adapter.consumeRateLimit).reference
        ) {
          attempts += 1
          // A finite failure also makes an accidental retry fail without hanging.
          if (attempts === 1) throw new Error(systemConflict)
        }
        return ctx.runMutation(reference, ...args)
      }
      const instance = await auth.createAuth({ ...ctx, runMutation })
      // The transport exposes $context as unknown; this is the real Better Auth context.
      const context = (await instance.$context) as AuthContext
      const storage = context.rateLimit.customStorage!
      await expect(
        storage.consume('client|/sign-in/email', { max: 100, window: 10 }),
      ).rejects.toThrow(systemConflict)
      expect(attempts).toBe(1)
    })
  })
})
