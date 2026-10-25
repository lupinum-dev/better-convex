/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  authComponent,
  createBetterConvexAuth,
  createRealAuth,
  useAuthEnvironment,
  type RealAuth,
  type RealAuthClient,
} from '../helpers/real-auth'

const VICTIM = 'victim@example.test'
const ATTACKER_PW = 'attacker-chosen-password-1'
const VICTIM_PW = 'victim-chosen-password-22'

const realFetch = globalThis.fetch
/** Answer the GitHub token exchange; every other request goes out unchanged. */
function stubGithubToken() {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.startsWith('https://github.com/login/oauth/access_token')) {
      return Response.json({ access_token: 'gho_test', token_type: 'bearer', scope: 'user:email' })
    }
    return realFetch(input as RequestInfo, init)
  })
}

/** A github provider that reports `VICTIM` with the given verification state. */
const github = (emailVerified: boolean) => ({
  github: {
    clientId: 'id',
    clientSecret: 'secret',
    getUserInfo: async () => ({
      user: { id: 'gh-1', name: 'Gh', email: VICTIM, image: undefined, emailVerified },
      data: { id: 'gh-1' },
    }),
  },
})

/** Run a real social sign-in: start, then the provider's callback. */
async function socialSignIn(
  client: RealAuthClient,
  errorCallbackURL = 'https://app.example.test/',
) {
  const start = await client.post('/sign-in/social', {
    provider: 'github',
    callbackURL: 'https://app.example.test/',
    errorCallbackURL,
  })
  const state = new URL((start.body as { url: string }).url).searchParams.get('state')
  return await client.get(`/callback/github?code=abc&state=${state}`)
}

