import type { betterAuth } from 'better-auth'
import { anonymousClient } from 'better-auth/client/plugins'
import type { JwtOptions } from 'better-auth/plugins'
import { createAuthClient } from 'better-auth/vue'
import { convexTest } from 'convex-test'
import { componentsGeneric, defineSchema, type GenericDataModel } from 'convex/server'
import { createLocalJWKSet, jwtVerify } from 'jose'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { defineConvexAuthClient } from '../../src/runtime/auth-client'
import { validateConvexAuthClientDefinition } from '../../src/runtime/auth/validate-auth-client-definition'
import { defineAuthAdapterFunctions } from '../../src/runtime/convex-auth/adapter/define-functions'
import type { ComponentApi } from '../../src/runtime/convex-auth/component/_generated/component'
import {
  createBetterConvexAuth,
  type CreateBetterConvexAuthOptions,
} from '../../src/runtime/convex-auth/create-better-convex-auth'
import { rotateSigningKeyWithOfficialJwt } from '../../src/runtime/convex-auth/jwks-rotation'
import schema from '../fixtures/better-auth-anonymous/convex/betterAuth/schema'
import metadata from '../fixtures/better-auth-anonymous/convex/betterAuth/schemaMetadata'

const component = (componentsGeneric() as unknown as { guests: ComponentApi<'guests'> }).guests
const adapter = defineAuthAdapterFunctions({ metadata, schema })
const modules = {
  './_generated/api.ts': async () => ({}),
  './adapter.ts': async () => adapter,
}
const root = defineSchema({})
const origin = 'https://app.example.test'
const issuer = 'https://deployment.convex.site'
type AuthContext = Awaited<ReturnType<typeof betterAuth>['$context']>

beforeEach(() => {
  vi.stubEnv('SITE_URL', origin)
  vi.stubEnv('CONVEX_SITE_URL', issuer)
  vi.stubEnv('BETTER_AUTH_SECRETS', '1:synthetic-guest-secret-at-least-thirty-two-characters')
})
afterEach(() => vi.unstubAllEnvs())

function setup(
  options: CreateBetterConvexAuthOptions<GenericDataModel> = { experimental: { anonymous: true } },
) {
  const test = convexTest(root, { './_generated/api.ts': async () => ({}) })
  test.registerComponent('guests', schema, modules)
  const auth = createBetterConvexAuth(component, options)
  let cookie = ''
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const incoming = new Request(input, init)
    const body = await incoming.text()
    const response = await test.mutation(async (ctx) => {
      const instance = await auth.createAuth(ctx)
      // The transport interface deliberately hides Better Auth's request context.
      const context = (await instance.$context) as AuthContext
      // Better Auth defaults to skipping origins in tests. Exercise the real checks.
      context.skipOriginCheck = false
      context.skipCSRFCheck = false
      const headers = new Headers(incoming.headers)
      if (!headers.has('origin')) headers.set('origin', origin)
      if (cookie) headers.set('cookie', cookie)
      const result = await instance.handler(
        new Request(incoming.url, {
          method: incoming.method,
          headers,
          ...(body ? { body } : {}),
        }),
      )
      return {
        status: result.status,
        body: await result.text(),
        headers: [...result.headers.entries()],
      }
    })
    const headers = new Headers(response.headers)
    cookie = headers.get('set-cookie')?.split(';')[0] ?? cookie
    return new Response(response.body, { status: response.status, headers })
  }
  const definition = defineConvexAuthClient({ plugins: [anonymousClient()] })
  validateConvexAuthClientDefinition(definition)
  const client = createAuthClient({
    baseURL: `${origin}/api/auth`,
    plugins: [...definition.options.plugins!],
    fetchOptions: { customFetchImpl: fetch },
  })
  const tokenIdentity = async () => {
    const tokenResponse = await fetch(`${origin}/api/auth/convex/token`)
    expect(tokenResponse.status).toBe(200)
    const { token } = (await tokenResponse.json()) as { token: string }
    expect(token).toEqual(expect.any(String))
    const jwks = (await (await fetch(`${origin}/api/auth/jwks`)).json()) as Parameters<
      typeof createLocalJWKSet
    >[0]
    const { payload } = await jwtVerify(token, createLocalJWKSet(jwks), {
      issuer,
      audience: 'convex',
    })
    expect(payload.token_use).toBe('convex-session')
    expect(typeof payload.sub).toBe('string')
    expect(typeof payload.sid).toBe('string')
    return { subject: payload.sub!, sid: payload.sid as string, token_use: 'convex-session' }
  }
  const provision = () =>
    test.mutation(async (ctx) => {
      const instance = await auth.createAuth(ctx)
      const context = (await instance.$context) as AuthContext
      const plugin = context.getPlugin('jwt')!
      await rotateSigningKeyWithOfficialJwt(
        context as unknown as Parameters<typeof rotateSigningKeyWithOfficialJwt>[0],
        plugin.options as JwtOptions,
        (next) => ctx.runMutation(component.adapter.rotateSigningKey, { next }),
      )
    })
  return { test, auth, client, fetch, tokenIdentity, provision }
}

