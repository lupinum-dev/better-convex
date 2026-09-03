import { createOTP } from '@better-auth/utils/otp'
import { betterAuth } from 'better-auth'
import { memoryAdapter, type MemoryDB } from 'better-auth/adapters/memory'
import { createAuthEndpoint, createAuthMiddleware } from 'better-auth/api'
import { symmetricDecrypt, verifyPassword } from 'better-auth/crypto'
import { jwt, twoFactor } from 'better-auth/plugins'
import { describe, expect, it, vi } from 'vitest'

import { INTERNAL_SESSION_HEADER } from '../../src/runtime/convex-auth/internal-session'
import { convexAuth } from '../../src/runtime/convex-auth/plugin'
import type { WorkforceOperation } from '../../src/runtime/convex-auth/workforce/operations'
import { createWorkforceProviderHooks } from '../../src/runtime/convex-auth/workforce/provider-hooks'
import { getWorkforceOperation } from '../../src/runtime/convex-auth/workforce/request-context'
import {
  workforceSchemaOptions,
  workforceSchemaPlugin,
} from '../../src/runtime/convex-auth/workforce/schema'

// Real pinned dispatch/cookies/password/TOTP. Direct fixture patches stand in for
// separately tested component transitions; these tests do not certify those transactions.
const origin = 'https://workforce-hooks.example.test'
const password = 'a deliberately long provider hook proof password'
type Row = Record<string, unknown>

function cookieJar() {
  const values = new Map<string, string>()
  return {
    headers: () =>
      new Headers({ cookie: [...values].map(([name, value]) => `${name}=${value}`).join('; ') }),
    accept(headers: Headers) {
      for (const cookie of headers.getSetCookie()) {
        const pair = cookie.split(';', 1)[0]!
        const split = pair.indexOf('=')
        const name = pair.slice(0, split)
        const value = pair.slice(split + 1)
        if (!value || /max-age=0/i.test(cookie)) values.delete(name)
        else values.set(name, value)
      }
    },
  }
}

