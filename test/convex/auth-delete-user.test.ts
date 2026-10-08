/// <reference types="vite/client" />

import { convexTest } from 'convex-test'
import { componentsGeneric, defineSchema, httpRouter } from 'convex/server'
import { ConvexError } from 'convex/values'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComponentApi } from '../../src/runtime/convex-auth/component/_generated/component'
import authSchema from '../../src/runtime/convex-auth/component/schema'
import type { BetterConvexAuthEmailSender } from '../../src/runtime/convex-auth/create-better-convex-auth'

// Better Auth reads node:process, not Vitest's stubbed environment.
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
const components = componentsGeneric() as unknown as {
  sessionAuth: ComponentApi<'sessionAuth'>
}
const credentials = { email: 'person@example.test', password: 'synthetic-password-for-delete' }

type Options = NonNullable<Parameters<typeof createBetterConvexAuth>[1]>

function setup(options: Options) {
  const test = convexTest(defineSchema({}), rootModules)
  test.registerComponent('sessionAuth', authSchema, authModules)
  const auth = createBetterConvexAuth(components.sessionAuth, {
    emailAndPassword: {},
    ...options,
  })
  const http = httpRouter()
  auth.registerRoutes(http)
  let cookie = ''
  async function request(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>) {
    const response = await test.action(async (ctx) => {
      const route = http.lookup(`/api/auth${path.split('?')[0]}`, method)
      if (!route) throw new Error('Auth route was not registered')
      const handler = route[0] as unknown as {
        _handler: (ctx: unknown, request: Request) => Promise<Response>
      }
      const response = await handler._handler(
        { ...ctx, meta: { getRequestMetadata: async () => ({ ip: '198.51.100.7' }) } },
        new Request(`https://deployment.convex.site/api/auth${path}`, {
          method,
          headers: {
            'content-type': 'application/json',
            Origin: 'https://app.example.test',
            cookie,
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
      )
      const text = await response.text()
      return {
        status: response.status,
        body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
        cookies: response.headers.getSetCookie(),
      }
    })
    if (response.cookies.length)
      cookie = response.cookies.map((value) => value.split(';')[0]).join('; ')
    return response
  }
  async function signIn() {
    expect(
      (await request('POST', '/sign-up/email', { name: 'Person', ...credentials })).status,
    ).toBe(200)
    expect((await request('POST', '/sign-in/email', credentials)).status).toBe(200)
  }
  const users = async () =>
    (
      await test.query(components.sessionAuth.adapter.findMany, {
        model: 'user',
        paginationOpts: { cursor: null, numItems: 10 },
      })
    ).page
  async function ageSession(ms: number) {
    await test.mutation(components.sessionAuth.adapter.updateOne, {
      model: 'session',
      where: [{ field: 'userId', value: (await users())[0]!.id as string }],
      update: { createdAt: Date.now() - ms },
    })
  }
  return { request, signIn, users, ageSession }
}

describe('account deletion with real Better Auth', () => {
  beforeEach(() => {
    vi.stubEnv('SITE_URL', 'https://app.example.test')
    vi.stubEnv('CONVEX_SITE_URL', 'https://deployment.convex.site')
    vi.stubEnv('BETTER_AUTH_SECRETS', `0:${'test-secret'.repeat(4)}`)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  // Catches: the delete route being reachable when the app never asked for it.
  it('is off unless the app enables it', async () => {
    const { request, signIn, users } = setup({})
    await signIn()
    expect((await request('POST', '/delete-user', {})).status).toBe(404)
    expect(await users()).toHaveLength(1)
  })

  it('also stays off for deleteUser: { enabled: false }', async () => {
    const { request, signIn, users } = setup({ deleteUser: { enabled: false } })
    await signIn()
    expect((await request('POST', '/delete-user', {})).status).toBe(404)
    expect(await users()).toHaveLength(1)
  })

  // Catches: deletion that does not delete, or that skips beforeDelete.
  it('deletes the auth user for a fresh session after beforeDelete allowed it', async () => {
    const beforeDelete = vi.fn(async () => {})
    const { request, signIn, users } = setup({ deleteUser: { enabled: true, beforeDelete } })
    await signIn()
    const response = await request('POST', '/delete-user', {})
    expect(response).toMatchObject({
      status: 200,
      body: { success: true, message: 'User deleted' },
    })
    expect(await users()).toHaveLength(0)
    expect(beforeDelete).toHaveBeenCalledOnce()
    const [ctx, user] = beforeDelete.mock.calls[0] as unknown as [
      { runQuery: unknown },
      { email: string; id: string; name: string },
    ]
    expect(ctx.runQuery).toBeTypeOf('function')
    expect(user).toMatchObject({ email: credentials.email, name: 'Person' })
    expect(Object.isFrozen(user)).toBe(true)
  })

  // Catches: a refusal that still deletes, or leaks an internal error text.
  async function refused(error: Error) {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { request, signIn, users } = setup({
      deleteUser: {
        enabled: true,
        beforeDelete: async () => {
          throw error
        },
      },
    })
    await signIn()
    const response = await request('POST', '/delete-user', {})
    expect(await users()).toHaveLength(1)
    return response
  }

  it('beforeDelete throwing refuses and deletes nothing: the app message reaches the person', async () => {
    const response = await refused(new ConvexError({ message: 'Transfer your team first.' }))
    expect(response).toMatchObject({ status: 403, body: { message: 'Transfer your team first.' } })
  })

  it('beforeDelete throwing refuses and deletes nothing: any other error is a generic refusal', async () => {
    const response = await refused(new Error('private database detail'))
    expect(response).toMatchObject({ status: 403, body: { message: 'AUTH_USER_DELETE_REFUSED' } })
    expect(JSON.stringify(response.body)).not.toContain('private database detail')
  })

  // Catches: an old stolen session deleting the account without the password.
  it('refuses a stale session and deletes nothing', async () => {
    const { request, signIn, users, ageSession } = setup({ deleteUser: { enabled: true } })
    await signIn()
    await ageSession(2 * 24 * 60 * 60 * 1000)
    const response = await request('POST', '/delete-user', {})
    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({ code: 'SESSION_EXPIRED' })
    expect(await users()).toHaveLength(1)
    // The password stands in for freshness.
    expect((await request('POST', '/delete-user', { password: credentials.password })).status).toBe(
      200,
    )
    expect(await users()).toHaveLength(0)
  })

  // Catches: the email option not being used for confirmation, or deleting before the link is opened.
  it('with an email sender, mails a delete-account link and deletes when it is opened', async () => {
    const email = vi.fn<BetterConvexAuthEmailSender>(async () => {})
    const { request, signIn, users, ageSession } = setup({ deleteUser: { enabled: true }, email })
    await signIn()
    await ageSession(2 * 24 * 60 * 60 * 1000)
    expect(await request('POST', '/delete-user', {})).toMatchObject({
      status: 200,
      body: { message: 'Verification email sent' },
    })
    expect(await users()).toHaveLength(1)
    const message = email.mock.calls[0]![1]
    expect(message).toMatchObject({ type: 'delete-account', to: credentials.email })
    if (message.type !== 'delete-account') throw new Error('Expected a delete-account email')
    const link = new URL(message.url)
    expect(link.pathname).toBe('/api/auth/delete-user/callback')
    expect((await request('GET', `/delete-user/callback?token=${message.token}`)).status).toBe(200)
    expect(await users()).toHaveLength(0)
  })
})
