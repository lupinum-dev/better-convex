/// <reference types="vite/client" />

import { convexTest } from 'convex-test'
import { componentsGeneric, defineSchema, getFunctionAddress, httpRouter } from 'convex/server'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComponentApi } from '../../src/runtime/convex-auth/component/_generated/component'
import authSchema from '../../src/runtime/convex-auth/component/schema'
import {
  CLIENT_IP_HEADER,
  CLIENT_IP_SIGNATURE_HEADER,
  signClientIp,
} from '../../src/runtime/shared/client-ip'

// Better Auth captures NODE_ENV at import and checks TEST when creating the request context.
// The edge runtime has a separate process shim; set the host environment so
// these real routes enforce production origin checks, then restore it after use.
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
const components = componentsGeneric() as unknown as { sessionAuth: ComponentApi<'sessionAuth'> }
const adapter = components.sessionAuth.adapter
const origin = 'https://app.example.test'
const secret = 'session-http-proxy-secret-with-32-bytes'
const now = 1_700_000_000_000

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
  vi.stubEnv('SITE_URL', origin)
  vi.stubEnv('CONVEX_SITE_URL', 'https://deployment.convex.site')
  vi.stubEnv('BETTER_AUTH_SECRETS', `0:${'test-secret'.repeat(4)}`)
  vi.stubEnv('BCN_AUTH_PROXY_IP_SECRET', secret)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

