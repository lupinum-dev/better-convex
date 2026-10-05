/// <reference types="vite/client" />

import { convexTest } from 'convex-test'
import { componentsGeneric, defineSchema, httpRouter } from 'convex/server'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComponentApi } from '../../src/runtime/convex-auth/component/_generated/component'
import authSchema from '../../src/runtime/convex-auth/component/schema'
import type { AuthCtx } from '../../src/runtime/convex-auth/context'
import {
  CLIENT_IP_HEADER,
  CLIENT_IP_SIGNATURE_HEADER,
  PUBLIC_ORIGIN_HEADER,
  PUBLIC_ORIGIN_SIGNATURE_HEADER,
  signClientIp,
  signPublicOrigin,
} from '../../src/runtime/shared/client-ip'

// Better Auth captures NODE_ENV at import and also checks TEST per request.
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
const rootSchema = defineSchema({})
const components = componentsGeneric() as unknown as {
  sessionAuth: ComponentApi<'sessionAuth'>
}

describe('site origins with real Better Auth', () => {
  const SECRET = 'site-origins-proxy-secret-with-32-bytes'
  const SITE_A = 'https://app.example.test'
  const SITE_B = 'https://site-b.example.test'

  beforeEach(() => {
    vi.stubEnv('SITE_URL', SITE_A)
    vi.stubEnv('CONVEX_SITE_URL', 'https://deployment.convex.site')
    vi.stubEnv('BETTER_AUTH_SECRETS', `0:${'test-secret'.repeat(4)}`)
    vi.stubEnv('BCN_AUTH_PROXY_IP_SECRET', SECRET)
  })
  afterEach(() => vi.unstubAllEnvs())

  async function signed(origin: string, secret = SECRET) {
    return {
      [PUBLIC_ORIGIN_HEADER]: origin,
      [PUBLIC_ORIGIN_SIGNATURE_HEADER]: await signPublicOrigin(origin, secret),
    }
  }

  function setup(
    options: Parameters<typeof createBetterConvexAuth>[1] = { siteOrigins: [SITE_B] },
  ) {
    const test = convexTest(rootSchema, rootModules)
    test.registerComponent('sessionAuth', authSchema, authModules)
    const authApi = createBetterConvexAuth(components.sessionAuth, options)
    const http = httpRouter()
    authApi.registerRoutes(http)
    return (headers: Record<string, string> = {}, body?: { email: string; password: string }) =>
      test.action(async (ctx) => {
        const method = body ? 'POST' : 'GET'
        const path = body ? '/api/auth/sign-in/email' : '/api/auth/get-session'
        const route = http.lookup(path, method)
        if (!route) throw new Error('Auth route was not registered')
        const handler = route[0] as unknown as {
          _handler: (ctx: unknown, request: Request) => Promise<Response>
        }
        const response = await handler._handler(
          { ...ctx, meta: { getRequestMetadata: async () => ({ ip: '198.51.100.7' }) } },
          new Request(`https://deployment.convex.site${path}`, {
            method,
            headers: body ? { 'content-type': 'application/json', ...headers } : headers,
            body: body ? JSON.stringify(body) : undefined,
          }),
        )
        return { status: response.status, body: await response.json() }
      })
  }

  it('uses SITE_URL without an origin pair', async () => {
    expect(await setup()()).toEqual({ status: 200, body: null })
  })

  it('serves a listed site origin from a signed proxy hop', async () => {
    // The JWT plugin must use the deployment issuer even when baseURL is SITE_B.
    expect(await setup()(await signed(SITE_B))).toEqual({ status: 200, body: null })
  })

  it('reads the origins from a function with the request context', async () => {
    const siteOrigins = vi.fn(async (ctx: AuthCtx) => {
      expect(ctx.runQuery).toBeTypeOf('function')
      return [SITE_B]
    })
    expect(await setup({ siteOrigins })(await signed(SITE_B))).toEqual({ status: 200, body: null })
    expect(siteOrigins).toHaveBeenCalledOnce()
  })

  it('fails closed when the siteOrigins function throws', async () => {
    const siteOrigins = vi.fn(async () => {
      throw new Error('Origin lookup unavailable')
    })
    expect(await setup({ siteOrigins })(await signed(SITE_B))).toEqual({
      status: 500,
      body: { code: 'AUTH_CONFIG_INVALID' },
    })
    expect(siteOrigins).toHaveBeenCalledOnce()
  })

  it('accepts the signed canonical origin without a list', async () => {
    expect(await setup({})(await signed(SITE_A))).toEqual({ status: 200, body: null })
  })

  it('rejects a signed origin that is not listed', async () => {
    expect(await setup()(await signed('https://site-c.example.test'))).toEqual({
      status: 500,
      body: { code: 'AUTH_CONFIG_INVALID' },
    })
  })

  it.each([
    ['a wrong secret', async () => signed(SITE_B, 'another-proxy-secret-with-32-bytes-x')],
    ['an origin without signature', async () => ({ [PUBLIC_ORIGIN_HEADER]: SITE_B })],
    [
      'a signature for another origin',
      async () => ({ ...(await signed(SITE_A)), [PUBLIC_ORIGIN_HEADER]: SITE_B }),
    ],
    [
      'a client-IP signature reused for the origin',
      async () => ({
        [PUBLIC_ORIGIN_HEADER]: SITE_B,
        [PUBLIC_ORIGIN_SIGNATURE_HEADER]: await signClientIp('203.0.113.9', SECRET),
      }),
    ],
  ])('rejects %s as forged request metadata', async (_label, headers) => {
    expect(
      await setup()({
        ...(await headers()),
        [CLIENT_IP_HEADER]: '203.0.113.9',
        [CLIENT_IP_SIGNATURE_HEADER]: await signClientIp('203.0.113.9', SECRET),
      }),
    ).toEqual({ status: 500, body: { code: 'AUTH_REQUEST_METADATA_INVALID' } })
  })

  it.each([SITE_A, SITE_B])(
    'checks cookie-less sign-in Origin %s against the signed site',
    async (origin) => {
      // sign-in/email uses formCsrfMiddleware, which validates Origin even without cookies.
      const response = await setup()(
        { ...(await signed(SITE_B)), Origin: origin },
        { email: 'missing@example.test', password: 'synthetic-password' },
      )
      if (origin === SITE_A) {
        expect(response.status).toBe(403)
        expect(response.body).toMatchObject({ code: 'INVALID_ORIGIN' })
      } else {
        expect(response.status).toBe(401)
        expect(response.body).toMatchObject({ code: 'INVALID_EMAIL_OR_PASSWORD' })
      }
    },
  )
})
