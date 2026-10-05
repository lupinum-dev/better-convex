/// <reference types="vite/client" />

import { convexTest } from 'convex-test'
import { componentsGeneric, getFunctionAddress, type GenericDataModel } from 'convex/server'
import { ConvexError } from 'convex/values'
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComponentApi } from '../../src/runtime/convex-auth/component/_generated/component'
import authSchema from '../../src/runtime/convex-auth/component/schema'
import type { AuthCtx } from '../../src/runtime/convex-auth/context'
import { createBetterConvexAuth } from '../../src/runtime/convex-auth/create-better-convex-auth'
import { JWKS_GRACE_PERIOD_SECONDS } from '../../src/runtime/convex-auth/jwks-rotation'
import type { BetterConvexMcpPrincipal } from '../../src/runtime/convex-auth/mcp-principal'
import { createOAuthConnections } from '../../src/runtime/convex-auth/oauth-connections'
import { createOAuthOperator } from '../../src/runtime/convex-auth/oauth-operator'
import { clearVerificationKeyCache } from '../../src/runtime/convex-auth/oauth-resource'
import rootSchema from '../fixtures/auth-relationships-root/convex/schema'

const rootModules = import.meta.glob('../fixtures/auth-relationships-root/convex/**/*.ts')
const authModules = import.meta.glob('../../src/runtime/convex-auth/component/**/*.ts')
const components = componentsGeneric() as unknown as {
  relationshipAuth: ComponentApi<'relationshipAuth'>
}
const component = components.relationshipAuth
const adapter = component.adapter

const siteUrl = 'https://accounts.example.test'
const issuer = `${siteUrl}/api/auth`
const resource = 'https://deployment.example.test/mcp'
const scopes = ['mcp:read', 'mcp:write', 'offline_access']

type Test = ReturnType<typeof initTest>

function initTest() {
  const test = convexTest(rootSchema, rootModules)
  test.registerComponent('relationshipAuth', authSchema, authModules)
  return test
}

async function create(test: Test, model: string, data: Record<string, unknown>) {
  await test.mutation(adapter.create, { data, model })
}

async function createUserGrant(test: Test, user: string, client = 'oauth-client') {
  await createUser(test, user)
  await createConsent(test, user, client)
}

async function createConsent(test: Test, user: string, client: string) {
  await create(test, 'oauthConsent', {
    clientId: client,
    createdAt: Date.now(),
    id: `${user}-${client}-consent`,
    resources: [resource],
    scopes,
    userId: user,
  })
}

async function createUser(test: Test, user: string) {
  const now = Date.now()
  await create(test, 'user', {
    createdAt: now,
    email: `${user}@example.test`,
    emailVerified: true,
    id: user,
    name: `User ${user}`,
    updatedAt: now,
  })
  await create(test, 'session', {
    createdAt: now,
    expiresAt: now + 3_600_000,
    id: `${user}-session`,
    token: `${user}-session-token`,
    updatedAt: now,
    userId: user,
  })
}

async function createClient(test: Test, client = 'oauth-client') {
  await create(test, 'oauthClient', {
    clientId: client,
    disabled: false,
    id: `${client}-row`,
    name: `Client ${client}`,
    redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
    scopes,
  })
  await create(test, 'oauthClientResource', {
    clientId: client,
    id: `${client}-resource-link`,
    resourceId: resource,
  })
}

async function createResource(test: Test) {
  await create(test, 'oauthResource', {
    allowedScopes: scopes,
    disabled: false,
    id: 'oauth-resource-row',
    identifier: resource,
    name: 'MCP resource',
  })
}

async function createRefreshToken(test: Test, user: string, id: string) {
  await create(test, 'oauthRefreshToken', {
    clientId: 'oauth-client',
    createdAt: Date.now(),
    expiresAt: Date.now() + 600_000,
    id,
    resources: [resource],
    scopes,
    sessionId: `${user}-session`,
    token: `${id}-hash`,
    userId: user,
  })
}

interface SigningKey {
  readonly kid: string
  readonly privateKey: CryptoKey
}