it('keeps anonymous sign-in authenticated through token issuance and requireUser', async () => {
  const { test, auth, client, tokenIdentity, provision, fetch } = setup()
  await provision()
  const guest = await client.signIn.anonymous()
  expect(guest.error).toBeNull()
  expect(guest.data?.user.isAnonymous).toBe(true)
  expect(guest.data?.token).toEqual(expect.any(String))
  const identity = await tokenIdentity()
  expect(identity.subject).toBe(guest.data!.user.id)
  const signed = test.withIdentity(identity)
  expect(await signed.query((ctx) => auth.requireUser(ctx))).toMatchObject({
    id: identity.subject,
    isAnonymous: true,
  })
  expect(await signed.query((ctx) => ctx.auth.getUserIdentity())).toMatchObject({
    subject: identity.subject,
  })
  expect(
    (
      await fetch(`${origin}/api/auth/sign-in/anonymous`, {
        method: 'POST',
        headers: { origin: 'https://evil.example.test' },
      })
    ).status,
  ).toBe(403)
  expect((await client.signIn.anonymous()).error?.status).toBe(400)
  await test.mutation(component.adapter.deleteOne, {
    model: 'session',
    where: [{ field: 'id', value: identity.sid }],
  })
  await expect(signed.query((ctx) => auth.requireUser(ctx))).rejects.toMatchObject({
    data: { code: 'UNAUTHENTICATED' },
  })
})

it.each([
  { anonymous: false },
  { anonymous: { schema: { user: { fields: { isAnonymous: 'guest' } } } } },
  { anonymous: { onLinkAccount: 'not a function' } },
  { anonymous: { emailDomainName: 'not an email domain' } },
  { anonymous: { disableDeleteAnonymousUser: 'yes' } },
  { arbitrary: true },
])('rejects unsafe or unsupported experimental configuration %j', (experimental) => {
  // JavaScript callers must get the same configuration checks as typed callers.
  expect(() =>
    createBetterConvexAuth(component, {
      experimental,
    } as unknown as CreateBetterConvexAuthOptions<GenericDataModel>),
  ).toThrow(/experimental/)
})

it('preserves guest profile data after email sign-in links and deletes the anonymous identity', async () => {
  let links = 0
  const { test, auth, client, tokenIdentity, provision } = setup({
    experimental: {
      anonymous: {
        generateName: () => 'Saved guest display name',
        onLinkAccount: async ({ anonymousUser, newUser, ctx }) => {
          // Native Better Auth callback: move guest profile data through the real component adapter.
          await ctx.context.adapter.update({
            model: 'user',
            where: [{ field: 'id', value: newUser.user.id }],
            update: { name: anonymousUser.user.name },
          })
          links++
        },
      },
    },
  })
  await provision()
  const guest = await client.signIn.anonymous()
  expect(guest.error).toBeNull()
  const guestIdentity = await tokenIdentity()
  const credentials = {
    email: 'guest-upgrade@example.test',
    password: 'Synthetic guest password 2026',
    name: 'New signup name',
  }
  const signup = await client.signUp.email(credentials)
  expect(signup.error).toBeNull()
  expect(signup.data?.token).toBeNull()
  expect(links).toBe(0)
  const signed = await client.signIn.email(credentials)
  expect(signed.error).toBeNull()
  expect(links).toBe(1)
  const identity = await tokenIdentity()
  expect(identity.subject).toBe(signed.data!.user.id)
  expect(identity.subject).not.toBe(guestIdentity.subject)
  expect(await test.withIdentity(identity).query((ctx) => auth.requireUser(ctx))).toMatchObject({
    id: identity.subject,
    isAnonymous: false,
    name: 'Saved guest display name',
  })
  expect(
    await test.query(component.adapter.findOne, {
      model: 'user',
      where: [{ field: 'id', value: guestIdentity.subject }],
    }),
  ).toBeNull()
  expect(await test.withIdentity(guestIdentity).query((ctx) => auth.getUser(ctx))).toBeNull()
})

it('rejects anonymous linking before two-factor verification can authenticate the new account', () => {
  expect(() =>
    createBetterConvexAuth(component, {
      experimental: { anonymous: true },
      twoFactor: {},
    }),
  ).toThrow(/anonymous.*together with "twoFactor"/)
  expect(() =>
    createBetterConvexAuth(component, {
      experimental: { anonymous: {} },
      twoFactor: { otpOptions: {} },
    }),
  ).toThrow(/two-factor verification/)
  expect(() =>
    createBetterConvexAuth(component, {
      experimental: { anonymous: true },
      twoFactor: false,
    }),
  ).not.toThrow()
})
