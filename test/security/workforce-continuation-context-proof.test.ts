import { getCurrentAuthContext } from '@better-auth/core/context'
import { betterAuth } from 'better-auth'
import { memoryAdapter, type MemoryDB } from 'better-auth/adapters/memory'
import { createAuthMiddleware } from 'better-auth/api'
import { symmetricDecrypt } from 'better-auth/crypto'
import { twoFactor } from 'better-auth/plugins'
import { describe, expect, it } from 'vitest'

// This proves the pinned provider's context seam, not component transaction
// correctness. The adapter instances all address the same canonical database.
const origin = 'https://continuation-proof.example.test'
const password = 'a deliberately long continuation test password'
type Factor = { id: string; userId: string; secret: string; verified: boolean }
type Observation = {
  sessionId: string
  userId: string
  operation: 'create' | 'update'
  inheritedVerified: unknown
}

function cookies() {
  const values = new Map<string, string>()
  return {
    header: () => [...values].map(([name, value]) => `${name}=${value}`).join('; '),
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

async function fixture(options: { bindConfirmation?: boolean; rejectRelay?: boolean } = {}) {
  const database: MemoryDB = { user: [], account: [], session: [], verification: [], twoFactor: [] }
  const baseAdapterFactory = memoryAdapter(database)
  const coreSessionCreates: Array<{ sameHookContext: boolean; originalSessionExists: boolean }> = []
  const adapterFactory: typeof baseAdapterFactory = (options) => {
    const adapter = baseAdapterFactory(options)
    return {
      ...adapter,
      create: async (input) => {
        if (input.model === 'session') {
          const ctx = await getCurrentAuthContext()
          if (ctx.path === '/two-factor/verify-totp') {
            const binding = requestBindings.get(ctx.context)
            if (binding) expect(input.data.userId).toBe(binding.userId)
            const original = binding
              ? await adapter.findOne({
                  model: 'session',
                  where: [{ field: 'id', value: binding.sessionId }],
                })
              : null
            coreSessionCreates.push({
              sameHookContext: !!binding,
              originalSessionExists: !!original,
            })
          }
        }
        return adapter.create(input)
      },
    }
  }
  const observations: Observation[] = []
  const confirmationWrites: Array<{
    originalSessionExists: boolean
    successorSessionExists: boolean
    sameHookContext: boolean
  }> = []
  const requestBindings = new WeakMap<
    object,
    { sessionId: string; userId: string; successorId?: string }
  >()
  const rendezvous = Promise.withResolvers<null>()
  let concurrent = false
  let entered = 0
  const auth = betterAuth({
    baseURL: origin,
    secret: 'continuation-proof-only-secret-longer-than-32-characters',
    database: adapterFactory,
    logger: { disabled: true },
    emailAndPassword: { enabled: true, autoSignIn: false },
    plugins: [twoFactor()],
    databaseHooks: {
      session: {
        create: {
          after: async (created, ctx) => {
            if (ctx?.path !== '/two-factor/verify-totp') return
            if (options.rejectRelay) throw new Error('Synthetic relay rejection')
            const binding = requestBindings.get(ctx.context)
            if (binding) binding.successorId = created.id
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const confirmation = options.bindConfirmation && ctx.path === '/two-factor/verify-totp'
        if (ctx.path !== '/two-factor/enable' && !confirmation) return
        const cookie = ctx.context.authCookies.sessionToken
        const token = await ctx.getSignedCookie(cookie.name, ctx.context.secret)
        const session = token && (await ctx.context.internalAdapter.findSession(token))
        if (!session) throw new Error('Missing proof session')
        const binding = { sessionId: session.session.id, userId: session.user.id, successorId: '' }
        requestBindings.set(ctx.context, binding)
        const adapter = adapterFactory(ctx.context.options)
        async function observe(operation: Observation['operation'], inheritedVerified: unknown) {
          if (concurrent) {
            entered += 1
            if (entered === 2) rendezvous.resolve(null)
            await rendezvous.promise
          }
          observations.push({
            sessionId: binding.sessionId,
            userId: binding.userId,
            operation,
            inheritedVerified,
          })
        }
        const bound: typeof adapter = {
          ...adapter,
          create: async (input) => {
            if (input.model === 'twoFactor') {
              expect(input.data.userId).toBe(binding.userId)
              await observe('create', input.data.verified)
            }
            return adapter.create(input)
          },
          update: async (input) => {
            if (input.model === 'twoFactor') {
              const current = await adapter.findOne<Factor>({
                model: input.model,
                where: input.where,
              })
              expect(current?.userId).toBe(binding.userId)
              if (confirmation) {
                const original = await adapter.findOne({
                  model: 'session',
                  where: [{ field: 'id', value: binding.sessionId }],
                })
                const successor = binding.successorId
                  ? await adapter.findOne({
                      model: 'session',
                      where: [{ field: 'id', value: binding.successorId }],
                    })
                  : null
                confirmationWrites.push({
                  originalSessionExists: !!original,
                  successorSessionExists: !!successor,
                  sameHookContext: !!binding.successorId,
                })
                // A missing relay cannot be repaired by trusting the user flag
                // or upgrading whatever session happens to exist afterward.
                if (!original && !successor) throw new Error('Missing continuation relay')
              } else await observe('update', input.update.verified)
            }
            return adapter.update(input)
          },
        }
        // dispatchAuthEndpoint clones AuthContext before invoking this hook.
        // Only this endpoint sees the bound existing adapter implementation.
        ctx.context.adapter = bound
      }),
    },
  })
  const context = await auth.$context
  const originalAdapter = context.adapter
  async function request(jar: ReturnType<typeof cookies>, path: string, body: object) {
    const response = await auth.handler(
      new Request(`${origin}/api/auth${path}`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json', cookie: jar.header() },
        body: JSON.stringify(body),
      }),
    )
    jar.accept(response.headers)
    return response.status
  }
  async function account(label: string) {
    const jar = cookies()
    const email = `${label}@example.test`
    expect(await request(jar, '/sign-up/email', { email, password, name: label })).toBe(200)
    expect(await request(jar, '/sign-in/email', { email, password })).toBe(200)
    const session = await auth.api.getSession({ headers: new Headers({ cookie: jar.header() }) })
    if (!session) throw new Error('Missing proof session')
    return { jar, userId: session.user.id, sessionId: session.session.id }
  }
  return {
    auth,
    context,
    originalAdapter,
    observations,
    confirmationWrites,
    coreSessionCreates,
    request,
    account,
    concurrent() {
      concurrent = true
    },
    async enroll(jar: ReturnType<typeof cookies>, userId: string) {
      const factor = await context.adapter.findOne<Factor>({
        model: 'twoFactor',
        where: [{ field: 'userId', value: userId }],
      })
      if (!factor) throw new Error('Missing proof factor')
      const secret = await symmetricDecrypt({ key: context.secretConfig, data: factor.secret })
      const { code } = await auth.api.generateTOTP({ body: { secret } })
      return request(jar, '/two-factor/verify-totp', { code })
    },
  }
}

describe('pinned Better Auth request-bound continuation adapter seam', () => {
  it('routes initial creation and verified-factor replacement through the request-bound adapter', async () => {
    const h = await fixture()
    const account = await h.account('owner')
    expect(await h.request(account.jar, '/two-factor/enable', { password })).toBe(200)
    expect(h.observations).toEqual([
      {
        sessionId: account.sessionId,
        userId: account.userId,
        operation: 'create',
        inheritedVerified: false,
      },
    ])
    expect(await h.enroll(account.jar, account.userId)).toBe(200)
    const rotated = await h.auth.api.getSession({
      headers: new Headers({ cookie: account.jar.header() }),
    })
    expect(rotated?.session.id).not.toBe(account.sessionId)
    expect(await h.request(account.jar, '/two-factor/enable', { password })).toBe(200)
    expect(h.observations.at(-1)).toEqual({
      sessionId: rotated!.session.id,
      userId: account.userId,
      operation: 'update',
      inheritedVerified: true,
    })
    expect(h.context.adapter).toBe(h.originalAdapter)
  })

  it('relays the rotated session ID through create.after before the confirmation write', async () => {
    const h = await fixture({ bindConfirmation: true })
    const account = await h.account('relay')
    expect(await h.request(account.jar, '/two-factor/enable', { password })).toBe(200)
    expect(await h.enroll(account.jar, account.userId)).toBe(200)
    expect(h.confirmationWrites).toEqual([
      { originalSessionExists: false, successorSessionExists: true, sameHookContext: true },
    ])
    expect(h.coreSessionCreates).toEqual([{ originalSessionExists: true, sameHookContext: true }])
    expect(h.context.adapter).toBe(h.originalAdapter)
  })

  it('does not confirm enrollment when the successor relay fails', async () => {
    const h = await fixture({ bindConfirmation: true, rejectRelay: true })
    const account = await h.account('failed-relay')
    expect(await h.request(account.jar, '/two-factor/enable', { password })).toBe(200)
    expect(await h.enroll(account.jar, account.userId)).toBe(500)
    const factor = await h.context.adapter.findOne<Factor>({
      model: 'twoFactor',
      where: [{ field: 'userId', value: account.userId }],
    })
    expect(factor?.verified).toBe(false)
    expect(h.confirmationWrites).toEqual([])
  })

  it('keeps core creation context and successor relays isolated during concurrent confirmations', async () => {
    const h = await fixture({ bindConfirmation: true })
    const first = await h.account('first-confirmation')
    const second = await h.account('second-confirmation')
    expect(await h.request(first.jar, '/two-factor/enable', { password })).toBe(200)
    expect(await h.request(second.jar, '/two-factor/enable', { password })).toBe(200)
    expect(
      await Promise.all([h.enroll(first.jar, first.userId), h.enroll(second.jar, second.userId)]),
    ).toEqual([200, 200])
    expect(h.coreSessionCreates).toEqual([
      { originalSessionExists: true, sameHookContext: true },
      { originalSessionExists: true, sameHookContext: true },
    ])
    expect(h.confirmationWrites).toEqual([
      { originalSessionExists: false, successorSessionExists: true, sameHookContext: true },
      { originalSessionExists: false, successorSessionExists: true, sameHookContext: true },
    ])
  })

  it('isolates concurrent endpoint bindings on one auth instance and ignores caller-selected continuation', async () => {
    const h = await fixture()
    const first = await h.account('first')
    const second = await h.account('second')
    h.concurrent()
    const results = await Promise.all([
      h.request(first.jar, '/two-factor/enable', {
        password,
        totpContinuation: { sessionId: second.sessionId, expectedGeneration: 900 },
      }),
      h.request(second.jar, '/two-factor/enable', { password }),
    ])
    expect(results).toEqual([200, 200])
    expect(h.observations).toEqual(
      expect.arrayContaining([
        {
          sessionId: first.sessionId,
          userId: first.userId,
          operation: 'create',
          inheritedVerified: false,
        },
        {
          sessionId: second.sessionId,
          userId: second.userId,
          operation: 'create',
          inheritedVerified: false,
        },
      ]),
    )
    expect(h.observations).toHaveLength(2)
    expect(h.context.adapter).toBe(h.originalAdapter)
  })
})
