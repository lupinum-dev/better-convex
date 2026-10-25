/// <reference types="vite/client" />
/**
 * Real Better Auth on the real Convex component, driven through its HTTP
 * routes. Security tests use this harness, so every request reaches the
 * adapter in the exact shape Better Auth sends it. Import it before anything
 * that loads Better Auth: it switches the host to production first.
 */
import { convexTest } from 'convex-test'
import { componentsGeneric, defineSchema, httpRouter } from 'convex/server'
import { afterAll, afterEach, beforeEach, vi } from 'vitest'

import type { ComponentApi } from '../../src/runtime/convex-auth/component/_generated/component'
import authSchema from '../../src/runtime/convex-auth/component/schema'
import type {
  BetterConvexAuthEmail,
  CreateBetterConvexAuthOptions,
} from '../../src/runtime/convex-auth/create-better-convex-auth'
import anonymousSchema from '../fixtures/better-auth-anonymous/convex/betterAuth/schema'
import organizationSchema from '../fixtures/better-auth-local-component/convex/betterAuth/schema'
import twoFactorSchema from '../fixtures/better-auth-two-factor/convex/betterAuth/schema'

// Better Auth reads node:process at import, not Vitest's stubbed environment.
const restoreHostEnvironment = await (async () => {
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
})()
const { createBetterConvexAuth } =
  await import('../../src/runtime/convex-auth/create-better-convex-auth')
/** The factory, loaded after the host switched to production. */
export { createBetterConvexAuth }

export const SITE_URL = 'https://app.example.test'
export const CONVEX_SITE_URL = 'https://deployment.convex.site'

const rootModules = import.meta.glob('../fixtures/jwks-rotation/convex/**/*.ts')
const componentSchemas = {
  default: [authSchema, import.meta.glob('../../src/runtime/convex-auth/component/**/*.ts')],
  organization: [
    organizationSchema,
    import.meta.glob('../fixtures/better-auth-local-component/convex/betterAuth/**/*.ts'),
  ],
  twoFactor: [
    twoFactorSchema,
    import.meta.glob('../fixtures/better-auth-two-factor/convex/betterAuth/**/*.ts'),
  ],
  anonymous: [
    anonymousSchema,
    import.meta.glob('../fixtures/better-auth-anonymous/convex/betterAuth/**/*.ts'),
  ],
} as const
const components = componentsGeneric() as unknown as {
  sessionAuth: ComponentApi<'sessionAuth'>
}
export const authComponent = components.sessionAuth

/** Stub the deployment environment for each test and restore the host after the file. */
export function useAuthEnvironment() {
  beforeEach(() => {
    vi.stubEnv('SITE_URL', SITE_URL)
    vi.stubEnv('CONVEX_SITE_URL', CONVEX_SITE_URL)
    vi.stubEnv('BETTER_AUTH_SECRETS', `0:${'test-secret'.repeat(4)}`)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })
  afterAll(restoreHostEnvironment)
}

let ipCounter = 0
/** A new documentation-range address, so Better Auth's per-IP limits do not mix tests. */
export function freshIp() {
  ipCounter += 1
  return `198.51.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`
}

export type RealAuthOptions = Omit<CreateBetterConvexAuthOptions<never>, 'email'>

export interface RealAuthSetup {
  /** The component schema that matches the plugins in the options. */
  component?: keyof typeof componentSchemas
  /** Leave out the email sender, to test the factory's own fallback. */
  email?: false
}

export interface AuthResponse {
  status: number
  body: unknown
  cookies: string[]
  location: string
}

export function createRealAuth(options: RealAuthOptions, setup: RealAuthSetup = {}) {
  const [schema, modules] = componentSchemas[setup.component ?? 'default']
  const test = convexTest(defineSchema({}), rootModules)
  test.registerComponent('sessionAuth', schema, modules)
  const mails: BetterConvexAuthEmail[] = []
  const auth = createBetterConvexAuth(authComponent, {
    ...(setup.email === false
      ? {}
      : {
          email: async (_ctx: unknown, message: BetterConvexAuthEmail) => {
            mails.push(message)
          },
        }),
    ...(options as object),
  } as never)
  const http = httpRouter()
  auth.registerRoutes(http)

  /** One browser: a cookie jar and, unless fixed, a new IP address per request. */
  function client(fixedIp?: string) {
    let cookie = ''
    async function call(
      method: 'GET' | 'POST',
      path: string,
      body?: Record<string, unknown>,
      ip = fixedIp ?? freshIp(),
    ): Promise<AuthResponse> {
      const response = await test.action(async (ctx) => {
        const url = new URL(`${CONVEX_SITE_URL}/api/auth${path}`)
        const route = http.lookup(url.pathname, method)
        if (!route) throw new Error(`no route ${method} ${path}`)
        const handler = route[0] as unknown as {
          _handler: (ctx: unknown, request: Request) => Promise<Response>
        }
        const res = await handler._handler(
          { ...ctx, meta: { getRequestMetadata: async () => ({ ip }) } },
          new Request(url, {
            method,
            headers: {
              'content-type': 'application/json',
              Origin: process.env.SITE_URL ?? SITE_URL,
              cookie,
            },
            ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
            redirect: 'manual',
          }),
        )
        const text = await res.text()
        let parsed: unknown = text
        try {
          parsed = JSON.parse(text)
        } catch {
          // not JSON: keep the text
        }
        return {
          status: res.status,
          body: parsed,
          cookies: res.headers.getSetCookie(),
          location: res.headers.get('location') ?? '',
        }
      })
      for (const raw of response.cookies) {
        const [pair] = raw.split(';')
        const [name, ...rest] = pair!.split('=')
        const value = rest.join('=')
        const jar = new Map(
          cookie
            .split('; ')
            .filter(Boolean)
            .map((p) => [p.split('=')[0]!, p] as const),
        )
        if (value === '' || /max-age=0/i.test(raw)) jar.delete(name!)
        else jar.set(name!, pair!)
        cookie = [...jar.values()].join('; ')
      }
      return response
    }
    return {
      post: (path: string, body: Record<string, unknown>, ip?: string) =>
        call('POST', path, body, ip),
      get: (path: string, ip?: string) => call('GET', path, undefined, ip),
      cookie: () => cookie,
      hasSession: async () => {
        const res = await call('GET', '/get-session')
        return Boolean(
          res.body && typeof res.body === 'object' && (res.body as { user?: unknown }).user,
        )
      },
      convexToken: async () => {
        const res = await call('GET', '/convex/token')
        return res.status === 200 && Boolean((res.body as { token?: unknown } | null)?.token)
      },
    }
  }

  const lastMail = (type: BetterConvexAuthEmail['type'], to?: string) =>
    [...mails]
      .reverse()
      .find((m) => m.type === type && (!to || m.to.toLowerCase() === to.toLowerCase()))
  /** Every stored row of one model (setup and assertions only, never the path under test). */
  const rows = (model: string) =>
    test.query(authComponent.adapter.findMany, {
      model,
      paginationOpts: { cursor: null, numItems: 500 },
    })
  return {
    test,
    auth,
    http,
    client,
    mails,
    lastMail,
    rows,
    users: () => rows('user'),
    accounts: () => rows('account'),
    sessions: () => rows('session'),
  }
}

export type RealAuth = ReturnType<typeof createRealAuth>
export type RealAuthClient = ReturnType<RealAuth['client']>
