/// <reference types="vite/client" />

import { convexTest } from 'convex-test'
import { componentsGeneric, defineSchema, getFunctionAddress, httpRouter } from 'convex/server'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest'

import type { ComponentApi } from '../../src/runtime/convex-auth/component/_generated/component'
import authSchema from '../../src/runtime/convex-auth/component/schema'

// Rate-limit storage must run under production policy in the real handler.
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
const secret = 'diagnostic-secret-value-with-at-least-32-bytes'
const cookie = 'better-auth.session_token=private-cookie-value'
const token = 'eyJhbGciOiJSUzI1NiJ9.private-session-token-value'
const requestUrl = 'https://deployment.convex.site/api/auth/sign-in/email?private=request-value'
const privateHeader = 'private-header-value'
const rawCause = `dependency failed secret=${secret} cookie=${cookie} token=${token}`
let consoleError: MockInstance<typeof console.error>

beforeEach(() => {
  vi.stubEnv('SITE_URL', 'https://app.example.test')
  vi.stubEnv('CONVEX_SITE_URL', 'https://deployment.convex.site')
  vi.stubEnv('BETTER_AUTH_SECRETS', `0:${secret}`)
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

function setup(options: Parameters<typeof createBetterConvexAuth>[1] = {}) {
  const test = convexTest(defineSchema({}), rootModules)
  test.registerComponent('sessionAuth', authSchema, authModules)
  const auth = createBetterConvexAuth(component, options)
  const http = httpRouter()
  auth.registerRoutes(http)
  const send = (failMutation = false) =>
    test.action(async (ctx) => {
      let failedMutations = 0
      const runMutation: typeof ctx.runMutation = async (reference, args) => {
        if (
          failMutation &&
          getFunctionAddress(reference).reference ===
            getFunctionAddress(component.adapter.consumeRateLimit).reference
        ) {
          failedMutations += 1
          throw new Error(rawCause)
        }
        return ctx.runMutation(reference, args)
      }
      const route = http.lookup('/api/auth/sign-in/email', 'POST')
      if (!route) throw new Error('Auth route was not registered')
      const handler = route[0] as unknown as {
        _handler: (ctx: unknown, request: Request) => Promise<Response>
      }
      const response = await handler._handler(
        { ...ctx, runMutation, meta: { getRequestMetadata: async () => ({ ip: '198.51.100.7' }) } },
        new Request(requestUrl, {
          method: 'POST',
          headers: {
            origin: 'https://app.example.test',
            cookie,
            authorization: `Bearer ${token}`,
            'x-private-header': privateHeader,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            email: 'missing@example.test',
            password: 'private-password-value',
          }),
        }),
      )
      return { status: response.status, body: await response.text(), failedMutations }
    })
  return { test, auth, send }
}

function expectDiagnostics(subCode: string, publicText: string, code = 'AUTH_CONFIG_INVALID') {
  expect(consoleError).toHaveBeenCalledOnce()
  expect(consoleError.mock.calls[0]![0]).toBe(`[better-convex] ${code}`)
  expect(consoleError.mock.calls[0]![1]).toMatchObject({ subCode })
  const logged = JSON.stringify(consoleError.mock.calls)
  for (const text of [
    secret,
    cookie,
    'private-cookie-value',
    token,
    requestUrl,
    'private=request-value',
    privateHeader,
    'x-private-header',
    'authorization',
    'private-password-value',
  ]) {
    expect(logged).not.toContain(text)
    expect(publicText).not.toContain(text)
  }
  expect(publicText).not.toContain(subCode)
}

describe('auth route diagnostics with real Better Auth', () => {
  it.each([
    ['BETTER_AUTH_SECRETS', '0:short-private-secret', 'AUTH_CONFIG_SECRETS_INVALID'],
    ['SITE_URL', 'not a url', 'AUTH_CONFIG_SITE_URL_INVALID'],
    ['CONVEX_SITE_URL', undefined, 'AUTH_CONFIG_CONVEX_SITE_URL_INVALID'],
    ['socialProviders', undefined, 'AUTH_CONFIG_OPTIONS_INVALID'],
  ] as const)(
    'logs a stable sub-code for invalid %s without secrets',
    async (name, value, subCode) => {
      const options =
        name === 'socialProviders'
          ? {
              socialProviders: () => {
                throw new Error(rawCause)
              },
            }
          : {}
      if (name !== 'socialProviders') vi.stubEnv(name, value)
      const { test, auth } = setup(options)
      const failure = await test.action(async (ctx) => {
        try {
          await auth.createAuth(ctx)
          throw new Error('Expected auth construction to fail')
        } catch (error) {
          expect(error).toEqual(new Error('AUTH_CONFIG_INVALID'))
          if (!(error instanceof Error)) throw error
          return { message: error.message, serialized: JSON.stringify(error) }
        }
      })
      expect(failure).toEqual({ message: 'AUTH_CONFIG_INVALID', serialized: '{}' })
      expectDiagnostics(subCode, JSON.stringify(failure))
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain('short-private-secret')
      expect(JSON.stringify(failure)).not.toContain('short-private-secret')
    },
  )

  it('keeps the public body opaque and logs one stable construction sub-code', async () => {
    vi.stubEnv('BETTER_AUTH_SECRETS', undefined)
    const result = await setup().send()
    expect(result.status).toBe(500)
    expect(result.body).toBe('{"code":"AUTH_CONFIG_INVALID"}')
    expectDiagnostics('AUTH_CONFIG_SECRETS_INVALID', result.body)
  })

  it('logs a route sub-code when the public origin is invalid', async () => {
    vi.stubEnv('SITE_URL', 'ftp://app.example.test')
    const result = await setup().send()
    expect(result.status).toBe(500)
    expect(result.body).toBe('{"code":"AUTH_CONFIG_INVALID"}')
    expectDiagnostics('AUTH_CONFIG_ROUTE_SITE_URL_INVALID', result.body)
  })

  it('logs handler failures without request material', async () => {
    const result = await setup().send(true)
    expect(result.failedMutations).toBe(1)
    expect(result.status).toBe(500)
    expect(result.body).toBe('{"code":"AUTH_HANDLER_FAILED"}')
    expectDiagnostics('AUTH_HANDLER_THREW', result.body, 'AUTH_HANDLER_FAILED')
    expect(consoleError.mock.calls[0]![1]).toEqual({
      subCode: 'AUTH_HANDLER_THREW',
      cause: 'Error: dependency failed secret [redacted] cookie [redacted] token [redacted]',
    })
  })
})