async function setup() {
  const test = convexTest(defineSchema({}), rootModules)
  test.registerComponent('sessionAuth', authSchema, authModules)
  const auth = createBetterConvexAuth(components.sessionAuth)
  const handler = vi.fn<Parameters<typeof auth.sessionHttpAction>[0]>(async () =>
    Response.json({ ok: true }),
  )
  const http = httpRouter()
  auth.registerRoutes(http)
  http.route({ path: '/protected', method: 'POST', handler: auth.sessionHttpAction(handler) })

  const send = (
    path: string,
    headers: Record<string, string | null> = {},
    body?: unknown,
    beforeAdmission?: () => Promise<void>,
  ) =>
    test.action(async (ctx) => {
      let reads = 0
      let admissions = 0
      const runQuery: typeof ctx.runQuery = async (reference, args) => {
        reads += 1
        if (
          getFunctionAddress(reference).reference ===
          getFunctionAddress(adapter.sessionAdmission).reference
        ) {
          admissions += 1
          if (beforeAdmission) await beforeAdmission()
        }
        return ctx.runQuery(reference, args)
      }
      const route = http.lookup(path, 'POST')
      if (!route) throw new Error('HTTP route was not registered')
      const action = route[0] as unknown as {
        _handler: (ctx: unknown, request: Request) => Promise<Response>
      }
      // A null value removes the header, so a test can send no origin at all.
      const requestHeaders = new Headers({ origin, 'content-type': 'application/json' })
      for (const [name, value] of Object.entries(headers)) {
        if (value === null) requestHeaders.delete(name)
        else requestHeaders.set(name, value)
      }
      const response = await action._handler(
        { ...ctx, runQuery, meta: { getRequestMetadata: async () => ({ ip: '198.51.100.7' }) } },
        new Request(`https://deployment.convex.site${path}`, {
          method: 'POST',
          headers: requestHeaders,
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      )
      return {
        status: response.status,
        body: await response.json(),
        cookie: response.headers.get('set-cookie')?.split(';')[0],
        reads,
        admissions,
      }
    })
  const credentials = { email: 'person@example.test', password: 'synthetic-password-123' }
  const signup = await send('/api/auth/sign-up/email', {}, { ...credentials, name: 'Person' })
  expect(signup.status).toBe(200)
  const login = await send('/api/auth/sign-in/email', {}, credentials)
  expect(login.status).toBe(200)
  expect(login.cookie).toBeTruthy()
  const userId = (login.body as { user: { id: string } }).user.id
  const row = await test.query(adapter.findOne, {
    model: 'session',
    where: [{ field: 'userId', value: userId }],
  })
  const sessionId = row!.id as string
  return {
    test,
    handler,
    userId,
    sessionId,
    cookie: login.cookie!,
    call: (
      headers: Record<string, string | null> = { cookie: login.cookie! },
      beforeAdmission?: () => Promise<void>,
    ) => send('/protected', headers, undefined, beforeAdmission),
  }
}

describe('sessionHttpAction with real Better Auth', () => {
  it('passes only the admitted public user and verified client IP to the handler', async () => {
    const { call, handler, userId, sessionId, cookie } = await setup()
    const result = await call({
      cookie,
      [CLIENT_IP_HEADER]: '203.0.113.9',
      [CLIENT_IP_SIGNATURE_HEADER]: await signClientIp('203.0.113.9', secret),
    })
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ ok: true })
    expect(result.admissions).toBe(1)
    expect(handler).toHaveBeenCalledOnce()
    const session = handler.mock.calls[0]![1]
    expect(session.user).toEqual({
      id: userId,
      name: 'Person',
      email: 'person@example.test',
      emailVerified: false,
      image: null,
      createdAt: now,
      updatedAt: now,
    })
    expect(session.sessionId).toBe(sessionId)
    expect([...session.headers.entries()]).toEqual([
      ['cookie', cookie],
      ['origin', origin],
      ['x-bcn-verified-client-ip', '203.0.113.9'],
    ])
    expect(session.request.url).toBe('https://app.example.test/protected')
    expect(session.request.headers.get('x-bcn-verified-client-ip')).toBe('203.0.113.9')
    expect(session.request.headers.get(CLIENT_IP_SIGNATURE_HEADER)).toBeNull()
  })

  it.each([
    [
      'a forged proxy signature',
      { [CLIENT_IP_HEADER]: '203.0.113.9', [CLIENT_IP_SIGNATURE_HEADER]: 'forged' },
      500,
      'AUTH_REQUEST_METADATA_INVALID',
    ],
    [
      'an unsigned forwarded IP',
      { [CLIENT_IP_HEADER]: '203.0.113.9' },
      500,
      'AUTH_REQUEST_METADATA_INVALID',
    ],
    ['a cross-origin request', { origin: 'https://attacker.example.test' }, 403, 'FORBIDDEN'],
    ['a missing origin', { origin: null }, 403, 'FORBIDDEN'],
  ] as const)('rejects %s before reading the session', async (_label, headers, status, code) => {
    const { call, handler, cookie } = await setup()
    const result = await call({ cookie, ...headers })
    expect(result.status).toBe(status)
    expect(result.body).toEqual({ code })
    expect(result.reads).toBe(0)
    expect(result.admissions).toBe(0)
    expect(handler).not.toHaveBeenCalled()
  })

  it('denies without a Better Auth session', async () => {
    const { call, handler } = await setup()
    const result = await call({})
    expect(result.status).toBe(401)
    expect(result.body).toEqual({ code: 'UNAUTHENTICATED' })
    expect(result.admissions).toBe(0)
    expect(handler).not.toHaveBeenCalled()
  })

  it.each(['revoked', 'expired', 'generation-fenced'] as const)(
    'denies a session that becomes %s before admission',
    async (state) => {
      const { test, call, handler, sessionId, userId, cookie } = await setup()
      // Change real persisted state after Better Auth reads the cookie. This
      // catches reliance on its earlier snapshot instead of live admission.
      const result = await call({ cookie }, async () => {
        if (state === 'revoked') {
          await test.mutation(adapter.deleteOne, {
            model: 'session',
            where: [{ field: 'id', value: sessionId }],
          })
        } else if (state === 'expired') {
          await test.mutation(adapter.updateOne, {
            model: 'session',
            where: [{ field: 'id', value: sessionId }],
            update: { expiresAt: now },
          })
        } else {
          // Revoking all of a user's sessions advances the user's security
          // generation instead of deleting rows, so the session stays stored
          // and only the generation check can deny it.
          await expect(
            test.mutation(adapter.deleteMany, {
              model: 'session',
              where: [{ field: 'userId', value: userId }],
            }),
          ).resolves.toBe(0)
        }
      })
      expect(result.admissions).toBe(1)
      expect(result.status).toBe(401)
      expect(result.body).toEqual({ code: 'UNAUTHENTICATED' })
      expect(handler).not.toHaveBeenCalled()
    },
  )
})