async function createSigningKey(
  test: Test,
  kid: string,
  expiresAt: number | null = null,
): Promise<SigningKey> {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true })
  const { e, kty, n } = await exportJWK(publicKey)
  await create(test, 'jwks', {
    alg: 'RS256',
    createdAt: Date.now(),
    crv: null,
    expiresAt,
    id: kid,
    privateKey: JSON.stringify('$ba$1$00'),
    publicKey: JSON.stringify({ kty, n, e }),
  })
  return { kid, privateKey }
}

async function signAccessToken(
  key: SigningKey,
  overrides: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1_000)
  const claims: Record<string, unknown> = {
    aud: resource,
    azp: 'oauth-client',
    bcn_grant_id: 'alice-oauth-client-consent',
    client_id: 'oauth-client',
    exp: now + 300,
    iat: now - 10,
    iss: issuer,
    jti: crypto.randomUUID(),
    scope: 'mcp:read mcp:write offline_access',
    sid: 'alice-session',
    sub: 'alice',
    token_use: 'oauth-access',
    ...overrides,
  }
  const present = Object.fromEntries(
    Object.entries(claims).filter(([, value]) => value !== undefined),
  )
  return await new SignJWT(present)
    .setProtectedHeader({ alg: 'RS256', kid: key.kid, typ: 'at+jwt', ...header } as never)
    .sign(key.privateKey)
}

function unsignedToken(header: Record<string, unknown>, payload: Record<string, unknown>) {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replaceAll('=', '').replaceAll('+', '-').replaceAll('/', '_')
  return `${encode(header)}.${encode(payload)}.`
}

async function hs256Token(kid: string): Promise<string> {
  const now = Math.floor(Date.now() / 1_000)
  return await new SignJWT({
    aud: resource,
    azp: 'oauth-client',
    client_id: 'oauth-client',
    exp: now + 300,
    iat: now - 10,
    iss: issuer,
    jti: 'hs256',
    scope: 'mcp:read',
    sid: 'alice-session',
    sub: 'alice',
    token_use: 'oauth-access',
  })
    .setProtectedHeader({ alg: 'HS256', kid, typ: 'at+jwt' })
    .sign(new TextEncoder().encode('x'.repeat(64)))
}

async function initGrant() {
  const test = initTest()
  await createResource(test)
  await createClient(test)
  await createUserGrant(test, 'alice')
  const key = await createSigningKey(test, 'kid-current')
  return { test, key }
}

const address = (reference: unknown) =>
  JSON.stringify(getFunctionAddress(reference as typeof adapter.oauthLiveAccess))

const expected = () => Object.freeze({ issuer, resource: new URL(resource) })

// convex-test contexts carry the fixture's root data model; the helpers under test are generic.
type Ctx = AuthCtx<GenericDataModel>
const asCtx = (ctx: unknown) => ctx as Ctx

// The public path: auth.createMcpAccessVerifier(ctx) + auth.requireMcpPrincipal(ctx, principal).
const auth = createBetterConvexAuth(component, {
  appName: 'Example',
  oauth: {
    mcp: { scopes: { 'mcp:read': 'Read projects', 'mcp:write': 'Change projects' } },
  },
})

function verifier(ctx: unknown) {
  return auth.createMcpAccessVerifier(asCtx(ctx), { requiredScopes: ['mcp:read'] })
}

