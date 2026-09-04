import { betterAuth } from 'better-auth'
import { memoryAdapter, type MemoryDB } from 'better-auth/adapters/memory'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { twoFactor } from 'better-auth/plugins'
import { describe, expect, it } from 'vitest'

// Exploration only: real pinned Better Auth, its existing memory adapter, and
// canonical auth rows. This is not a production workforce policy implementation.
const origin = 'https://workforce-proof.example.test'
const email = 'worker@example.test'
const password = 'one deliberately long test password'
const replacementPassword = 'a different deliberately long password'

type GenerationUser = { id: string; securityGeneration: number }
type ChallengeProof = { userId: string; generation: number; method: string }
type SessionProof = {
  id: string
  userId: string
  proofMethod: string
  proofGeneration: number
  proofAuthenticatedAt: number
}
type SessionObservation = { path: string | undefined; hadSession: boolean; method: string }

function cookieJar() {
  const values = new Map<string, string>()
  return {
    header: () => [...values].map(([name, value]) => `${name}=${value}`).join('; '),
    accept(headers: Headers) {
      for (const cookie of headers.getSetCookie()) {
        const pair = cookie.split(';', 1)[0]!
        const separator = pair.indexOf('=')
        const name = pair.slice(0, separator)
        const value = pair.slice(separator + 1)
        if (!value || /max-age=0/i.test(cookie)) values.delete(name)
        else values.set(name, value)
      }
    },
  }
}

function rawTotpSecret(encoded: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const bits = [...encoded.replace(/=+$/u, '')]
    .map((character) => {
      const index = alphabet.indexOf(character)
      if (index < 0) throw new Error('Invalid authenticator URI')
      return index.toString(2).padStart(5, '0')
    })
    .join('')
  const bytes: number[] = []
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2))
  }
  return new TextDecoder().decode(Uint8Array.from(bytes))
}