describe('safe auth defaults', () => {
  useAuthEnvironment()

  it('keeps password sign-in off unless the app names emailAndPassword', async () => {
    const s = createRealAuth({ emailOTP: {} })
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
    const s = createRealAuth({ emailAndPassword: {} })
    await s.client().post('/sign-up/email', { name: 'x', email: VICTIM, password: ATTACKER_PW })
    const blocked = await s.client().post('/sign-in/email', {
      email: VICTIM,
      password: ATTACKER_PW,
    })
    expect(blocked.status).toBe(403)
    expect(s.lastMail('verify-email', VICTIM)).toBeDefined()
  })

  it('lets an app choose to sign in before verification with an explicit false', async () => {
    const s = createRealAuth({ emailAndPassword: { requireEmailVerification: false } })
    await s.client().post('/sign-up/email', { name: 'x', email: VICTIM, password: ATTACKER_PW })
    const ok = await s.client().post('/sign-in/email', { email: VICTIM, password: ATTACKER_PW })
    expect(ok.status).toBe(200)
  })

  it('ends every earlier session when a password is reset, unless the app opts out', async () => {
    const run = async (revoke: boolean | undefined) => {
      const s = createRealAuth({
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
    const s = createRealAuth({ emailAndPassword: { requireEmailVerification: false } })
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
    const s = createRealAuth({ emailOTP: {} })
    await s.client().post('/email-otp/send-verification-otp', { email: VICTIM, type: 'sign-in' })
    const otp = (s.lastMail('email-otp', VICTIM) as { otp: string }).otp
    const rows = await s.test.query(authComponent.adapter.findMany, {
      model: 'verification',
      paginationOpts: { cursor: null, numItems: 20 },
    })
    expect(rows.page.length).toBeGreaterThan(0)
    for (const row of rows.page) expect(String((row as { value: string }).value)).not.toContain(otp)
  })

  it('refuses an unverified user who accepts an organization invitation, then lets them in once verified', async () => {
    const s = createRealAuth(
      {
        organization: {},
        emailOTP: {},
        emailAndPassword: { requireEmailVerification: false },
      },
      { component: 'organization' },
    )
    const owner = s.client()
    await owner.post('/sign-up/email', {
      name: 'Owner',
      email: 'owner@example.test',
      password: VICTIM_PW,
    })
    await owner.post('/sign-in/email', { email: 'owner@example.test', password: VICTIM_PW })
    const organization = (await owner.post('/organization/create', { name: 'Org', slug: 'org' }))
      .body as { id: string }
    await owner.post('/organization/invite-member', {
      email: VICTIM,
      role: 'member',
      organizationId: organization.id,
    })
    const invitation = s.lastMail('organization-invitation', VICTIM) as { invitationId: string }

    const invitee = s.client()
    await invitee.post('/sign-up/email', { name: 'x', email: VICTIM, password: ATTACKER_PW })
    await invitee.post('/sign-in/email', { email: VICTIM, password: ATTACKER_PW })
    const refused = await invitee.post('/organization/accept-invitation', {
      invitationId: invitation.invitationId,
    })
    expect(refused.status).toBe(403)

    await invitee.post('/email-otp/send-verification-otp', {
      email: VICTIM,
      type: 'email-verification',
    })
    const otp = (s.lastMail('email-otp', VICTIM) as { otp: string }).otp
    await invitee.post('/email-otp/verify-email', { email: VICTIM, otp })
    await invitee.post('/sign-in/email', { email: VICTIM, password: ATTACKER_PW })
    const accepted = await invitee.post('/organization/accept-invitation', {
      invitationId: invitation.invitationId,
    })
    expect(accepted.status).toBe(200)
  })

  it('rejects emailOTP.changeEmail and unknown emailOTP keys at construction', () => {
    expect(() =>
      createBetterConvexAuth(authComponent, {
        email: async () => {},
        emailOTP: { changeEmail: { enabled: true } },
      } as never),
    ).toThrow(/changeEmail/)
    expect(() =>
      createBetterConvexAuth(authComponent, {
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
    const s = createRealAuth({ emailOTP: {} }, { email: false })
    const client = s.client()
    await client.post('/email-otp/send-verification-otp', { email: VICTIM, type: 'sign-in' })
    const line = log.mock.calls.map((call) => String(call[0])).find((text) => text.includes(VICTIM))
    const otp = /code (\d+)/.exec(line ?? '')?.[1]
    expect(otp).toBeDefined()
    const res = await client.post('/sign-in/email-otp', { email: VICTIM, otp })
    expect(res.status).toBe(200)
  })

  it('refuses to start a non-loopback deployment that must send mail without a hook', () => {
    const build = (options: object) => () => createBetterConvexAuth(authComponent, options as never)
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

  it('does not treat a lookalike host as local', () => {
    for (const siteUrl of ['https://localhost.evil.test', 'https://app.example.test']) {
      vi.stubEnv('SITE_URL', siteUrl)
      expect(() => createBetterConvexAuth(authComponent, { emailOTP: {} } as never)).toThrow(
        /"email" option/,
      )
    }
  })

  it('does not treat NODE_ENV=development as local when SITE_URL is public', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(() => createBetterConvexAuth(authComponent, { emailOTP: {} } as never)).toThrow(
      /"email" option/,
    )
  })

  it('counts only canonical loopback spellings as local', () => {
    const build = () => createBetterConvexAuth(authComponent, { emailOTP: {} } as never)
    for (const siteUrl of [
      'http://127.1',
      'http://0x7f000001',
      'http://LOCALHOST:3000',
      'http://localhost:3000/app',
      'http://user@localhost:3000',
      'http://app.localhost:3000',
    ]) {
      vi.stubEnv('SITE_URL', siteUrl)
      expect(build, siteUrl).toThrow(/"email" option/)
    }
    for (const siteUrl of ['http://localhost:3000', 'http://127.0.0.1:4567', 'http://[::1]:3000']) {
      vi.stubEnv('SITE_URL', siteUrl)
      expect(build, siteUrl).not.toThrow()
    }
  })

  it('does not use the dev outbox when siteOrigins lists other origins', () => {
    vi.stubEnv('SITE_URL', 'http://localhost:3000')
    expect(() =>
      createBetterConvexAuth(authComponent, {
        emailOTP: {},
        siteOrigins: ['https://app.example.test'],
      } as never),
    ).toThrow(/"email" option/)
  })
  it('loads with SITE_URL unset, then fails sending mail with an error that names the fix', async () => {
    vi.stubEnv('SITE_URL', '')
    // The first `convex dev` push happens before SITE_URL is set: it must succeed.
    const s = createRealAuth({ emailAndPassword: {}, emailOTP: {} }, { email: false })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logged = () =>
      error.mock.calls
        .flat()
        .map((arg) => (arg instanceof Error ? arg.message : JSON.stringify(arg)))
        .join('\n')
    // Without SITE_URL no request can run at all, and the log names SITE_URL.
    await expect(s.test.action(async (ctx) => await s.auth.createAuth(ctx))).rejects.toThrow(
      /AUTH_CONFIG_INVALID/,
    )
    expect(logged()).toMatch(/SITE_URL is required/)
    // SITE_URL set later, still no email hook: the send fails and says what to add.
    vi.stubEnv('SITE_URL', 'https://app.example.test')
    await s.client().post('/sign-up/email', { name: 'x', email: VICTIM, password: VICTIM_PW })
    expect(logged()).toMatch(/"email" hook/)
    expect(logged()).toMatch(/SITE_URL is not a loopback origin/)
  })
})

describe('email verification ends earlier sessions', () => {
  useAuthEnvironment()

  it('ends a squatter session when the owner verifies with an email code', async () => {
    const s = createRealAuth({
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
    const s = createRealAuth({
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
    const s = createRealAuth({
      emailOTP: {},
      emailAndPassword: { requireEmailVerification: false },
    })
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

describe('social provider options', () => {
  useAuthEnvironment()

  it('rejects overrideUserInfoOnSignIn in a static socialProviders object', () => {
    expect(() =>
      createBetterConvexAuth(authComponent, {
        socialProviders: {
          github: { clientId: 'a', clientSecret: 'b', overrideUserInfoOnSignIn: true },
        },
      } as never),
    ).toThrow(/overrideUserInfoOnSignIn/)
  })

  it('rejects overrideUserInfoOnSignIn in the function form when the auth is built', async () => {
    const s = createRealAuth({
      socialProviders: () => ({
        github: { clientId: 'a', clientSecret: 'b', overrideUserInfoOnSignIn: true },
      }),
    } as never)
    await expect(s.test.action(async (ctx) => await s.auth.createAuth(ctx))).rejects.toThrow(
      /overrideUserInfoOnSignIn|AUTH_CONFIG/,
    )
  })
})

describe('email code password reset', () => {
  useAuthEnvironment()
  const resetPaths = ['/email-otp/request-password-reset', '/email-otp/reset-password']

  it('is closed unless emailAndPassword.passwordReset is true', async () => {
    const s = createRealAuth({ emailOTP: {}, emailAndPassword: {} })
    for (const path of [...resetPaths, '/forget-password/email-otp']) {
      const res = await s.client().post(path, { email: VICTIM, otp: '123456', password: VICTIM_PW })
      expect(res.status, path).toBe(404)
    }
    expect(s.lastMail('email-otp', VICTIM)).toBeUndefined()
  })

  it('works when the app names passwordReset', async () => {
    const s = createRealAuth({ emailOTP: {}, emailAndPassword: { passwordReset: true } })
    const res = await s.client().post('/email-otp/request-password-reset', { email: VICTIM })
    expect(res.status).toBe(200)
  })
})

describe('two-factor combinations', () => {
  useAuthEnvironment()

  it('rejects twoFactor together with emailOTP or socialProviders, because they skip the challenge', () => {
    const build = (options: object) => () =>
      createBetterConvexAuth(authComponent, {
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

  it('rejects twoFactor with auto sign-in after verification when verification is not required', () => {
    const build = (options: object) => () =>
      createBetterConvexAuth(authComponent, {
        email: async () => {},
        twoFactor: {},
        ...options,
      } as never)
    expect(
      build({
        emailAndPassword: { requireEmailVerification: false },
        emailVerification: { autoSignInAfterVerification: true },
      }),
    ).toThrow(/autoSignInAfterVerification/)
    expect(
      build({
        emailAndPassword: {},
        emailVerification: { autoSignInAfterVerification: true },
      }),
    ).not.toThrow()
    expect(build({ emailAndPassword: { requireEmailVerification: false } })).not.toThrow()
  })
})

describe('users with an unverified email', () => {
  useAuthEnvironment()
  afterEach(() => vi.unstubAllGlobals())

  it('refuses an unverified user from a social callback and creates no row', async () => {
    stubGithubToken()
    const s = createRealAuth({ emailAndPassword: {}, socialProviders: github(false) } as never)
    const client = s.client()
    await socialSignIn(client)
    expect((await s.users()).page).toHaveLength(0)
    expect(await client.hasSession()).toBe(false)
  })

  it('sends the browser back to the app with an error code when the social email is unverified', async () => {
    stubGithubToken()
    const s = createRealAuth({ emailAndPassword: {}, socialProviders: github(false) } as never)
    const res = await socialSignIn(s.client(), 'https://app.example.test/signin-failed')
    expect(res.status).toBe(302)
    expect(res.location).toContain('https://app.example.test/signin-failed')
    expect(res.location).toContain('error=AUTH_USER_CREATE_UNVERIFIED_EMAIL')
  })

  it('signs in a social user whose email the provider verified', async () => {
    stubGithubToken()
    const s = createRealAuth({ emailAndPassword: {}, socialProviders: github(true) } as never)
    const client = s.client()
    await socialSignIn(client)
    expect((await s.users()).page).toHaveLength(1)
    expect(await client.hasSession()).toBe(true)
  })

  it('still lets password sign-up create an unverified user and send the verification mail', async () => {
    const s = createRealAuth({ emailAndPassword: {} })
    const res = await s
      .client()
      .post('/sign-up/email', { name: 'x', email: VICTIM, password: VICTIM_PW })
    expect(res.status).toBe(200)
    expect((await s.users()).page[0]).toMatchObject({ emailVerified: false })
    expect(s.lastMail('verify-email', VICTIM)).toBeDefined()
  })

  it('does not reach beforeUserCreate for a refused unverified social user', async () => {
    stubGithubToken()
    const seen: string[] = []
    const s = createRealAuth({
      emailAndPassword: {},
      socialProviders: github(false),
      beforeUserCreate: async ({ user }: { user: { email: string } }) => {
        seen.push(user.email)
        return { allowed: true }
      },
    } as never)
    await socialSignIn(s.client())
    expect(seen).toEqual([])
  })
})

describe('beforeUserCreate email', () => {
  useAuthEnvironment()

  async function otpSignIn(s: RealAuth, email: string) {
    const client = s.client()
    await client.post('/email-otp/send-verification-otp', { email, type: 'sign-in' })
    const otp = (s.lastMail('email-otp', email) as { otp: string }).otp
    return await client.post('/sign-in/email-otp', { email, otp })
  }

  it('refuses a replacement email that is not the proven address', async () => {
    const s = createRealAuth({
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
    const s = createRealAuth({
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