async function fixture() {
  const db: MemoryDB = {
    user: [],
    account: [],
    session: [],
    verification: [],
    twoFactor: [],
    rateLimit: [],
    jwks: [],
  }
  const hooks = createWorkforceProviderHooks()
  const passwordBindings: Array<WorkforceOperation | null> = []
  const beforeBindings: Array<{ path: string | undefined; operation: WorkforceOperation | null }> =
    []
  const relayed: Array<WorkforceOperation | null> = []
  const auth = betterAuth({
    baseURL: origin,
    secret: 'synthetic-provider-hooks-proof-secret-longer-than-32-characters',
    logger: { disabled: true },
    database: memoryAdapter(db),
    ...workforceSchemaOptions,
    verification: { ...workforceSchemaOptions.verification, storeIdentifier: 'hashed' },
    session: {
      ...workforceSchemaOptions.session,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
      expiresIn: 12 * 60 * 60,
    },
    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
      requireEmailVerification: true,
      password: {
        verify: async (input) => {
          passwordBindings.push(await getWorkforceOperation())
          return verifyPassword(input)
        },
      },
    },
    databaseHooks: {
      session: {
        create: {
          after: async (session, ctx) => {
            await hooks.sessionCreateAfter(session, ctx)
            if (ctx?.path === '/two-factor/verify-totp') relayed.push(await getWorkforceOperation())
          },
        },
      },
    },
    plugins: [
      twoFactor(),
      workforceSchemaPlugin,
      {
        id: 'synthetic-owned-workforce-policy',
        hooks: { before: [{ matcher: () => true, handler: hooks.before }] },
      },
      {
        id: 'synthetic-hook-observer',
        hooks: {
          before: [
            {
              matcher: () => true,
              handler: createAuthMiddleware(async (ctx) => {
                beforeBindings.push({ path: ctx.path, operation: await getWorkforceOperation() })
              }),
            },
          ],
        },
        endpoints: {
          syntheticToken: createAuthEndpoint('/convex/token', { method: 'GET' }, async () => ({
            admitted: true,
          })),
          syntheticUnknown: createAuthEndpoint(
            '/update-user/extra',
            { method: 'POST' },
            async () => ({ admitted: true }),
          ),
        },
      },
    ],
  })
  const context = await auth.$context
  async function post(path: string, body: object, jar = cookieJar()) {
    const headers = jar.headers()
    headers.set('origin', origin)
    headers.set('content-type', 'application/json')
    const response = await auth.handler(
      new Request(`${origin}/api/auth${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }),
    )
    jar.accept(response.headers)
    return response
  }
  async function account(label = 'worker') {
    const email = `${label}@example.test`
    const result = await auth.api.signUpEmail({ body: { name: label, email, password } })
    await context.adapter.update({
      model: 'user',
      where: [{ field: 'id', value: result.user.id }],
      update: { emailVerified: true },
    })
    const jar = cookieJar()
    const signedIn = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true })
    jar.accept(signedIn.headers)
    const storedSession = await context.adapter.findOne<Row>({
      model: 'session',
      where: [{ field: 'userId', value: result.user.id }],
    })
    if (typeof storedSession?.id !== 'string') throw new Error('SYNTHETIC_SESSION_REQUIRED')
    await proof(storedSession.id, 'password-only')
    const session = await auth.api.getSession({ headers: jar.headers() })
    if (!session) throw new Error('SYNTHETIC_SESSION_REQUIRED')
    const userId = result.user.id
    const sessionId = session.session.id
    return { email, userId, sessionId, jar }
  }
  async function proof(sessionId: string, method: string, patch: Row = {}) {
    await context.adapter.update({
      model: 'session',
      where: [{ field: 'id', value: sessionId }],
      update: {
        bcnAssuranceGeneration: 0,
        bcnAssuranceMethod: method,
        bcnAuthenticatedAt: Date.now(),
        bcnSessionStartedAt: Date.now(),
        ...patch,
      },
    })
  }
  async function enabled() {
    const user = await account()
    expect((await post('/two-factor/enable', { password }, user.jar)).status).toBe(200)
    const factor = await context.adapter.findOne<Row>({
      model: 'twoFactor',
      where: [{ field: 'userId', value: user.userId }],
    })
    if (!factor || typeof factor.id !== 'string' || typeof factor.secret !== 'string')
      throw new Error('SYNTHETIC_FACTOR_REQUIRED')
    const secret = await symmetricDecrypt({ key: context.secretConfig, data: factor.secret })
    return { ...user, factorId: factor.id, secret }
  }
  async function challenged() {
    const user = await enabled()
    await context.adapter.update({
      model: 'twoFactor',
      where: [{ field: 'id', value: user.factorId }],
      update: { verified: true },
    })
    await context.adapter.update({
      model: 'user',
      where: [{ field: 'id', value: user.userId }],
      update: { twoFactorEnabled: true },
    })
    const jar = cookieJar()
    expect((await post('/sign-in/email', { email: user.email, password }, jar)).status).toBe(200)
    const challenge = await context.adapter.findOne<Row>({
      model: 'verification',
      where: [{ field: 'value', value: user.userId }],
    })
    if (!challenge || typeof challenge.id !== 'string')
      throw new Error('SYNTHETIC_CHALLENGE_REQUIRED')
    await context.adapter.update({
      model: 'verification',
      where: [{ field: 'id', value: challenge.id }],
      update: { bcnAssuranceGeneration: 0 },
    })
    return { ...user, jar, challengeId: challenge.id }
  }
  return {
    db,
    auth,
    context,
    hooks,
    account,
    proof,
    post,
    enabled,
    challenged,
    passwordBindings,
    beforeBindings,
    relayed,
  }
}

describe('owned workforce provider hooks', () => {
  it('accepts the owned internal bearer conversion before workforce token and password guards', async () => {
    const h = await fixture()
    const user = await h.account()
    await h.proof(user.sessionId, 'password-totp')
    const session = await h.context.adapter.findOne<Row>({
      model: 'session',
      where: [{ field: 'id', value: user.sessionId }],
    })
    if (typeof session?.token !== 'string') throw new Error('SYNTHETIC_SESSION_TOKEN_REQUIRED')
    const issuer = `${origin}/api/auth`
    const convexSite = 'https://synthetic-hook-proof.convex.site'
    const hooks = createWorkforceProviderHooks()
    const auth = betterAuth({
      baseURL: origin,
      secret: 'synthetic-provider-hooks-proof-secret-longer-than-32-characters',
      logger: { disabled: true },
      advanced: { ipAddress: { ipAddressHeaders: ['x-bcn-verified-client-ip'] } },
      rateLimit: { enabled: true, storage: 'database', modelName: 'rateLimit' },
      database: memoryAdapter(h.db),
      ...workforceSchemaOptions,
      session: {
        ...workforceSchemaOptions.session,
        disableSessionRefresh: true,
        expiresIn: 12 * 60 * 60,
        cookieCache: { enabled: false },
      },
      emailAndPassword: { enabled: true, autoSignIn: false },
      plugins: [
        twoFactor(),
        workforceSchemaPlugin,
        jwt({
          disableSettingJwtHeader: true,
          jwks: {
            disablePrivateKeyEncryption: false,
            gracePeriod: 21 * 60,
            keyPairConfig: { alg: 'RS256' },
          },
          jwt: { audience: issuer, expirationTime: '10m', issuer },
        }),
        convexAuth({
          authConfig: {
            providers: [
              {
                algorithm: 'RS256',
                applicationID: 'convex',
                issuer: convexSite,
                jwks: `${issuer}/jwks`,
                type: 'customJwt',
              },
            ],
          },
          sessionJwt: { audience: 'convex', expirationTime: '15m', issuer: convexSite },
        }),
        {
          id: 'synthetic-owned-workforce-policy',
          hooks: { before: [{ matcher: () => true, handler: hooks.before }] },
        },
      ],
    })
    const context = await auth.$context
    const signer = context.getPlugin('jwt')
    if (!signer) throw new Error('SYNTHETIC_SIGNER_REQUIRED')
    const sign = vi
      .spyOn(signer.endpoints, 'signJWT')
      .mockResolvedValue({ token: 'synthetic-token' })
    const headers = new Headers({
      authorization: `Bearer ${session.token}`,
      [INTERNAL_SESSION_HEADER]: '1',
    })
    const response = await auth.handler(new Request(`${origin}/api/auth/convex/token`, { headers }))
    expect(response.status).toBe(200)
    expect(sign).toHaveBeenCalledOnce()
    await expect(
      auth.api.changePassword({
        request: new Request(`${origin}/api/auth/change-password`, { method: 'POST', headers }),
        asResponse: false,
        body: { currentPassword: password, newPassword: password },
      }),
    ).resolves.toMatchObject({ token: null })
    await expect(
      auth.api.changePassword({
        headers,
        body: { currentPassword: password, newPassword: 'a different deliberately long password' },
      }),
    ).resolves.toMatchObject({ token: null })
  })
  it('captures canonical generation before real password verification using provider lowercase normalization', async () => {
    const h = await fixture()
    const user = await h.account()
    await h.context.adapter.update({
      model: 'user',
      where: [{ field: 'id', value: user.userId }],
      update: { bcnSecurityGeneration: 7 },
    })
    await h.auth.api.signInEmail({ body: { email: user.email.toUpperCase(), password } })
    expect(h.passwordBindings.at(-1)).toEqual({
      operation: 'password-sign-in',
      userId: user.userId,
      expectedGeneration: 7,
    })
    expect(await getWorkforceOperation()).toBeNull()
  })

  it('leaves unknown credentials to the provider and never binds from caller proof fields', async () => {
    const h = await fixture()
    const response = await h.post('/sign-in/email', {
      email: 'missing@example.test',
      password,
      userId: 'attacker',
      bcnSecurityGeneration: 999,
    })
    expect(response.status).toBe(401)
    expect(h.beforeBindings.at(-1)?.operation).toBeNull()
  })

  it('isolates simultaneous sign-in snapshots', async () => {
    const h = await fixture()
    const [a, b] = await Promise.all([h.account('a'), h.account('b')])
    h.passwordBindings.length = 0
    await Promise.all(
      [a, b].map((user) => h.auth.api.signInEmail({ body: { email: user.email, password } })),
    )
    expect(h.passwordBindings).toEqual(
      expect.arrayContaining(
        [a, b].map((user) => ({
          operation: 'password-sign-in',
          userId: user.userId,
          expectedGeneration: 0,
        })),
      ),
    )
    expect(h.passwordBindings).toHaveLength(2)
  })

  it.each([
    '/two-factor/disable',
    '/two-factor/get-totp-uri',
    '/two-factor/send-otp',
    '/two-factor/verify-otp',
    '/sign-in/social',
    '/update-user/extra',
    '/update-user',
    '/change-email',
    '/delete-user',
    '/update-session',
    '/revoke-session',
    '/revoke-sessions',
    '/revoke-other-sessions',
  ])('denies unsupported exact route %s through HTTP dispatch', async (path) => {
    const h = await fixture()
    expect((await h.post(path, { password, code: '000000', provider: 'github' })).status).toBe(403)
  })

  it.each(['/list-sessions', '/list-accounts', '/account-info'])(
    'denies unsupported read route %s through GET dispatch',
    async (path) => {
      const h = await fixture()
      const response = await h.auth.handler(new Request(`${origin}/api/auth${path}`))
      expect(response.status).toBe(403)
    },
  )

  it('denies pathless server-only backup-code export through auth.api', async () => {
    const h = await fixture()
    await expect(
      h.auth.api.viewBackupCodes({ body: { userId: 'caller-selected' } }),
    ).rejects.toMatchObject({ status: 'FORBIDDEN' })
  })

  it('rejects any incoming provider trust cookie before password verification', async () => {
    const h = await fixture()
    const user = await h.account()
    const cookieName = h.context.createAuthCookie('trust_device').name
    const before = h.passwordBindings.length
    await expect(
      h.auth.api.signInEmail({
        body: { email: user.email, password },
        headers: new Headers({ cookie: `${cookieName}=synthetic-untrusted-cookie` }),
      }),
    ).rejects.toMatchObject({ status: 'FORBIDDEN' })
    expect(h.passwordBindings).toHaveLength(before)
  })

  it('expires the rejected trust cookie so a normal login retry is possible', async () => {
    const h = await fixture()
    const user = await h.account()
    const cookieName = h.context.createAuthCookie('trust_device').name
    const jar = cookieJar()
    jar.accept(new Headers({ 'set-cookie': `${cookieName}=synthetic-untrusted-cookie` }))
    const before = h.passwordBindings.length
    const rejected = await h.post('/sign-in/email', { email: user.email, password }, jar)
    expect(rejected.status).toBe(403)
    expect(rejected.headers.getSetCookie()).toContainEqual(
      expect.stringMatching(new RegExp(`^${cookieName}=;.*Max-Age=0`, 'i')),
    )
    expect(h.passwordBindings).toHaveLength(before)
    expect((await h.post('/sign-in/email', { email: user.email, password }, jar)).status).toBe(200)
    expect(h.passwordBindings).toHaveLength(before + 1)
  })

  it.each([true, 'true'])(
    'rejects revokeOtherSessions=%j before password-change effects',
    async (value) => {
      const h = await fixture()
      const user = await h.account()
      await h.proof(user.sessionId, 'password-totp')
      const before = h.passwordBindings.length
      const response = await h.post(
        '/change-password',
        {
          currentPassword: password,
          newPassword: 'a different deliberately long password',
          revokeOtherSessions: value,
        },
        user.jar,
      )
      expect(response.status).toBe(403)
      expect(h.passwordBindings).toHaveLength(before)
      await expect(
        h.auth.api.signInEmail({ body: { email: user.email, password } }),
      ).resolves.toHaveProperty('user.id', user.userId)
    },
  )

  it('rejects OTP-only enrollment before credential effects', async () => {
    const h = await fixture()
    const user = await h.account()
    expect((await h.post('/two-factor/enable', { password, method: 'otp' }, user.jar)).status).toBe(
      403,
    )
    expect(
      await h.context.adapter.findOne({
        model: 'twoFactor',
        where: [{ field: 'userId', value: user.userId }],
      }),
    ).toBeNull()
  })

  it('does not trust an unsigned primary cookie or a body-selected challenge', async () => {
    const h = await fixture()
    const name = h.context.createAuthCookie('two_factor').name
    await expect(
      h.auth.api.verifyTOTP({
        headers: new Headers({ cookie: `${name}=synthetic-primary` }),
        body: { code: '000000' },
      }),
    ).rejects.toMatchObject({ status: 'FORBIDDEN' })
  })

  it.each([{ trustDevice: true }, { disableSession: true }])(
    'rejects verification bypass body %j before challenge access',
    async (body) => {
      const h = await fixture()
      expect(
        (await h.post('/two-factor/verify-backup-code', { code: 'synthetic', ...body })).status,
      ).toBe(403)
    },
  )

  it('allows sanitized get-session for live restricted proof', async () => {
    const h = await fixture()
    const user = await h.account()
    const visible = await h.auth.api.getSession({ headers: user.jar.headers() })
    expect(visible?.session.id).toBe(user.sessionId)
    expect(visible?.session).not.toHaveProperty('bcnAssuranceMethod')
    expect((await h.post('/sign-out', {}, user.jar)).status).toBe(200)
  })

  it.each([{ bcnSessionStartedAt: 1 }, { bcnAssuranceGeneration: 1 }])(
    'denies get-session for expired or stale proof but retains sign-out: %j',
    async (patch) => {
      const h = await fixture()
      const user = await h.account()
      await h.proof(user.sessionId, 'password-only', patch)
      await expect(h.auth.api.getSession({ headers: user.jar.headers() })).rejects.toMatchObject({
        status: 'FORBIDDEN',
      })
      expect((await h.post('/sign-out', {}, user.jar)).status).toBe(200)
    },
  )

  it.each(['password-only', 'password-recovery', 'totp-enrollment', 'none'])(
    'rejects account management and token access for %s',
    async (method) => {
      const h = await fixture()
      const user = await h.account()
      await h.proof(user.sessionId, method)
      await expect(
        h.auth.api.updateUser({ body: { name: 'changed' }, headers: user.jar.headers() }),
      ).rejects.toMatchObject({ status: 'FORBIDDEN' })
      await expect(
        h.auth.api.syntheticToken({ headers: user.jar.headers() }),
      ).rejects.toMatchObject({ status: 'FORBIDDEN' })
    },
  )

  it('requires freshness for management but not ordinary token renewal', async () => {
    const h = await fixture()
    const user = await h.account()
    const old = Date.now() - 6 * 60_000
    await h.proof(user.sessionId, 'password-totp', {
      bcnAuthenticatedAt: old,
      bcnSessionStartedAt: old,
    })
    await expect(
      h.auth.api.changePassword({
        body: { currentPassword: password, newPassword: 'a different deliberately long password' },
        headers: user.jar.headers(),
      }),
    ).rejects.toMatchObject({ status: 'FORBIDDEN' })
    await expect(h.auth.api.syntheticToken({ headers: user.jar.headers() })).resolves.toEqual({
      admitted: true,
    })
    await h.proof(user.sessionId, 'password-totp')
    await expect(
      h.auth.api.changePassword({
        body: { currentPassword: password, newPassword: 'a different deliberately long password' },
        headers: user.jar.headers(),
      }),
    ).resolves.toMatchObject({ token: null })
    expect(h.passwordBindings.at(-1)).toMatchObject({
      operation: 'change-password',
      userId: user.userId,
      sessionId: user.sessionId,
      expectedGeneration: 0,
    })
  })

  it.each([
    { bcnAssuranceGeneration: 1 },
    { bcnSessionStartedAt: 1 },
    { bcnAuthenticatedAt: Date.now() + 86_400_000 },
    { expiresAt: new Date(1) },
  ])('rejects stale or invalid canonical sessions %j', async (patch) => {
    const h = await fixture()
    const user = await h.account()
    await h.proof(user.sessionId, 'password-totp', patch)
    await expect(h.auth.api.syntheticToken({ headers: user.jar.headers() })).rejects.toMatchObject({
      status: 'FORBIDDEN',
    })
  })

  it('binds an initial setup and relays the actual provider-created confirmation successor', async () => {
    const h = await fixture()
    const user = await h.enabled()
    expect(h.beforeBindings.at(-1)?.operation).toMatchObject({
      operation: 'begin-enrollment',
      userId: user.userId,
      sessionId: user.sessionId,
    })
    await h.proof(user.sessionId, 'totp-enrollment')
    const code = await createOTP(user.secret).totp()
    expect((await h.post('/two-factor/verify-totp', { code }, user.jar)).status).toBe(200)
    expect(h.relayed).toHaveLength(1)
    expect(h.relayed[0]).toMatchObject({
      operation: 'confirm-enrollment',
      userId: user.userId,
      expectedGeneration: 0,
    })
    expect(h.relayed[0]).toHaveProperty(
      'sessionId',
      expect.not.stringMatching(`^${user.sessionId}$`),
    )
  })

  it('does not interpret existing-session verification as a new full login', async () => {
    const h = await fixture()
    const user = await h.enabled()
    await h.proof(user.sessionId, 'password-totp')
    expect((await h.post('/two-factor/verify-totp', { code: '000000' }, user.jar)).status).toBe(403)
    expect(
      (await h.post('/two-factor/verify-backup-code', { code: 'synthetic' }, user.jar)).status,
    ).toBe(403)
    expect(h.relayed).toHaveLength(0)
  })

  it.each([
    ['/two-factor/verify-totp', 'totp-sign-in'],
    ['/two-factor/verify-backup-code', 'recovery-sign-in'],
  ] as const)('binds signed canonical primary challenge before %s', async (path, operation) => {
    const h = await fixture()
    const user = await h.challenged()
    await h.post(
      path,
      { code: 'synthetic-invalid-code', userId: 'attacker', challengeId: 'attacker' },
      user.jar,
    )
    expect(h.beforeBindings.at(-1)?.operation).toEqual({
      operation,
      userId: user.userId,
      challengeId: user.challengeId,
      expectedGeneration: 0,
    })
  })

  it('rejects a challenge invalidated by a canonical generation change', async () => {
    const h = await fixture()
    const user = await h.challenged()
    await h.context.adapter.update({
      model: 'user',
      where: [{ field: 'id', value: user.userId }],
      update: { bcnSecurityGeneration: 1 },
    })
    expect((await h.post('/two-factor/verify-totp', { code: '000000' }, user.jar)).status).toBe(403)
  })

  it('binds immutable server-derived replay evidence across independent challenges', async () => {
    const h = await fixture()
    const user = await h.challenged()
    const code = await createOTP(user.secret).totp()
    const verify = async (jar: ReturnType<typeof cookieJar>) => {
      expect(
        (
          await h.post(
            '/two-factor/verify-totp',
            {
              code,
              replay: { digest: 'caller-selected', matchingCounters: [0] },
            },
            jar,
          )
        ).status,
      ).toBe(200)
      const operation = h.beforeBindings.at(-1)?.operation
      if (operation?.operation !== 'totp-sign-in' || !operation.replay)
        throw new Error('SYNTHETIC_REPLAY_BINDING_REQUIRED')
      expect(Object.isFrozen(operation)).toBe(true)
      expect(Object.isFrozen(operation.replay)).toBe(true)
      expect(Object.isFrozen(operation.replay.matchingCounters)).toBe(true)
      expect(operation.replay.digest).not.toBe('caller-selected')
      return operation
    }
    const first = await verify(user.jar)
    const secondJar = cookieJar()
    expect(
      (await h.post('/sign-in/email', { email: user.email, password }, secondJar)).status,
    ).toBe(200)
    const challenge = await h.context.adapter.findOne<Row>({
      model: 'verification',
      where: [{ field: 'value', value: user.userId }],
    })
    if (typeof challenge?.id !== 'string') throw new Error('SYNTHETIC_CHALLENGE_REQUIRED')
    await h.context.adapter.update({
      model: 'verification',
      where: [{ field: 'id', value: challenge.id }],
      update: { bcnAssuranceGeneration: 0 },
    })
    const second = await verify(secondJar)
    expect(second.challengeId).not.toBe(first.challengeId)
    expect(second.replay?.digest).toBe(first.replay?.digest)
  })
})
