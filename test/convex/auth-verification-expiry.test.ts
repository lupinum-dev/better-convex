/// <reference types="vite/client" />

import { convexTest } from 'convex-test'
import { componentsGeneric, defineSchema, httpRouter } from 'convex/server'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../../src/runtime/convex-auth/component/_generated/api'
import type { ComponentApi } from '../../src/runtime/convex-auth/component/_generated/component'
import authSchema from '../../src/runtime/convex-auth/component/schema'
import type { BetterConvexAuthEmail } from '../../src/runtime/convex-auth/create-better-convex-auth'

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
const components = componentsGeneric() as unknown as { codes: ComponentApi<'codes'> }
const minute = 60_000

/** The auth component on its own, for its scheduled jobs and adapter calls. */
function component() {
  return convexTest(authSchema, authModules)
}
type Component = ReturnType<typeof component>

/** An app with the auth component and real Better Auth routes. */
function signInWithCodes() {
  const test = convexTest(defineSchema({}), rootModules)
  test.registerComponent('codes', authSchema, authModules)
  const mails: BetterConvexAuthEmail[] = []
  const auth = createBetterConvexAuth(components.codes, {
    email: async (_ctx, message) => {
      mails.push(message)
    },
    emailOTP: { otpLength: 6, expiresIn: 300, allowedAttempts: 3 },
  })
  const http = httpRouter()
  auth.registerRoutes(http)
  let ip = 0
  // Each request comes from its own address, so per-IP limits stay out of the way.
  async function post(path: string, body: Record<string, unknown>) {
    ip += 1
    const client = `198.51.${Math.floor(ip / 250)}.${(ip % 250) + 1}`
    return test.action(async (ctx) => {
      const route = http.lookup(`/api/auth${path}`, 'POST')
      if (!route) throw new Error('Auth route was not registered')
      const handler = route[0] as unknown as {
        _handler: (ctx: unknown, request: Request) => Promise<Response>
      }
      const response = await handler._handler(
        { ...ctx, meta: { getRequestMetadata: async () => ({ ip: client }) } },
        new Request(`https://deployment.convex.site/api/auth${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', Origin: 'https://app.example.test' },
          body: JSON.stringify(body),
        }),
      )
      return response.status
    })
  }
  function lastCode(to: string) {
    const mail = mails.findLast((message) => message.type === 'email-otp' && message.to === to)
    if (mail?.type !== 'email-otp') throw new Error('Expected an email code')
    return mail.otp
  }
  return { post, lastCode }
}

async function verificationRows(test: Component) {
  return test.run(async (ctx) => (await ctx.db.query('verification').take(1_000)).length)
}

async function insertExpiredRows(test: Component, count: number, identifier = 'abandoned') {
  await test.run(async (ctx) => {
    for (let index = 0; index < count; index++) {
      await ctx.db.insert('verification', {
        id: `${identifier}-${index}`,
        identifier,
        value: 'synthetic',
        expiresAt: 1,
        createdAt: index,
        updatedAt: index,
      })
    }
  })
}

describe('verification rows', () => {
  beforeEach(() => {
    vi.stubEnv('SITE_URL', 'https://app.example.test')
    vi.stubEnv('CONVEX_SITE_URL', 'https://deployment.convex.site')
    vi.stubEnv('BETTER_AUTH_SECRETS', `0:${'test-secret'.repeat(4)}`)
  })
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  // Catches: Better Auth's sweep of expired rows running in one bounded mutation,
  // so 129 abandoned codes (no account needed) failed every later code sign-in.
  it.each([127, 129])(
    'signs in with a code after %i abandoned codes expired',
    { timeout: 300_000 },
    async (abandoned) => {
      const start = Date.now()
      vi.useFakeTimers({ toFake: ['Date'], now: start })
      const { post, lastCode } = signInWithCodes()
      for (let index = 0; index < abandoned; index++) {
        const status = await post('/email-otp/send-verification-otp', {
          email: `made-up-${index}@example.test`,
          type: 'sign-in',
        })
        expect(status).toBe(200)
      }
      vi.setSystemTime(start + 6 * minute)
      const email = 'person@example.test'
      expect(await post('/email-otp/send-verification-otp', { email, type: 'sign-in' })).toBe(200)
      expect(await post('/sign-in/email-otp', { email, otp: lastCode(email) })).toBe(200)
    },
  )

  // Catches: a code row living forever, and rows from before this release
  // (which have no job of their own) never leaving the table.
  it('deletes a code at its expiry together with older expired rows, 128 per batch', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
    const test = component()
    await insertExpiredRows(test, 300)
    await test.mutation(api.adapter.create, {
      model: 'verification',
      data: {
        id: 'code',
        identifier: 'sign-in-otp-hash',
        value: 'synthetic',
        expiresAt: Date.now() + 5 * minute,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    })
    vi.advanceTimersByTime(5 * minute - 1)
    await test.finishInProgressScheduledFunctions()
    expect(await verificationRows(test)).toBe(301)
    await test.finishAllScheduledFunctions(vi.runAllTimers)
    expect(await verificationRows(test)).toBe(0)
  })

  // Catches: consuming a code, or sweeping expired rows through the adapter,
  // failing once more than 128 rows match.
  it.each([
    { field: 'identifier', operator: 'eq', value: 'abandoned' },
    { field: 'expiresAt', operator: 'lt', value: 2 },
  ] as const)('deletes one bounded batch for $field $operator', async (clause) => {
    const test = component()
    await insertExpiredRows(test, 129)
    expect(
      await test.mutation(api.adapter.deleteMany, { model: 'verification', where: [clause] }),
    ).toBe(128)
    expect(await verificationRows(test)).toBe(1)
  })
})