async function setup() {
  const database: MemoryDB = {
    user: [],
    account: [],
    session: [],
    verification: [],
    twoFactor: [],
    rateLimit: [],
  }
  const observations: SessionObservation[] = []
  const challengeProofs = new WeakMap<object, ChallengeProof>()
  const firstFactorGenerations = new WeakMap<object, { userId: string; generation: number }>()
  let resetToken = ''
  let invalidateUser: (id: string) => Promise<void> = async () => {
    throw new Error('Proof harness not initialized')
  }
  let beforeFinalSession: (() => Promise<void>) | undefined
  let beforeInitialSession: (() => Promise<void>) | undefined
  let afterFinalSession: (() => Promise<void>) | undefined

  const auth = betterAuth({
    baseURL: origin,
    secret: 'workforce-proof-only-secret-longer-than-32-characters',
    database: memoryAdapter(database),
    logger: { disabled: true },
    user: {
      additionalFields: {
        securityGeneration: { type: 'number', defaultValue: 0, input: false },
      },
    },
    session: {
      cookieCache: { enabled: false },
      additionalFields: {
        proofMethod: { type: 'string', defaultValue: 'none', input: false, returned: false },
        proofGeneration: { type: 'number', defaultValue: -1, input: false, returned: false },
        proofAuthenticatedAt: { type: 'number', defaultValue: 0, input: false, returned: false },
      },
    },
    verification: {
      storeIdentifier: 'hashed',
      additionalFields: {
        proofGeneration: { type: 'number', required: false, input: false },
      },
    },
    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
      minPasswordLength: 15,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ token }) => {
        resetToken = token
      },
      onPasswordReset: async ({ user }) => {
        await invalidateUser(user.id)
      },
    },
    plugins: [twoFactor({ issuer: 'Workforce proof' })],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === '/sign-in/email' && typeof ctx.body?.email === 'string') {
          // Bind before credential validation. A reset racing with password
          // verification must not relabel an old password as the new generation.
          const user = await ctx.context.adapter.findOne<GenerationUser>({
            model: 'user',
            where: [{ field: 'email', value: ctx.body.email.toLowerCase() }],
          })
          if (user)
            firstFactorGenerations.set(ctx.context, {
              userId: user.id,
              generation: user.securityGeneration,
            })
          return
        }
        if (!['/two-factor/verify-totp', '/two-factor/verify-backup-code'].includes(ctx.path))
          return
        const tokenCookie = ctx.context.authCookies.sessionToken
        const token = await ctx.getSignedCookie(tokenCookie.name, ctx.context.secret)
        if (token && (await ctx.context.internalAdapter.findSession(token))) return
        const cookie = ctx.context.createAuthCookie('two_factor')
        const challengeId = await ctx.getSignedCookie(cookie.name, ctx.context.secret)
        if (!challengeId) return
        const challenge = await ctx.context.internalAdapter.findVerificationValue(challengeId)
        if (
          !challenge ||
          !('proofGeneration' in challenge) ||
          typeof challenge.proofGeneration !== 'number'
        )
          return
        const user = await ctx.context.adapter.findOne<GenerationUser>({
          model: 'user',
          where: [{ field: 'id', value: challenge.value }],
        })
        if (!user || user.securityGeneration !== challenge.proofGeneration) {
          throw new APIError('UNAUTHORIZED', { message: 'Stale authentication challenge' })
        }
        challengeProofs.set(ctx.context, {
          userId: user.id,
          generation: challenge.proofGeneration,
          method: ctx.path === '/two-factor/verify-totp' ? 'password-totp' : 'password-recovery',
        })
      }),
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session, ctx) => {
            if (ctx?.path === '/sign-in/email') await beforeInitialSession?.()
            const proof = ctx && !ctx.context.session && challengeProofs.get(ctx.context)
            if (proof) {
              await beforeFinalSession?.()
              const current = await ctx!.context.adapter.findOne<GenerationUser>({
                model: 'user',
                where: [{ field: 'id', value: session.userId }],
              })
              if (
                proof.userId !== session.userId ||
                current?.securityGeneration !== proof.generation
              ) {
                throw new APIError('UNAUTHORIZED', { message: 'Stale authentication challenge' })
              }
            }
            observations.push({
              path: ctx?.path,
              hadSession: Boolean(ctx?.context.session),
              method: proof ? proof.method : 'none',
            })
            return {
              data: {
                ...session,
                proofMethod: proof ? proof.method : 'none',
                proofGeneration: proof ? proof.generation : -1,
                proofAuthenticatedAt: proof ? Date.now() : 0,
              },
            }
          },
          after: async (session) => {
            if (session.proofMethod === 'password-totp') await afterFinalSession?.()
          },
        },
      },
      verification: {
        create: {
          before: async (verification, ctx) => {
            // Identifiers are already hashed here, so do not match a raw 2fa-
            // prefix. The challenge points to the first-factor user's ID; the
            // companion attempt counter does not.
            const proof = ctx && firstFactorGenerations.get(ctx.context)
            if (ctx?.path !== '/sign-in/email' || !proof || verification.value !== proof.userId)
              return
            return { data: { ...verification, proofGeneration: proof.generation } }
          },
        },
      },
    },
  })
  const context = await auth.$context
  invalidateUser = async (id) => {
    const user = await context.adapter.findOne<GenerationUser>({
      model: 'user',
      where: [{ field: 'id', value: id }],
    })
    if (!user) throw new Error('Missing proof user')
    await context.internalAdapter.updateUser(id, {
      securityGeneration: user.securityGeneration + 1,
    })
  }

  async function request(jar: ReturnType<typeof cookieJar>, path: string, body: object) {
    const response = await auth.handler(
      new Request(`${origin}/api/auth${path}`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json', cookie: jar.header() },
        body: JSON.stringify(body),
      }),
    )
    jar.accept(response.headers)
    const data: unknown = await response.json()
    return { status: response.status, data }
  }
  async function sessionProof(jar: ReturnType<typeof cookieJar>) {
    const result = await auth.api.getSession({ headers: new Headers({ cookie: jar.header() }) })
    if (!result) return null
    return context.adapter.findOne<SessionProof>({
      model: 'session',
      where: [{ field: 'id', value: result.session.id }],
    })
  }
  async function approved(jar: ReturnType<typeof cookieJar>) {
    const session = await sessionProof(jar)
    if (!session || session.proofMethod !== 'password-totp') return false
    const user = await context.adapter.findOne<GenerationUser>({
      model: 'user',
      where: [{ field: 'id', value: session.userId }],
    })
    return user?.securityGeneration === session.proofGeneration
  }
  const owner = cookieJar()
  expect((await request(owner, '/sign-up/email', { email, name: 'Worker', password })).status).toBe(
    200,
  )
  expect((await request(owner, '/sign-in/email', { email, password })).status).toBe(200)
  const enabled = await request(owner, '/two-factor/enable', { password })
  expect(enabled.status).toBe(200)
  const enrollment = enabled.data as { totpURI: string; backupCodes: string[] }
  const totpSecret = new URL(enrollment.totpURI).searchParams.get('secret')!
  const code = async () =>
    (await auth.api.generateTOTP({ body: { secret: rawTotpSecret(totpSecret) } })).code
  const user = await auth.api.getSession({ headers: new Headers({ cookie: owner.header() }) })
  if (!user) throw new Error('Missing enrollment session')

  return {
    auth,
    request,
    sessionProof,
    approved,
    owner,
    observations,
    code,
    backupCodes: enrollment.backupCodes,
    userId: user.user.id,
    invalidateUser,
    setBeforeFinalSession(callback: () => Promise<void>) {
      beforeFinalSession = callback
    },
    setBeforeInitialSession(callback: () => Promise<void>) {
      beforeInitialSession = callback
    },
    setAfterFinalSession(callback: () => Promise<void>) {
      afterFinalSession = callback
    },
    async resetPassword() {
      await auth.api.requestPasswordReset({ body: { email } })
      expect(resetToken.length).toBeGreaterThan(0)
      await auth.api.resetPassword({
        body: { token: resetToken, newPassword: replacementPassword },
      })
    },
    async challenge(nextPassword = password) {
      const jar = cookieJar()
      const result = await request(jar, '/sign-in/email', { email, password: nextPassword })
      expect(result).toMatchObject({ status: 200, data: { twoFactorRedirect: true } })
      return jar
    },
    async enroll() {
      const result = await request(owner, '/two-factor/verify-totp', { code: await code() })
      const errorCode =
        result.status !== 200 &&
        typeof result.data === 'object' &&
        result.data !== null &&
        'code' in result.data
          ? result.data.code
          : undefined
      expect(result.status, String(errorCode)).toBe(200)
    },
  }
}

