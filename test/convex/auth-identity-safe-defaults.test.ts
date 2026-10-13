/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { componentsGeneric, defineSchema, httpRouter } from 'convex/server'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComponentApi } from '../../src/runtime/convex-auth/component/_generated/component'
import authSchema from '../../src/runtime/convex-auth/component/schema'
import type {
  BetterConvexAuthEmail,
  CreateBetterConvexAuthOptions,
} from '../../src/runtime/convex-auth/create-better-convex-auth'
import twoFactorSchema from '../fixtures/better-auth-two-factor/convex/betterAuth/schema'

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
const twoFactorModules = import.meta.glob(
  '../fixtures/better-auth-two-factor/convex/betterAuth/**/*.ts',
)
const components = componentsGeneric() as unknown as {
  sessionAuth: ComponentApi<'sessionAuth'>
}

const VICTIM = 'victim@example.test'
const ATTACKER_PW = 'attacker-chosen-password-1'
const VICTIM_PW = 'victim-chosen-password-22'

type Opts = Omit<CreateBetterConvexAuthOptions<never>, 'email'> & {
  _twoFactorSchema?: boolean
  _noEmailHook?: boolean
}

let ipCounter = 0
function freshIp() {
  ipCounter += 1
  return `198.51.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`
}

function setup(options: Opts) {
  const { _twoFactorSchema, _noEmailHook, ...authOptions } = options
  const test = convexTest(defineSchema({}), rootModules)
  test.registerComponent(
    'sessionAuth',
    _twoFactorSchema ? twoFactorSchema : authSchema,
    _twoFactorSchema ? twoFactorModules : authModules,
  )
  const mails: BetterConvexAuthEmail[] = []
  const auth = createBetterConvexAuth(components.sessionAuth, {
    ...(_noEmailHook
      ? {}
      : {
          email: async (_ctx: unknown, message: BetterConvexAuthEmail) => {
            mails.push(message)
          },
        }),
    ...(authOptions as object),
  } as never)
  const http = httpRouter()
  auth.registerRoutes(http)

  function client(fixedIp?: string) {
    let cookie = ''
    async function call(
      method: 'GET' | 'POST',
      path: string,
      body?: Record<string, unknown>,
      ip = fixedIp ?? freshIp(),
    ) {
      const response = await test.action(async (ctx) => {
        const url = new URL(`https://deployment.convex.site/api/auth${path}`)
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
              Origin: process.env.SITE_URL ?? 'https://app.example.test',
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
        return { status: res.status, body: parsed, cookies: res.headers.getSetCookie() }
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
    [...mails].reverse().find((m) => m.type === type && (!to || m.to === to))
  const users = () =>
    test.query(components.sessionAuth.adapter.findMany, {
      model: 'user',
      paginationOpts: { cursor: null, numItems: 50 },
    })
  const accounts = () =>
    test.query(components.sessionAuth.adapter.findMany, {
      model: 'account',
      paginationOpts: { cursor: null, numItems: 50 },
    })
  return { test, auth, client, mails, lastMail, users, accounts }
}

function useAuthEnvironment() {
  beforeEach(() => {
    vi.stubEnv('SITE_URL', 'https://app.example.test')
    vi.stubEnv('CONVEX_SITE_URL', 'https://deployment.convex.site')
    vi.stubEnv('BETTER_AUTH_SECRETS', `0:${'test-secret'.repeat(4)}`)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })
}

describe('safe auth defaults', () => {
  useAuthEnvironment()

  it('keeps password sign-in off unless the app names emailAndPassword', async () => {
    const s = setup({ emailOTP: {} })
    const attacker = s.client()
    const up = await attacker.post('/sign-up/email', {
      name: 'x',
      email: VICTIM,
      password: ATTACKER_PW,
    })
    expect(up.status).toBeGreaterThanOrEqual(400)
    expect((await s.users()).page).toHaveLength(0)
    const inn = await attacker.post('/sign-in/email', { email: VICTIM, password: ATTACKER_PW })
    expect(inn.status).toBeGreaterThanOrEqual(400)
    expect(await attacker.hasSession()).toBe(false)
  })

  it('requires a verified address for password sign-in when emailAndPassword is an object', async () => {
    const s = setup({ emailAndPassword: {} })
    await s.client().post('/sign-up/email', { name: 'x', email: VICTIM, password: ATTACKER_PW })
    const blocked = await s.client().post('/sign-in/email', {
      email: VICTIM,
      password: ATTACKER_PW,
    })
    expect(blocked.status).toBe(403)
    expect(s.lastMail('verify-email', VICTIM)).toBeDefined()
  })

  it('lets an app choose to sign in before verification with an explicit false', async () => {
    const s = setup({ emailAndPassword: { requireEmailVerification: false } })
    await s.client().post('/sign-up/email', { name: 'x', email: VICTIM, password: ATTACKER_PW })
    const ok = await s.client().post('/sign-in/email', { email: VICTIM, password: ATTACKER_PW })
    expect(ok.status).toBe(200)
  })

  it('ends every earlier session when a password is reset, unless the app opts out', async () => {
    const run = async (revoke: boolean | undefined) => {
      const s = setup({
        emailAndPassword: {
          passwordReset: true,
          requireEmailVerification: false,
          ...(revoke === undefined ? {} : { revokeSessionsOnPasswordReset: revoke }),
        },
      })
      const squatter = s.client()
      await squatter.post('/sign-up/email', { name: 'x', email: VICTIM, password: ATTACKER_PW })
      await squatter.post('/sign-in/email', { email: VICTIM, password: ATTACKER_PW })
      await s.client().post('/request-password-reset', { email: VICTIM })
      const mail = s.lastMail('reset-password', VICTIM) as { token: string }
      const done = await s
        .client()
        .post('/reset-password', { token: mail.token, newPassword: VICTIM_PW })
      expect(done.status).toBe(200)
      return await squatter.hasSession()
    }
    expect(await run(undefined)).toBe(false)
    expect(await run(false)).toBe(true)
  })

  it('ends other sessions when a signed-in person changes the password', async () => {
    const s = setup({ emailAndPassword: { requireEmailVerification: false } })
    const other = s.client()
    await other.post('/sign-up/email', { name: 'x', email: VICTIM, password: ATTACKER_PW })
    await other.post('/sign-in/email', { email: VICTIM, password: ATTACKER_PW })
    const me = s.client()
    await me.post('/sign-in/email', { email: VICTIM, password: ATTACKER_PW })
    const changed = await me.post('/change-password', {
      currentPassword: ATTACKER_PW,
      newPassword: VICTIM_PW,
    })
    expect(changed.status).toBe(200)
    expect(await me.hasSession()).toBe(true)
    expect(await other.hasSession()).toBe(false)
  })

  it('stores email codes hashed', async () => {
    const s = setup({ emailOTP: {} })
    await s.client().post('/email-otp/send-verification-otp', { email: VICTIM, type: 'sign-in' })
    const otp = (s.lastMail('email-otp', VICTIM) as { otp: string }).otp
    const rows = await s.test.query(components.sessionAuth.adapter.findMany, {
      model: 'verification',
      paginationOpts: { cursor: null, numItems: 20 },
    })
    expect(rows.page.length).toBeGreaterThan(0)
    for (const row of rows.page) expect(String((row as { value: string }).value)).not.toContain(otp)
  })

  it('requires a verified email to accept an organization invitation by default', async () => {
    const s = setup({ organization: {} })
    const flag = await s.test.action(async (ctx) => {
      const instance = await s.auth.createAuth(ctx)
      const context = (await instance.$context) as {
        options: { plugins: { id: string; options?: Record<string, unknown> }[] }
      }
      return context.options.plugins.find((plugin) => plugin.id === 'organization')?.options
        ?.requireEmailVerificationOnInvitation
    })
    expect(flag).toBe(true)
  })

  it('rejects emailOTP.changeEmail and unknown emailOTP keys at construction', () => {
    expect(() =>
      createBetterConvexAuth(components.sessionAuth, {
        email: async () => {},
        emailOTP: { changeEmail: { enabled: true } },
      } as never),
    ).toThrow(/changeEmail/)
    expect(() =>
      createBetterConvexAuth(components.sessionAuth, {
        email: async () => {},
        emailOTP: { surprise: true },
      } as never),
    ).toThrow(/surprise/)
  })
})

describe('auth email without an email hook', () => {
  useAuthEnvironment()

  it('writes codes to the log on a loopback SITE_URL and the code signs in', async () => {
    vi.stubEnv('SITE_URL', 'http://localhost:3000')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const s = setup({ _noEmailHook: true, emailOTP: {} })
    const client = s.client()
    await client.post('/email-otp/send-verification-otp', { email: VICTIM, type: 'sign-in' })
    const line = log.mock.calls.map((call) => String(call[0])).find((text) => text.includes(VICTIM))
    const otp = /code (\d+)/.exec(line ?? '')?.[1]
    expect(otp).toBeDefined()
    const res = await client.post('/sign-in/email-otp', { email: VICTIM, otp })
    expect(res.status).toBe(200)
  })

  it('refuses to start a non-loopback deployment that must send mail without a hook', () => {
    const build = (options: object) => () =>
      createBetterConvexAuth(components.sessionAuth, options as never)
    expect(build({ emailOTP: {} })).toThrow(/"email" option/)
    expect(build({ emailAndPassword: {} })).toThrow(/"email" option/)
    expect(
      build({ emailAndPassword: { requireEmailVerification: false, passwordReset: true } }),
    ).toThrow(/"email" option/)
    expect(build({ organization: {} })).toThrow(/"email" option/)
    // No mail needed: no error.
    expect(build({})).not.toThrow()
    expect(build({ emailAndPassword: { requireEmailVerification: false } })).not.toThrow()
  })

  it('does not treat NODE_ENV or a lookalike host as local', () => {
    for (const siteUrl of ['https://localhost.evil.test', 'https://app.example.test']) {
      vi.stubEnv('SITE_URL', siteUrl)
      expect(() =>
        createBetterConvexAuth(components.sessionAuth, { emailOTP: {} } as never),
      ).toThrow(/"email" option/)
    }
  })
})

describe('email verification ends earlier sessions', () => {
  useAuthEnvironment()

  it('ends a squatter session when the owner verifies with an email code', async () => {
    const s = setup({
      emailOTP: {},
      emailAndPassword: { requireEmailVerification: false },
    })
    const squatter = s.client()
    await squatter.post('/sign-up/email', { name: 'x', email: VICTIM, password: ATTACKER_PW })
    await squatter.post('/sign-in/email', { email: VICTIM, password: ATTACKER_PW })
    expect(await squatter.hasSession()).toBe(true)

    const owner = s.client()
    await owner.post('/email-otp/send-verification-otp', {
      email: VICTIM,
      type: 'email-verification',
    })
    const otp = (s.lastMail('email-otp', VICTIM) as { otp: string }).otp
    const verified = await owner.post('/email-otp/verify-email', { email: VICTIM, otp })
    expect(verified.status).toBe(200)
    expect((await s.users()).page[0]).toMatchObject({ emailVerified: true })
    expect(await squatter.hasSession()).toBe(false)
  })

  it('ends a squatter session when the owner opens the verification link, and keeps the auto sign-in', async () => {
    const s = setup({
      emailAndPassword: { requireEmailVerification: false },
      emailVerification: { autoSignInAfterVerification: true },
    })
    const squatter = s.client()
    await squatter.post('/sign-up/email', { name: 'x', email: VICTIM, password: ATTACKER_PW })
    await squatter.post('/sign-in/email', { email: VICTIM, password: ATTACKER_PW })
    expect(await squatter.hasSession()).toBe(true)
    await squatter.post('/send-verification-email', { email: VICTIM })

    const mail = s.lastMail('verify-email', VICTIM) as { url: string }
    const url = new URL(mail.url)
    const owner = s.client()
    const click = await owner.get(`${url.pathname.replace('/api/auth', '')}${url.search}`)
    expect([200, 302]).toContain(click.status)
    expect((await s.users()).page[0]).toMatchObject({ emailVerified: true })
    expect(await squatter.hasSession()).toBe(false)
    expect(await owner.hasSession()).toBe(true)
  })

  it('keeps the sign-in OTP mitigation: a squatter password is gone after an OTP sign-in', async () => {
    const s = setup({ emailOTP: {}, emailAndPassword: { requireEmailVerification: false } })
    const squatter = s.client()
    await squatter.post('/sign-up/email', { name: 'x', email: VICTIM, password: ATTACKER_PW })
    await squatter.post('/sign-in/email', { email: VICTIM, password: ATTACKER_PW })
    const owner = s.client()
    await owner.post('/email-otp/send-verification-otp', { email: VICTIM, type: 'sign-in' })
    const otp = (s.lastMail('email-otp', VICTIM) as { otp: string }).otp
    expect((await owner.post('/sign-in/email-otp', { email: VICTIM, otp })).status).toBe(200)
    expect(await owner.hasSession()).toBe(true)
    expect(await squatter.hasSession()).toBe(false)
    const retry = await s.client().post('/sign-in/email', { email: VICTIM, password: ATTACKER_PW })
    expect(retry.status).not.toBe(200)
  })
})

describe('two-factor combinations', () => {
  useAuthEnvironment()

  it('rejects twoFactor together with emailOTP or socialProviders, because they skip the challenge', () => {
    const build = (options: object) => () =>
      createBetterConvexAuth(components.sessionAuth, {
        email: async () => {},
        ...options,
      } as never)
    expect(build({ twoFactor: {}, emailOTP: {} })).toThrow(/twoFactor.*emailOTP/)
    expect(
      build({ twoFactor: {}, socialProviders: { github: { clientId: 'a', clientSecret: 'b' } } }),
    ).toThrow(/twoFactor.*socialProviders/)
    expect(build({ twoFactor: {}, socialProviders: () => ({}) })).toThrow(/socialProviders/)
    expect(build({ twoFactor: {}, emailAndPassword: {} })).not.toThrow()
    expect(build({ emailOTP: {}, socialProviders: {}, twoFactor: false })).not.toThrow()
  })
})

describe('users with an unverified email', () => {
  useAuthEnvironment()

  /** Run Better Auth's user-create hook as a request on `path` would. */
  function createHook(options: object) {
    const s = setup(options as never)
    return (user: object, path: string) =>
      s.test.action(async (ctx) => {
        const instance = await s.auth.createAuth(ctx)
        const context = (await instance.$context) as {
          options: {
            databaseHooks: {
              user: {
                create: { before: (user: object, context: { path: string }) => Promise<unknown> }
              }
            }
          }
        }
        try {
          await context.options.databaseHooks.user.create.before(user, { path })
          return 'allowed'
        } catch (error) {
          return (error as Error).message
        }
      })
  }

  it('refuses an unverified user from a social callback, but allows password sign-up', async () => {
    const before = createHook({ emailAndPassword: {} })
    const unverified = { email: VICTIM, emailVerified: false, name: 'x' }
    expect(await before(unverified, '/callback/:id')).toBe('AUTH_USER_CREATE_UNVERIFIED_EMAIL')
    expect(await before(unverified, '/sign-up/email')).toBe('allowed')
    expect(await before({ ...unverified, emailVerified: true }, '/callback/:id')).toBe('allowed')
  })

  it('does not reach beforeUserCreate for a refused unverified social user', async () => {
    const seen: string[] = []
    const before = createHook({
      emailAndPassword: {},
      beforeUserCreate: async ({ user }: { user: { email: string } }) => {
        seen.push(user.email)
        return { allowed: true }
      },
    })
    expect(await before({ email: VICTIM, emailVerified: false, name: 'x' }, '/callback/:id')).toBe(
      'AUTH_USER_CREATE_UNVERIFIED_EMAIL',
    )
    expect(seen).toEqual([])
  })
})

describe('beforeUserCreate email', () => {
  useAuthEnvironment()

  async function otpSignIn(s: ReturnType<typeof setup>, email: string) {
    const client = s.client()
    await client.post('/email-otp/send-verification-otp', { email, type: 'sign-in' })
    const otp = (s.lastMail('email-otp', email) as { otp: string }).otp
    return await client.post('/sign-in/email-otp', { email, otp })
  }

  it('refuses a replacement email that is not the proven address', async () => {
    const s = setup({
      emailOTP: {},
      beforeUserCreate: async ({ user }: { user: { email: string } }) => ({
        allowed: true,
        user: { email: user.email.replace('alias+', '') },
      }),
    } as never)
    const res = await otpSignIn(s, 'alias+victim2@example.test')
    expect(res.status).not.toBe(200)
    expect((await s.users()).page).toHaveLength(0)
  })

  it('stores a mixed-case replacement in lower case so the next sign-in finds the user', async () => {
    const s = setup({
      emailOTP: {},
      beforeUserCreate: async () => ({ allowed: true, user: { email: 'Mixed@Example.test' } }),
    } as never)
    expect((await otpSignIn(s, 'mixed@example.test')).status).toBe(200)
    expect((await otpSignIn(s, 'mixed@example.test')).status).toBe(200)
    expect((await s.users()).page.map((user) => (user as { email: string }).email)).toEqual([
      'mixed@example.test',
    ])
  })
})