beforeEach(() => {
  vi.stubEnv('SITE_URL', siteUrl)
  vi.stubEnv('CONVEX_SITE_URL', 'https://deployment.example.test')
  clearVerificationKeyCache()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('Better Auth MCP access verifier', () => {
  it('verifies with component keys and returns the typed live principal in one live query', async () => {
    const { test, key } = await initGrant()
    const token = await signAccessToken(key)
    await test.query(async (ctx) => {
      const runQuery = vi.spyOn(ctx, 'runQuery')
      const result = await verifier(ctx).verifyAccessToken(token, expected())
      expect(result).toEqual({
        access: {
          clientId: 'oauth-client',
          issuer,
          resource,
          scopes,
          subject: 'alice',
        },
        principal: {
          clientId: 'oauth-client',
          expiresAt: result.expiresAt,
          grantId: 'alice-oauth-client-consent',
          issuer,
          kind: 'oauth',
          resource,
          scopes,
          sessionId: 'alice-session',
          userId: 'alice',
        },
        expiresAt: result.expiresAt,
      })
      expect(Object.isFrozen(result)).toBe(true)
      expect(JSON.stringify(result)).not.toContain(token)
      // Keys once, then exactly one live query.
      expect(runQuery).toHaveBeenCalledTimes(2)
      expect(address(runQuery.mock.calls[1]?.[0])).toBe(address(adapter.oauthLiveAccess))

      runQuery.mockClear()
      await verifier(ctx).verifyAccessToken(token, expected())
      expect(runQuery).toHaveBeenCalledTimes(1)
      expect(address(runQuery.mock.calls[0]?.[0])).toBe(address(adapter.oauthLiveAccess))
    })
  })

  it.each([
    ['forged issuer', { iss: 'https://evil.example.test/api/auth' }],
    ['wrong audience', { aud: 'https://deployment.example.test/other' }],
    ['array audience', { aud: [resource] }],
    [
      'expired token',
      { exp: Math.floor(Date.now() / 1_000) - 1, iat: Math.floor(Date.now() / 1_000) - 100 },
    ],
    ['over-long lifetime', { exp: Math.floor(Date.now() / 1_000) + 900 }],
    ['Convex session token class', { token_use: 'convex-session' }],
    ['missing token class', { token_use: undefined }],
    ['conflicting client identity', { client_id: 'attacker-client' }],
    ['unknown scope', { scope: 'mcp:read admin' }],
    ['missing required scope', { scope: 'mcp:write' }],
    ['renewable token without grant', { bcn_grant_id: undefined }],
    ['non-renewable token without grant', { bcn_grant_id: undefined, scope: 'mcp:read' }],
    ['empty grant', { bcn_grant_id: '' }],
    ['foreign grant', { bcn_grant_id: 'other-consent' }],
    ['non-renewable foreign grant', { bcn_grant_id: 'other-consent', scope: 'mcp:read' }],
  ])('rejects a %s', async (_label, overrides) => {
    const { test, key } = await initGrant()
    const token = await signAccessToken(key, overrides)
    await test.query(async (ctx) => {
      await expect(verifier(ctx).verifyAccessToken(token, expected())).rejects.toThrow(
        'AUTH_OAUTH_TOKEN_INVALID',
      )
    })
  })

  it('rejects a caller-selected issuer or a resource other than the pinned one', async () => {
    const { test, key } = await initGrant()
    const token = await signAccessToken(key, { iss: 'https://evil.example.test/api/auth' })
    const valid = await signAccessToken(key)
    await test.query(async (ctx) => {
      await expect(
        verifier(ctx).verifyAccessToken(token, {
          issuer: 'https://evil.example.test/api/auth',
          resource: new URL(resource),
        }),
      ).rejects.toThrow('AUTH_OAUTH_TOKEN_INVALID')
      await expect(
        verifier(ctx).verifyAccessToken(valid, {
          issuer,
          resource: new URL('https://deployment.example.test/other'),
        }),
      ).rejects.toThrow('AUTH_OAUTH_TOKEN_INVALID')
    })
  })

  it('rejects alg none, HS256 with a known kid, a foreign signature, and a key-bearing header', async () => {
    const { test, key } = await initGrant()
    const now = Math.floor(Date.now() / 1_000)
    const none = unsignedToken(
      { alg: 'none', kid: key.kid, typ: 'at+jwt' },
      { aud: resource, exp: now + 300, iat: now, iss: issuer, sub: 'alice' },
    )
    const hs256 = await hs256Token(key.kid)
    const { privateKey: foreignKey } = await generateKeyPair('RS256')
    const forged = await signAccessToken({ kid: key.kid, privateKey: foreignKey })
    const embedded = await signAccessToken(key, {}, { jwk: { kty: 'RSA', n: 'AQAB', e: 'AQAB' } })
    await test.query(async (ctx) => {
      for (const token of [none, hs256, forged, embedded, 'not-a-jwt']) {
        await expect(verifier(ctx).verifyAccessToken(token, expected())).rejects.toThrow(
          'AUTH_OAUTH_TOKEN_INVALID',
        )
      }
    })
  })

  it('accepts a retired key within its grace, rejects it after, and finds a rotated key', async () => {
    const { test, key } = await initGrant()
    const token = await signAccessToken(key)
    await test.query(async (ctx) => {
      await verifier(ctx).verifyAccessToken(token, expected())
    })
    // Rotation within the cache lifetime: the unknown kid triggers one fresh read.
    const rotated = await createSigningKey(test, 'kid-next')
    const next = await signAccessToken(rotated)
    await test.query(async (ctx) => {
      await expect(verifier(ctx).verifyAccessToken(next, expected())).resolves.toMatchObject({
        access: { subject: 'alice' },
      })
    })

    clearVerificationKeyCache()
    const retired = initTest()
    await createResource(retired)
    await createClient(retired)
    await createUserGrant(retired, 'alice')
    const graceKey = await createSigningKey(retired, 'kid-grace', Date.now() - 60_000)
    const pastKey = await createSigningKey(
      retired,
      'kid-past',
      Date.now() - (JWKS_GRACE_PERIOD_SECONDS + 1) * 1_000,
    )
    const inGrace = await signAccessToken(graceKey)
    const pastGrace = await signAccessToken(pastKey)
    await retired.query(async (ctx) => {
      await expect(verifier(ctx).verifyAccessToken(inGrace, expected())).resolves.toBeTruthy()
      await expect(verifier(ctx).verifyAccessToken(pastGrace, expected())).rejects.toThrow(
        'AUTH_OAUTH_TOKEN_INVALID',
      )
    })
  })

  it('rejects a cryptographically valid token once its consent is revoked', async () => {
    const { test, key } = await initGrant()
    const token = await signAccessToken(key)
    await test.query(async (ctx) => {
      await expect(verifier(ctx).verifyAccessToken(token, expected())).resolves.toBeTruthy()
    })
    await test.mutation(async (ctx) => {
      await createOAuthConnections(component).revoke(ctx, {
        clientId: 'oauth-client',
        userId: 'alice',
      })
    })
    await test.query(async (ctx) => {
      await expect(verifier(ctx).verifyAccessToken(token, expected())).rejects.toThrow(
        'AUTH_OAUTH_TOKEN_INVALID',
      )
    })
  })
})

describe('disabled OAuth resource', () => {
  it('denies already-issued access tokens while disabled (owner decision for 1.0)', async () => {
    const { test, key } = await initGrant()
    const token = await signAccessToken(key)
    const verified = await test.query(async (ctx) =>
      verifier(ctx).verifyAccessToken(token, expected()),
    )
    const setDisabled = (disabled: boolean) =>
      test.mutation(adapter.updateOne, {
        model: 'oauthResource',
        update: { disabled },
        where: [{ field: 'id', value: 'oauth-resource-row' }],
      })
    await setDisabled(true)
    await test.query(async (ctx) => {
      await expect(verifier(ctx).verifyAccessToken(token, expected())).rejects.toThrow(
        'AUTH_OAUTH_TOKEN_INVALID',
      )
      await expect(
        denial(auth.requireMcpPrincipal(asCtx(ctx), verified.principal)),
      ).resolves.toEqual({ code: 'MCP_ACCESS_DENIED', message: 'MCP access denied' })
    })
    await setDisabled(false)
    await test.query(async (ctx) => {
      await expect(verifier(ctx).verifyAccessToken(token, expected())).resolves.toBeTruthy()
      await expect(
        auth.requireMcpPrincipal(asCtx(ctx), verified.principal, { scope: 'mcp:read' }),
      ).resolves.toBeTruthy()
    })
  })
})

function principal(overrides: Partial<BetterConvexMcpPrincipal> = {}): BetterConvexMcpPrincipal {
  return {
    clientId: 'oauth-client',
    expiresAt: Math.floor(Date.now() / 1_000) + 300,
    grantId: 'alice-oauth-client-consent',
    issuer,
    kind: 'oauth',
    resource,
    scopes: ['mcp:read', 'offline_access'],
    sessionId: 'alice-session',
    userId: 'alice',
    ...overrides,
  }
}

async function denial(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(ConvexError)
    return (error as ConvexError<Record<string, string>>).data
  }
  throw new Error('expected a denial')
}

describe('requireMcpPrincipal', () => {
  it('re-validates in one component query and returns the public live user', async () => {
    const { test } = await initGrant()
    await test.query(async (ctx) => {
      const runQuery = vi.spyOn(ctx, 'runQuery')
      const result = await auth.requireMcpPrincipal(asCtx(ctx), principal(), {
        scope: 'mcp:read',
      })
      expect(runQuery).toHaveBeenCalledTimes(1)
      expect(result.principal).toEqual(principal())
      expect(result.user).toMatchObject({ email: 'alice@example.test', id: 'alice' })
      expect(Object.keys(result.user).some((field) => field.startsWith('bcn'))).toBe(false)
    })
  })

  it('distinguishes insufficient scope from denied access', async () => {
    const { test } = await initGrant()
    await test.query(async (ctx) => {
      await expect(
        denial(auth.requireMcpPrincipal(asCtx(ctx), principal(), { scope: 'mcp:write' })),
      ).resolves.toEqual({
        code: 'MCP_INSUFFICIENT_SCOPE',
        message: 'MCP scope "mcp:write" is required',
      })
    })
  })

  it.each([
    ['expired principal', { expiresAt: Math.floor(Date.now() / 1_000) - 1 }],
    ['foreign issuer', { issuer: 'https://evil.example.test/api/auth' }],
    ['foreign resource', { resource: 'https://deployment.example.test/other' }],
    ['foreign grant', { grantId: 'other-consent' }],
    ['missing grant', { grantId: undefined as never }],
    ['foreign session', { sessionId: 'bob-session' }],
    ['other user', { userId: 'bob' }],
    ['ungranted scope', { scopes: ['mcp:read', 'admin'] }],
  ] as [string, Partial<BetterConvexMcpPrincipal>][])('denies a %s', async (_label, overrides) => {
    const { test } = await initGrant()
    await test.query(async (ctx) => {
      await expect(
        denial(auth.requireMcpPrincipal(asCtx(ctx), principal(overrides))),
      ).resolves.toEqual({ code: 'MCP_ACCESS_DENIED', message: 'MCP access denied' })
    })
  })

  it('denies a revoked connection and a disabled client', async () => {
    const { test } = await initGrant()
    const operator = createOAuthOperator({
      component,
      createAuth: async () => {
        throw new Error('unused')
      },
      resolveProfile: () => undefined,
    })
    await test.mutation(async (ctx) => {
      await operator.setClientDisabled(ctx, { clientId: 'oauth-client', disabled: true })
    })
    await test.query(async (ctx) => {
      await expect(denial(auth.requireMcpPrincipal(asCtx(ctx), principal()))).resolves.toEqual({
        code: 'MCP_ACCESS_DENIED',
        message: 'MCP access denied',
      })
    })
    await test.mutation(async (ctx) => {
      await operator.setClientDisabled(ctx, { clientId: 'oauth-client', disabled: false })
    })
    await test.query(async (ctx) => {
      await expect(auth.requireMcpPrincipal(asCtx(ctx), principal())).resolves.toBeTruthy()
    })
    await test.mutation(async (ctx) => {
      await expect(
        operator.setClientDisabled(ctx, { clientId: 'missing', disabled: true }),
      ).rejects.toThrow('AUTH_OAUTH_CLIENT_NOT_FOUND')
      await createOAuthConnections(component).revoke(ctx, {
        clientId: 'oauth-client',
        userId: 'alice',
      })
    })
    await test.query(async (ctx) => {
      await expect(denial(auth.requireMcpPrincipal(asCtx(ctx), principal()))).resolves.toEqual({
        code: 'MCP_ACCESS_DENIED',
        message: 'MCP access denied',
      })
    })
  })
})

describe('OAuth connections', () => {
  async function initTwoUsers() {
    const test = initTest()
    await createResource(test)
    await createClient(test)
    await createClient(test, 'other-client')
    await createUserGrant(test, 'alice')
    await createUserGrant(test, 'bob')
    await createConsent(test, 'alice', 'other-client')
    await createRefreshToken(test, 'alice', 'alice-refresh')
    await createRefreshToken(test, 'bob', 'bob-refresh')
    return test
  }

  it('B02 includes the newest grant when more than 100 consents exist', async () => {
    const test = initTest()
    await createResource(test)
    await createUser(test, 'alice')
    for (let index = 0; index < 101; index++) {
      const client = `client-${index}`
      await createClient(test, client)
      await create(test, 'oauthConsent', {
        id: `consent-${index}`,
        clientId: client,
        userId: 'alice',
        createdAt: index,
        resources: [resource],
        scopes,
      })
    }
    const connections = createOAuthConnections(component)
    const rows = await test.query((ctx) => connections.list(asCtx(ctx), { userId: 'alice' }))
    expect(rows).toHaveLength(100)
    expect(rows[0]?.clientId).toBe('client-100')
    expect(rows.at(-1)?.clientId).toBe('client-1')
  })

  it("lists only the given user's grants", async () => {
    const test = await initTwoUsers()
    const connections = createOAuthConnections(component)
    await test.query(async (ctx) => {
      const alice = await connections.list(asCtx(ctx), { userId: 'alice' })
      expect(alice.map((row) => row.clientId).sort()).toEqual(['oauth-client', 'other-client'])
      expect(alice.find((row) => row.clientId === 'oauth-client')).toEqual({
        clientId: 'oauth-client',
        clientName: 'Client oauth-client',
        grantedAt: expect.any(Number),
        scopes,
      })
      const bob = await connections.list(asCtx(ctx), { userId: 'bob' })
      expect(bob.map((row) => row.clientId)).toEqual(['oauth-client'])
      await expect(connections.list(asCtx(ctx), { userId: '' })).rejects.toThrow(
        'AUTH_OAUTH_CONNECTION_USER_INVALID',
      )
    })
  })

  it("revokes only that user's consent and refresh tokens for that client", async () => {
    const test = await initTwoUsers()
    const connections = createOAuthConnections(component)
    await test.mutation(async (ctx) => {
      await expect(
        connections.revoke(ctx, { clientId: 'oauth-client', userId: 'alice' }),
      ).resolves.toEqual({ revoked: true })
      await expect(
        connections.revoke(ctx, { clientId: 'oauth-client', userId: 'alice' }),
      ).resolves.toEqual({ revoked: false })
    })
    const rows = async (model: string) =>
      (
        await test.query(adapter.findMany, {
          model,
          paginationOpts: { cursor: null, numItems: 50 },
        })
      ).page
    expect((await rows('oauthConsent')).map((row) => row.id).sort()).toEqual([
      'alice-other-client-consent',
      'bob-oauth-client-consent',
    ])
    expect((await rows('oauthRefreshToken')).map((row) => row.id)).toEqual(['bob-refresh'])
    await test.query(async (ctx) => {
      const live = (user: string) =>
        auth
          .requireMcpPrincipal(
            asCtx(ctx),
            principal({
              grantId: `${user}-oauth-client-consent`,
              sessionId: `${user}-session`,
              userId: user,
            }),
          )
          .then(
            () => true,
            () => false,
          )
      await expect(live('alice')).resolves.toBe(false)
      await expect(live('bob')).resolves.toBe(true)
    })
  })
})

describe('factory MCP wiring', () => {
  it('binds the profile scopes and resource to the verifier and principal checks', async () => {
    const { test, key } = await initGrant()
    expect(auth.mcp.issuer()).toBe(issuer)
    expect(auth.mcp.resource().href).toBe(resource)
    expect(auth.mcp.scopes()).toEqual({
      'mcp:read': 'Read projects',
      'mcp:write': 'Change projects',
    })
    const token = await signAccessToken(key)
    await test.query(async (ctx) => {
      const verified = await auth
        .createMcpAccessVerifier(asCtx(ctx))
        .verifyAccessToken(token, expected())
      await expect(
        auth.requireMcpPrincipal(asCtx(ctx), verified.principal, { scope: 'mcp:write' }),
      ).resolves.toMatchObject({ user: { id: 'alice' } })
    })
  })
})
