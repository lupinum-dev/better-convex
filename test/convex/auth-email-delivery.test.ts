/// <reference types="vite/client" />

import { convexTest } from 'convex-test'
import { componentsGeneric, defineSchema, httpRouter } from 'convex/server'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComponentApi } from '../../src/runtime/convex-auth/component/_generated/component'
import authSchema from '../../src/runtime/convex-auth/component/schema'
import type { BetterConvexAuthEmailSender } from '../../src/runtime/convex-auth/create-better-convex-auth'
import organizationSchema from '../fixtures/better-auth-local-component/convex/betterAuth/schema'
import twoFactorSchema from '../fixtures/better-auth-two-factor/convex/betterAuth/schema'

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
const twoFactorModules = import.meta.glob(
  '../fixtures/better-auth-two-factor/convex/betterAuth/**/*.ts',
)
const organizationModules = import.meta.glob(
  '../fixtures/better-auth-local-component/convex/betterAuth/**/*.ts',
)
const components = componentsGeneric() as unknown as {
  sessionAuth: ComponentApi<'sessionAuth'>
}
const password = 'synthetic-password-for-email-tests'

function setup(capability: 'links' | 'emailOTP' | 'twoFactor' | 'organization') {
  const test = convexTest(defineSchema({}), rootModules)
  if (capability === 'twoFactor') {
    test.registerComponent('sessionAuth', twoFactorSchema, twoFactorModules)
  } else if (capability === 'organization') {
    test.registerComponent('sessionAuth', organizationSchema, organizationModules)
  } else {
    test.registerComponent('sessionAuth', authSchema, authModules)
  }
  const email = vi.fn<BetterConvexAuthEmailSender>(async () => {})
  const auth = createBetterConvexAuth(components.sessionAuth, {
    email,
    emailAndPassword: { passwordReset: true },
    emailVerification: { expiresIn: 300, sendOnSignUp: false },
    ...(capability === 'emailOTP' ? { emailOTP: { expiresIn: 300 } } : {}),
    ...(capability === 'twoFactor'
      ? { twoFactor: { issuer: 'Example', otpOptions: { period: 3 } } }
      : {}),
    ...(capability === 'organization' ? { organization: {} } : {}),
  })
  const http = httpRouter()
  auth.registerRoutes(http)
  let cookie = ''
  async function request(path: string, body: Record<string, unknown>) {
    const response = await test.action(async (ctx) => {
      const route = http.lookup(`/api/auth${path}`, 'POST')
      if (!route) throw new Error('Auth route was not registered')
      const handler = route[0] as unknown as {
        _handler: (ctx: unknown, request: Request) => Promise<Response>
      }
      const response = await handler._handler(
        { ...ctx, meta: { getRequestMetadata: async () => ({ ip: '198.51.100.7' }) } },
        new Request(`https://deployment.convex.site/api/auth${path}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            Origin: 'https://app.example.test',
            cookie,
          },
          body: JSON.stringify(body),
        }),
      )
      const result: unknown = await response.json()
      return { status: response.status, body: result, cookies: response.headers.getSetCookie() }
    })
    if (response.cookies.length)
      cookie = response.cookies.map((value) => value.split(';')[0]).join('; ')
    expect(response).toMatchObject({ status: 200 })
    return response.body
  }
  async function signUp() {
    const result = await request('/sign-up/email', {
      name: 'Person',
      email: 'person@example.test',
      password,
    })
    expect(result).toMatchObject({ user: { email: 'person@example.test', name: 'Person' } })
    const users = await test.query(components.sessionAuth.adapter.findMany, {
      model: 'user',
      paginationOpts: { cursor: null, numItems: 10 },
    })
    expect(users.page).toHaveLength(1)
    expect(email).not.toHaveBeenCalled()
    const id: unknown = users.page[0]!.id
    if (typeof id !== 'string') throw new Error('Expected user id')
    return id
  }
  function delivered() {
    expect(email).toHaveBeenCalledOnce()
    const [ctx, message] = email.mock.calls[0]!
    expect(ctx.runMutation).toBeTypeOf('function')
    expect(Object.isFrozen(message)).toBe(true)
    return message
  }
  return { request, signUp, email, delivered }
}

describe('typed email delivery with real Better Auth', () => {
  beforeEach(() => {
    vi.stubEnv('SITE_URL', 'https://app.example.test')
    vi.stubEnv('CONVEX_SITE_URL', 'https://deployment.convex.site')
    vi.stubEnv('BETTER_AUTH_SECRETS', `0:${'test-secret'.repeat(4)}`)
  })
  afterEach(() => vi.unstubAllEnvs())

  it('delivers a password reset with the request writable context', async () => {
    const { request, signUp, delivered } = setup('links')
    const id = await signUp()
    await request('/request-password-reset', {
      email: 'person@example.test',
      redirectTo: 'https://app.example.test/recover',
    })
    const message = delivered()
    expect(message).toEqual({
      type: 'reset-password',
      to: 'person@example.test',
      url: expect.stringMatching(
        /^https:\/\/app\.example\.test\/api\/auth\/reset-password\/[A-Za-z0-9]{24}\?callbackURL=https%3A%2F%2Fapp\.example\.test%2Frecover$/,
      ),
      token: expect.stringMatching(/^[A-Z0-9]{24}$/i),
      user: { id, email: 'person@example.test', name: 'Person' },
    })
    if (message.type !== 'reset-password') throw new Error('Expected reset message')
    expect(new URL(message.url).pathname).toBe(`/api/auth/reset-password/${message.token}`)
    expect(Object.isFrozen(message.user)).toBe(true)
  })

  it('delivers verification with the request writable context', async () => {
    const { request, signUp, delivered } = setup('links')
    const id = await signUp()
    await request('/send-verification-email', {
      email: 'person@example.test',
      callbackURL: 'https://app.example.test/verified',
    })
    const message = delivered()
    expect(message).toEqual({
      type: 'verify-email',
      to: 'person@example.test',
      url: expect.stringMatching(
        /^https:\/\/app\.example\.test\/api\/auth\/verify-email\?token=[\w-]+\.[\w-]+\.[\w-]+&callbackURL=https%3A%2F%2Fapp\.example\.test%2Fverified$/,
      ),
      token: expect.stringMatching(/^[\w-]+\.[\w-]+\.[\w-]+$/),
      user: { id, email: 'person@example.test', name: 'Person' },
    })
    if (message.type !== 'verify-email') throw new Error('Expected verification message')
    expect(new URL(message.url).searchParams.get('token')).toBe(message.token)
    expect(Object.isFrozen(message.user)).toBe(true)
  })

  it('delivers an email OTP with its purpose', async () => {
    const { request, delivered } = setup('emailOTP')
    await request('/email-otp/send-verification-otp', {
      email: 'person@example.test',
      type: 'sign-in',
    })
    expect(delivered()).toEqual({
      type: 'email-otp',
      to: 'person@example.test',
      otp: expect.stringMatching(/^\d{6}$/),
      purpose: 'sign-in',
    })
  })

  it('delivers a two-factor OTP with the signed-in user', async () => {
    const { request, signUp, delivered } = setup('twoFactor')
    const id = await signUp()
    await request('/sign-in/email', { email: 'person@example.test', password })
    await request('/two-factor/enable', { password, method: 'otp' })
    await request('/two-factor/send-otp', {})
    const message = delivered()
    expect(message).toEqual({
      type: 'two-factor-otp',
      to: 'person@example.test',
      otp: expect.stringMatching(/^\d{6}$/),
      user: { id, email: 'person@example.test', name: 'Person' },
    })
    if (message.type !== 'two-factor-otp') throw new Error('Expected two-factor message')
    expect(Object.isFrozen(message.user)).toBe(true)
  })

  it('delivers an organization invitation with the organization and inviter', async () => {
    const { request, signUp, delivered } = setup('organization')
    const id = await signUp()
    await request('/sign-in/email', { email: 'person@example.test', password })
    const organization = await request('/organization/create', { name: 'Org', slug: 'org' })
    expect(organization).toMatchObject({ id: expect.any(String) })
    if (
      !organization ||
      typeof organization !== 'object' ||
      !('id' in organization) ||
      typeof organization.id !== 'string'
    )
      throw new Error('Expected organization id')
    const organizationId = organization.id
    const invitation = await request('/organization/invite-member', {
      email: 'invitee@example.test',
      role: 'member',
      organizationId,
    })
    expect(invitation).toMatchObject({ id: expect.any(String) })
    if (
      !invitation ||
      typeof invitation !== 'object' ||
      !('id' in invitation) ||
      typeof invitation.id !== 'string'
    )
      throw new Error('Expected invitation id')
    const message = delivered()
    expect(message).toEqual({
      type: 'organization-invitation',
      to: 'invitee@example.test',
      invitationId: invitation.id,
      role: 'member',
      organization: { id: organizationId, name: 'Org', slug: 'org' },
      inviter: { id, email: 'person@example.test', name: 'Person' },
    })
    if (message.type !== 'organization-invitation') throw new Error('Expected invitation message')
    expect(Object.isFrozen(message.organization)).toBe(true)
    expect(Object.isFrozen(message.inviter)).toBe(true)
  })
})