describe('pinned Better Auth workforce assurance extension proof', () => {
  it('awaits but swallows a reset-mail submission rejection at the HTTP boundary', async () => {
    const submission = Promise.withResolvers<null>()
    let callbackStarted = false
    let httpSettled = false
    let failureObserved = false
    const auth = betterAuth({
      baseURL: origin,
      secret: 'workforce-proof-only-secret-longer-than-32-characters',
      database: memoryAdapter({ user: [], account: [], session: [], verification: [] }),
      logger: {
        level: 'error',
        // Observe only the synthetic sentinel. Do not retain/log callback data,
        // error stacks, reset URLs, tokens, or complete logger arguments.
        log(_level, _message, ...args) {
          failureObserved ||= args.some(
            (value: unknown) =>
              value instanceof Error && value.message === 'SYNTHETIC_SUBMISSION_FAILURE',
          )
        },
      },
      emailAndPassword: {
        enabled: true,
        autoSignIn: false,
        async sendResetPassword() {
          callbackStarted = true
          await submission.promise
        },
      },
    })
    await auth.api.signUpEmail({ body: { email, password, name: 'Worker' } })
    const pending = auth
      .handler(
        new Request(`${origin}/api/auth/request-password-reset`, {
          method: 'POST',
          headers: { origin, 'content-type': 'application/json' },
          body: JSON.stringify({ email }),
        }),
      )
      .then((response) => {
        httpSettled = true
        return response
      })
    await expect.poll(() => callbackStarted).toBe(true)
    expect(httpSettled).toBe(false)
    submission.reject(new Error('SYNTHETIC_SUBMISSION_FAILURE'))
    const response = await pending
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: true })
    expect(failureObserved).toBe(true)
  })

  it('distinguishes enrollment, final sign-in, and existing-session verification', async () => {
    const h = await setup()
    await h.enroll()
    expect(await h.approved(h.owner)).toBe(false)
    expect(h.observations.at(-1)).toMatchObject({
      path: '/two-factor/verify-totp',
      hadSession: true,
      method: 'none',
    })
    const jar = await h.challenge()
    expect(await h.sessionProof(jar)).toBeNull()
    expect((await h.request(jar, '/two-factor/verify-totp', { code: await h.code() })).status).toBe(
      200,
    )
    expect(await h.approved(jar)).toBe(true)
    expect(h.observations.at(-1)).toEqual({
      path: '/two-factor/verify-totp',
      hadSession: false,
      method: 'password-totp',
    })
    const before = await h.sessionProof(jar)
    const count = h.observations.length
    expect((await h.request(jar, '/two-factor/verify-totp', { code: await h.code() })).status).toBe(
      200,
    )
    expect(h.observations).toHaveLength(count)
    expect(await h.sessionProof(jar)).toEqual(before)
  })

  it('marks recovery separately and preserves the single-use recovery-code flow', async () => {
    const h = await setup()
    await h.enroll()
    const jar = await h.challenge()
    const code = h.backupCodes[0]!
    expect((await h.request(jar, '/two-factor/verify-backup-code', { code })).status).toBe(200)
    expect(await h.sessionProof(jar)).toMatchObject({ proofMethod: 'password-recovery' })
    expect(await h.approved(jar)).toBe(false)
    const second = await h.challenge()
    expect((await h.request(second, '/two-factor/verify-backup-code', { code })).status).toBe(401)
    expect(await h.sessionProof(second)).toBeNull()
  })

  it('rejects a pending first-factor challenge after a real password reset', async () => {
    const h = await setup()
    await h.enroll()
    const old = await h.challenge()
    await h.resetPassword()
    expect((await h.request(old, '/two-factor/verify-totp', { code: await h.code() })).status).toBe(
      401,
    )
    const fresh = await h.challenge(replacementPassword)
    expect(
      (await h.request(fresh, '/two-factor/verify-totp', { code: await h.code() })).status,
    ).toBe(200)
    expect(await h.approved(fresh)).toBe(true)
  })

  it('rechecks generation if invalidation races between challenge validation and session creation', async () => {
    const h = await setup()
    await h.enroll()
    const jar = await h.challenge()
    h.setBeforeFinalSession(() => h.invalidateUser(h.userId))
    expect((await h.request(jar, '/two-factor/verify-totp', { code: await h.code() })).status).toBe(
      401,
    )
    expect(await h.sessionProof(jar)).toBeNull()
  })

  it('binds generation before password verification, not when the first session is created', async () => {
    const h = await setup()
    await h.enroll()
    h.setBeforeInitialSession(() => h.invalidateUser(h.userId))
    const jar = await h.challenge()
    expect((await h.request(jar, '/two-factor/verify-totp', { code: await h.code() })).status).toBe(
      401,
    )
    expect(await h.approved(jar)).toBe(false)
  })

  it('rejects an otherwise valid session if invalidation races after session insertion', async () => {
    const h = await setup()
    await h.enroll()
    const jar = await h.challenge()
    h.setAfterFinalSession(() => h.invalidateUser(h.userId))
    expect((await h.request(jar, '/two-factor/verify-totp', { code: await h.code() })).status).toBe(
      200,
    )
    // Creation hooks cannot make separate adapter calls one atomic operation.
    // Every protected operation must compare the canonical generation again.
    expect(await h.sessionProof(jar)).toMatchObject({ proofMethod: 'password-totp' })
    expect(await h.approved(jar)).toBe(false)
  })

  it('does not promote enrollment or renew assurance through existing-session code verification', async () => {
    const h = await setup()
    await h.enroll()
    expect(
      (
        await h.request(h.owner, '/two-factor/verify-totp', {
          code: await h.code(),
          proofMethod: 'password-totp',
          proofGeneration: 0,
        })
      ).status,
    ).toBe(200)
    expect(await h.approved(h.owner)).toBe(false)
    expect(await h.sessionProof(h.owner)).toMatchObject({ proofMethod: 'none' })
  })
})
