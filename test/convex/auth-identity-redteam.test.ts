/// <reference types="vite/client" />
// Red-team pass against the rc.3 auth safe-defaults (identity guards, dev outbox,
// factory). Each test states the attack and whether the guard HELD or is BROKEN.
// Harness copied from auth-identity-safe-defaults.test.ts (same convex-test wiring,
// real Better Auth 1.7.6, real component).
import { convexTest } from 'convex-test'
import { componentsGeneric, defineSchema, httpRouter } from 'convex/server'
import { afterAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import type { ComponentApi } from '../../src/runtime/convex-auth/component/_generated/component'
import authSchema from '../../src/runtime/convex-auth/component/schema'
import type {
  BetterConvexAuthEmail,
  CreateBetterConvexAuthOptions,
} from '../../src/runtime/convex-auth/create-better-convex-auth'
import anonymousSchema from '../fixtures/better-auth-anonymous/convex/betterAuth/schema'
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
const anonymousModules = import.meta.glob(
  '../fixtures/better-auth-anonymous/convex/betterAuth/**/*.ts',
)
const components = componentsGeneric() as unknown as {
  sessionAuth: ComponentApi<'sessionAuth'>
}

const VICTIM = 'victim@example.test'
const ATTACKER_PW = 'attacker-chosen-password-1'
const VICTIM_PW = 'victim-chosen-password-22'

type Opts = Omit<CreateBetterConvexAuthOptions<never>, 'email'> & {
  _twoFactorSchema?: boolean
  _anonymousSchema?: boolean
  _noEmailHook?: boolean
}

let ipCounter = 0
function freshIp() {
  ipCounter += 1
  return `198.51.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`
}

function setup(options: Opts) {
  const { _twoFactorSchema, _anonymousSchema, _noEmailHook, ...authOptions } = options
  const test = convexTest(defineSchema({}), rootModules)
  const [schema, modules] = _twoFactorSchema
    ? [twoFactorSchema, twoFactorModules]
    : _anonymousSchema
      ? [anonymousSchema, anonymousModules]
      : [authSchema, authModules]
  test.registerComponent('sessionAuth', schema, modules)
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
  const sessions = () =>
    test.query(components.sessionAuth.adapter.findMany, {
      model: 'session',
      paginationOpts: { cursor: null, numItems: 50 },
    })
  return { test, auth, client, mails, lastMail, users, accounts, sessions }
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

/** Run Better Auth's user-create before-hook as a request on `path` would. */
function createHook(s: ReturnType<typeof setup>) {
  return (user: object, path: string | null) =>
    s.test.action(async (ctx) => {
      const instance = await s.auth.createAuth(ctx)
      const context = (await instance.$context) as {
        options: {
          databaseHooks: {
            user: {
              create: {
                before: (user: object, context: { path: string } | null) => Promise<unknown>
              }
            }
          }
        }
      }
      try {
        await context.options.databaseHooks.user.create.before(
          user,
          path === null ? null : { path },
        )
        return 'allowed'
      } catch (error) {
        return (error as Error).message
      }
    })
}

// ---------------------------------------------------------------------------

describe('redteam: unverified user via non sign-up paths (D-e / I-03)', () => {
  useAuthEnvironment()

  it('HELD: the verified-unless-password-sign-up guard is an exact, fail-closed match', async () => {
    const before = createHook(setup({ emailAndPassword: {} }))
    const unverified = { email: VICTIM, emailVerified: false, name: 'x' }
    // Only the exact sign-up path may carry an unverified email.
    expect(await before(unverified, '/sign-up/email')).toBe('allowed')
    // Every near-miss spelling and every other mint path must throw.
    for (const path of [
      '/sign-up/email/',
      '/sign-up/email ',
      '/SIGN-UP/EMAIL',
      '/api/auth/sign-up/email',
      '//sign-up/email',
      '/sign-up/email/.',
      '/callback/:id',
      '/oauth2/callback/google',
      '/magic-link/verify',
      '/sign-in/anonymous',
    ]) {
      expect(await before(unverified, path)).toBe('AUTH_USER_CREATE_UNVERIFIED_EMAIL')
    }
  })

  it('HELD: a non-boolean-true emailVerified is treated as unverified (no == coercion)', async () => {
    const before = createHook(setup({ emailAndPassword: {} }))
    for (const emailVerified of [1, 'true', {}, 'yes'] as unknown[]) {
      expect(await before({ email: VICTIM, emailVerified, name: 'x' }, '/callback/:id')).toBe(
        'AUTH_USER_CREATE_UNVERIFIED_EMAIL',
      )
    }
    // A genuine anonymous guest (isAnonymous) is allowed even unverified.
    expect(
      await before(
        { email: 'anon@x', emailVerified: false, isAnonymous: true },
        '/sign-in/anonymous',
      ),
    ).toBe('allowed')
  })

  it('HELD: a create without an endpoint context is refused unless the address is verified', async () => {
    const before = createHook(setup({ emailAndPassword: {} }))
    // Server-side `internalAdapter.createUser` has no request, so no path to trust.
    expect(await before({ email: VICTIM, emailVerified: false, name: 'x' }, null)).toBe(
      'AUTH_USER_CREATE_UNVERIFIED_EMAIL',
    )
    expect(await before({ email: VICTIM, emailVerified: true, name: 'x' }, null)).toBe('allowed')
  })
})

describe('redteam: anonymous guest reaching an unverified email', () => {
  useAuthEnvironment()

  it('HELD: only an anonymous guest (isAnonymous) is exempt from the verified-email rule', async () => {
    // The anonymous plugin's functional flow needs a component with a generated
    // `_generated` dir; the shipped anonymous fixture has none, so convex-test
    // cannot register it. The guard itself is exercised here: isAnonymous is the
    // only non-sign-up exception, and a guest with a non-boolean isAnonymous is
    // still refused, so an upgrade that drops the flag cannot smuggle an
    // unverified social email in as a guest.
    const before = createHook(setup({ emailAndPassword: {} }))
    expect(
      await before(
        { email: VICTIM, emailVerified: false, isAnonymous: true },
        '/sign-in/anonymous',
      ),
    ).toBe('allowed')
    expect(
      await before({ email: VICTIM, emailVerified: false, isAnonymous: 'true' }, '/callback/:id'),
    ).toBe('AUTH_USER_CREATE_UNVERIFIED_EMAIL')
    expect(
      await before({ email: VICTIM, emailVerified: false, isAnonymous: 1 }, '/callback/:id'),
    ).toBe('AUTH_USER_CREATE_UNVERIFIED_EMAIL')
  })
})

describe('redteam: keep a session alive across verification (cookie cache / token)', () => {
  useAuthEnvironment()

  it('HELD (capability): verification deletes the squatter session row even with the cookie cache on; /get-session stays cosmetically stale', async () => {
    const s = setup({
      emailOTP: {},
      emailAndPassword: { requireEmailVerification: false },
      session: { cookieCache: { enabled: true, maxAge: 300 } },
    })
    const squatter = s.client()
    await squatter.post('/sign-up/email', { name: 'x', email: VICTIM, password: ATTACKER_PW })
    await squatter.post('/sign-in/email', { email: VICTIM, password: ATTACKER_PW })
    expect(await squatter.hasSession()).toBe(true)
    // The cookie cache is active (signed session_data carried in the jar).
    expect(squatter.cookie()).toMatch(/session_data/)
    expect((await s.sessions()).page.length).toBe(1)

    const owner = s.client()
    await owner.post('/email-otp/send-verification-otp', {
      email: VICTIM,
      type: 'email-verification',
    })
    const otp = (s.lastMail('email-otp', VICTIM) as { otp: string }).otp
    expect((await owner.post('/email-otp/verify-email', { email: VICTIM, otp })).status).toBe(200)

    // Source of truth: the squatter's session row is gone. The Convex token door
    // (`/convex/token`, plugin.ts:940-954) re-reads this live row and refuses
    // once it is missing, so no new data-access capability survives revocation.
    // (`/convex/token` itself cannot be minted in convex-test: no JWKS operator
    // setup, so the deleted session row is the proof.)
    expect((await s.sessions()).page.length).toBe(0)

    // Observed residual, cosmetic only: with session.cookieCache enabled, Better
    // Auth's own `/get-session` keeps returning the signed session_data cookie's
    // stale user for up to cookieCache.maxAge (<= 5 min). It is not the token
    // path, so it grants no Convex data access. A client UI could briefly still
    // show "signed in". Recorded for the maintainer.
    expect(await squatter.hasSession()).toBe(true)
  })
})

describe('redteam: 2FA bypass with the one allowed combo (password + twoFactor)', () => {
  useAuthEnvironment()

  async function signUp(s: ReturnType<typeof setup>) {
    await s.client().post('/sign-up/email', { name: 'x', email: VICTIM, password: VICTIM_PW })
  }
  async function enableTwoFactorFlag(s: ReturnType<typeof setup>) {
    await s.test.mutation(components.sessionAuth.adapter.updateMany, {
      model: 'user',
      where: [{ field: 'email', operator: 'eq', value: VICTIM }],
      update: { twoFactorEnabled: true },
    })
  }

  it('HELD: password sign-in challenges 2FA and mints no session', async () => {
    const s = setup({
      _twoFactorSchema: true,
      emailAndPassword: { requireEmailVerification: false },
      twoFactor: {},
    })
    await signUp(s)
    await enableTwoFactorFlag(s)
    const attacker = s.client()
    const res = await attacker.post('/sign-in/email', { email: VICTIM, password: VICTIM_PW })
    expect((res.body as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(true)
    expect(await attacker.hasSession()).toBe(false)
    expect((await s.sessions()).page.length).toBe(0)
  })

  it('HELD: the password reset flow mints no session, so it cannot skip 2FA', async () => {
    const s = setup({
      _twoFactorSchema: true,
      emailAndPassword: { requireEmailVerification: false, passwordReset: true },
      twoFactor: {},
    })
    await signUp(s)
    await enableTwoFactorFlag(s)
    const attacker = s.client()
    await attacker.post('/request-password-reset', { email: VICTIM })
    const mail = s.lastMail('reset-password', VICTIM) as { token: string }
    const done = await attacker.post('/reset-password', {
      token: mail.token,
      newPassword: ATTACKER_PW,
    })
    expect(done.status).toBe(200)
    // Reset does not sign in: no session is minted, so 2FA cannot be skipped.
    expect(await attacker.hasSession()).toBe(false)
    expect((await s.sessions()).page.length).toBe(0)
  })
})

describe('redteam: change-password revokeOtherSessions override by body', () => {
  useAuthEnvironment()

  it('HELD: a body flag of revokeOtherSessions:false cannot keep another session alive', async () => {
    const s = setup({ emailAndPassword: { requireEmailVerification: false } })
    const other = s.client()
    await other.post('/sign-up/email', { name: 'x', email: VICTIM, password: ATTACKER_PW })
    await other.post('/sign-in/email', { email: VICTIM, password: ATTACKER_PW })
    const me = s.client()
    await me.post('/sign-in/email', { email: VICTIM, password: ATTACKER_PW })
    const changed = await me.post('/change-password', {
      currentPassword: ATTACKER_PW,
      newPassword: VICTIM_PW,
      revokeOtherSessions: false,
    })
    expect(changed.status).toBe(200)
    expect(await me.hasSession()).toBe(true)
    expect(await other.hasSession()).toBe(false)
  })
})

describe('redteam: beforeUserCreate email patch tricks (D-f / I-04)', () => {
  useAuthEnvironment()

  async function otpSignIn(s: ReturnType<typeof setup>, email: string) {
    const c = s.client()
    await c.post('/email-otp/send-verification-otp', { email, type: 'sign-in' })
    const otp = (s.lastMail('email-otp', email) as { otp: string }).otp
    return await c.post('/sign-in/email-otp', { email, otp })
  }

  it('HELD: a homoglyph / different-script patch email is rejected', async () => {
    // Proven mailbox is attacker-controlled; hook tries to swap in a Latin
    // look-alike of a different address. Cyrillic "а" (U+0430) != Latin "a".
    const s = setup({
      emailOTP: {},
      beforeUserCreate: async () => ({ allowed: true, user: { email: 'pаypal@example.test' } }),
    } as never)
    const res = await otpSignIn(s, 'attacker@example.test')
    expect(res.status).not.toBe(200)
    expect((await s.users()).page).toHaveLength(0)
  })

  it('HELD: leading/trailing whitespace in a patch email is rejected', async () => {
    const s = setup({
      emailOTP: {},
      beforeUserCreate: async ({ user }: { user: { email: string } }) => ({
        allowed: true,
        user: { email: `  ${user.email}  ` },
      }),
    } as never)
    const res = await otpSignIn(s, 'attacker@example.test')
    expect(res.status).not.toBe(200)
    expect((await s.users()).page).toHaveLength(0)
  })

  it('HELD: a Unicode look-alike that folds to a different address is rejected', async () => {
    // U+212A KELVIN SIGN folds to "k": "keKin" -> "kekin", which is not the
    // clean "kevin" the patch tries to claim, so the swap is refused.
    const s = setup({
      emailOTP: {},
      beforeUserCreate: async () => ({ allowed: true, user: { email: 'kevin@example.test' } }),
    } as never)
    expect((await otpSignIn(s, 'keKin@example.test')).status).not.toBe(200)
    expect((await s.users()).page).toHaveLength(0)
  })

  it('HELD: an uppercase patch that folds to the proven address is stored canonically', async () => {
    const s = setup({
      emailOTP: {},
      beforeUserCreate: async ({ user }: { user: { email: string } }) => ({
        allowed: true,
        user: { email: user.email.toUpperCase() },
      }),
    } as never)
    expect((await otpSignIn(s, 'victim@example.test')).status).toBe(200)
    expect((await s.users()).page.map((u) => (u as { email: string }).email)).toEqual([
      'victim@example.test',
    ])
  })

  it('PROBE: a mixed-case proven email with no beforeUserCreate hook', async () => {
    // D-f claims the stored email is "always lower-case". With no hook the
    // library returns the user unchanged; this records whether a second OTP
    // sign-in with the lower-case spelling still finds the row (no lockout).
    const s = setup({ emailOTP: {} })
    expect((await otpSignIn(s, 'Mixed@Example.test')).status).toBe(200)
    const stored = (await s.users()).page.map((u) => (u as { email: string }).email)
    const second = await otpSignIn(s, 'mixed@example.test')
    expect({ stored, secondStatus: second.status, rows: (await s.users()).page.length }).toEqual({
      stored: ['mixed@example.test'],
      secondStatus: 200,
      rows: 1,
    })
  })
})

describe('redteam: emailOTP option smuggling past the whitelist (I-09)', () => {
  useAuthEnvironment()

  it('HELD: a prototype-injected changeEmail does not reach Better Auth', async () => {
    const smuggled = { changeEmail: { enabled: true } }
    const emailOTP = Object.create(smuggled) as Record<string, unknown>
    // Not an own key: the whitelist passes, but the spread into emailOTP() must
    // not carry it, so changeEmail never activates.
    expect(Object.hasOwn(emailOTP, 'changeEmail')).toBe(false)
    const s = setup({ emailOTP: emailOTP as never })
    const hasChangeEmail = await s.test.action(async (ctx) => {
      const instance = await s.auth.createAuth(ctx)
      const context = (await instance.$context) as {
        options: { plugins: { id: string; options?: Record<string, unknown> }[] }
      }
      const options = context.options.plugins.find((p) => p.id === 'email-otp')?.options
      return Boolean(options && Object.hasOwn(options, 'changeEmail'))
    })
    expect(hasChangeEmail).toBe(false)
  })

  it('HELD: an own changeEmail key or any unknown key is rejected at construction', () => {
    expect(() =>
      createBetterConvexAuth(components.sessionAuth, {
        email: async () => {},
        emailOTP: { changeEmail: { enabled: true } },
      } as never),
    ).toThrow(/changeEmail/)
    expect(() =>
      createBetterConvexAuth(components.sessionAuth, {
        email: async () => {},
        emailOTP: { ['__proto__']: { changeEmail: true }, note: 1 } as never,
      } as never),
    ).toThrow()
  })
})

describe('redteam: organization invitation requires a verified email', () => {
  useAuthEnvironment()

  async function orgInvitationFlag(options: object) {
    const s = setup(options as never)
    return s.test.action(async (ctx) => {
      const instance = await s.auth.createAuth(ctx)
      const context = (await instance.$context) as {
        options: { plugins: { id: string; options?: Record<string, unknown> }[] }
      }
      return context.options.plugins.find((p) => p.id === 'organization')?.options
        ?.requireEmailVerificationOnInvitation
    })
  }

  it('HELD: the default is true', async () => {
    expect(await orgInvitationFlag({ organization: {} })).toBe(true)
  })

  it('NOTE: an app can still override the invitation gate to false (visible, un-whitelisted)', async () => {
    // Recorded for the maintainer: organization options are pass-through, so a
    // spread override is possible, unlike emailOTP keys which are whitelisted.
    expect(
      await orgInvitationFlag({ organization: { requireEmailVerificationOnInvitation: false } }),
    ).toBe(false)
  })
})
