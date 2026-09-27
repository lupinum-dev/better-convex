import { componentsGeneric, getFunctionAddress } from 'convex/server'
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComponentApi } from '../../src/runtime/convex-auth/component/_generated/component'
import { createBetterConvexAuth } from '../../src/runtime/convex-auth/create-better-convex-auth'
import {
  clearVerificationKeyCache,
  verifyOAuthBearerToken,
} from '../../src/runtime/convex-auth/oauth-resource'

const siteUrl = 'https://app.example.test'
const issuer = `${siteUrl}/api/auth`
const audience = 'https://deployment.example.test/mcp'
const component = (componentsGeneric() as unknown as { betterAuth: ComponentApi<'betterAuth'> })
  .betterAuth

// The only public verifier path: auth.createMcpAccessVerifier(ctx, options).
const auth = createBetterConvexAuth(component)
const createVerifier = (
  ctx: Parameters<typeof auth.createMcpAccessVerifier>[0],
  options: Parameters<typeof auth.createMcpAccessVerifier>[1],
) => auth.createMcpAccessVerifier(ctx, options)

const address = (reference: unknown) =>
  JSON.stringify(getFunctionAddress(reference as typeof component.adapter.findMany))

let signingKey: CryptoKey
let jwksRow: Record<string, unknown>

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256', {
    extractable: true,
  })
  const { e, kty, n } = await exportJWK(publicKey)
  signingKey = privateKey
  jwksRow = {
    alg: 'RS256',
    crv: null,
    expiresAt: null,
    id: 'kid-1',
    publicKey: JSON.stringify({ kty, n, e }),
  }
})

interface FakeState {
  live: Record<string, unknown> | null | Error
  keys: Record<string, unknown>[]
}

function fakeCtx(state: FakeState) {
  const runQuery = vi.fn(async (reference: unknown, args: Record<string, unknown>) => {
    if (address(reference) === address(component.adapter.findMany)) {
      expect(args).toMatchObject({ model: 'jwks' })
      expect(args.select).not.toContain('privateKey')
      return { continueCursor: '', isDone: true, page: state.keys }
    }
    if (address(reference) === address(component.adapter.oauthLiveAccess)) {
      if (state.live instanceof Error) throw state.live
      return state.live
    }
    throw new Error(`unexpected query ${address(reference)}`)
  })
  return { ctx: { runQuery } as never, runQuery }
}

async function token(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1_000)
  const claims: Record<string, unknown> = {
    aud: audience,
    azp: 'client-1',
    bcn_grant_id: 'consent-1',
    client_id: 'client-1',
    exp: now + 300,
    iat: now - 10,
    iss: issuer,
    jti: 'token-1',
    scope: 'mcp:read',
    sid: 'session-1',
    sub: 'user-1',
    token_use: 'oauth-access',
    ...overrides,
  }
  const present = Object.fromEntries(
    Object.entries(claims).filter(([, value]) => value !== undefined),
  )
  return await new SignJWT(present)
    .setProtectedHeader({ alg: 'RS256', kid: 'kid-1', typ: 'at+jwt' })
    .sign(signingKey)
}

function expectation(resource = audience) {
  return Object.freeze({ issuer, resource: new URL(resource) })
}

beforeEach(() => {
  vi.stubEnv('SITE_URL', siteUrl)
  clearVerificationKeyCache()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('Better Auth MCP resource verification without an HTTP JWKS loop', () => {
  it('verifies against component keys and never fetches over HTTP', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    const { ctx, runQuery } = fakeCtx({
      keys: [jwksRow],
      live: { grantId: 'consent-1', user: {} },
    })
    const verifier = createVerifier(ctx, {
      allowedScopes: ['mcp:read'],
    })
    await expect(verifier.verifyAccessToken(await token(), expectation())).resolves.toMatchObject({
      access: {
        clientId: 'client-1',
        issuer,
        resource: audience,
        scopes: ['mcp:read'],
      },
      principal: {
        grantId: 'consent-1',
        kind: 'oauth',
        sessionId: 'session-1',
        userId: 'user-1',
      },
    })
    expect(fetch).not.toHaveBeenCalled()
    expect(runQuery.mock.calls.at(-1)?.[1]).toEqual({
      clientId: 'client-1',
      grantId: 'consent-1',
      resource: audience,
      scopes: ['mcp:read'],
      sessionId: 'session-1',
      userId: 'user-1',
    })
    fetch.mockRestore()
  })

  it('copies its options so a later caller mutation cannot widen the scope allowlist', async () => {
    const allowedScopes = ['mcp:read']
    const { ctx } = fakeCtx({
      keys: [jwksRow],
      live: { grantId: 'consent-1', user: {} },
    })
    const verifier = createVerifier(ctx, { allowedScopes })
    allowedScopes.push('admin')
    await expect(
      verifier.verifyAccessToken(await token({ scope: 'mcp:read admin' }), expectation()),
    ).rejects.toThrow('AUTH_OAUTH_TOKEN_INVALID')
  })

  it.each([
    ['denied', null],
    ['failed', new Error('private-live-check-sentinel')],
  ])('rejects a cryptographically valid token when live authority is %s', async (_label, live) => {
    const { ctx } = fakeCtx({ keys: [jwksRow], live })
    const verifier = createVerifier(ctx, {
      allowedScopes: ['mcp:read'],
    })
    await expect(verifier.verifyAccessToken(await token(), expectation())).rejects.toThrow(
      'AUTH_OAUTH_TOKEN_INVALID',
    )
  })

  it.each([
    ['missing', { bcn_grant_id: undefined }],
    ['empty', { bcn_grant_id: '' }],
  ])(
    'rejects a non-renewable token whose consent id is %s before the live query',
    async (_label, overrides) => {
      const { ctx, runQuery } = fakeCtx({
        keys: [jwksRow],
        live: { grantId: 'consent-1', user: {} },
      })
      const verifier = createVerifier(ctx, { allowedScopes: ['mcp:read'] })
      await expect(
        verifier.verifyAccessToken(await token(overrides), expectation()),
      ).rejects.toThrow('AUTH_OAUTH_TOKEN_INVALID')
      expect(
        runQuery.mock.calls.some(
          ([reference]) => address(reference) === address(component.adapter.oauthLiveAccess),
        ),
      ).toBe(false)
    },
  )

  it('rechecks live authority on every use of the same signed token', async () => {
    const state: FakeState = {
      keys: [jwksRow],
      live: { grantId: 'consent-1', user: {} },
    }
    const { ctx, runQuery } = fakeCtx(state)
    const verifier = createVerifier(ctx, {
      allowedScopes: ['mcp:read'],
    })
    const signed = await token()
    await verifier.verifyAccessToken(signed, expectation())
    state.live = null
    await expect(verifier.verifyAccessToken(signed, expectation())).rejects.toThrow(
      'AUTH_OAUTH_TOKEN_INVALID',
    )
    const liveCalls = runQuery.mock.calls.filter(
      ([reference]) => address(reference) === address(component.adapter.oauthLiveAccess),
    )
    expect(liveCalls).toHaveLength(2)
  })

  it('rejects a caller-selected issuer before any key lookup', async () => {
    const { ctx, runQuery } = fakeCtx({
      keys: [jwksRow],
      live: { grantId: 'consent-1', user: {} },
    })
    const verifier = createVerifier(ctx, {
      allowedScopes: ['mcp:read'],
    })
    await expect(
      verifier.verifyAccessToken(await token({ iss: 'https://evil.example.test/api/auth' }), {
        issuer: 'https://evil.example.test/api/auth',
        resource: new URL(audience),
      }),
    ).rejects.toThrow('AUTH_OAUTH_TOKEN_INVALID')
    expect(runQuery).not.toHaveBeenCalled()
  })

  it.each([
    'http://deployment.example.test/mcp',
    'https://user@deployment.example.test/mcp',
    'https://deployment.example.test/mcp?tenant=one',
    'https://deployment.example.test/mcp#fragment',
  ])('rejects an unsafe expected MCP resource before any query: %s', async (resource) => {
    const { ctx, runQuery } = fakeCtx({
      keys: [jwksRow],
      live: { grantId: 'consent-1', user: {} },
    })
    const verifier = createVerifier(ctx, {
      allowedScopes: ['mcp:read'],
    })
    await expect(verifier.verifyAccessToken(await token(), expectation(resource))).rejects.toThrow(
      'AUTH_OAUTH_TOKEN_INVALID',
    )
    expect(runQuery).not.toHaveBeenCalled()
  })

  it('rejects malformed compact input and foreign headers before any key lookup', async () => {
    const { ctx, runQuery } = fakeCtx({ keys: [jwksRow], live: null })
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
    for (const value of [
      'not-a-jwt',
      `${'a'.repeat(9000)}.b.c`,
      `${encode({ alg: 'none', kid: 'kid-1', typ: 'at+jwt' })}.${encode({})}.`,
      `${encode({ alg: 'RS256', typ: 'at+jwt' })}.${encode({})}.sig`,
      `${encode({ alg: 'RS256', kid: 'kid-1', typ: 'JWT' })}.${encode({})}.sig`,
      `${encode({ alg: 'RS256', jku: 'https://evil.example/jwks', kid: 'kid-1', typ: 'at+jwt' })}.${encode({})}.sig`,
    ]) {
      await expect(
        verifyOAuthBearerToken(ctx, component, value, {
          allowedScopes: ['mcp:read'],
          audience,
          issuer,
        }),
      ).rejects.toThrow('AUTH_OAUTH_TOKEN_INVALID')
    }
    expect(runQuery).not.toHaveBeenCalled()
  })

  it('never publishes a malformed or private key row for verification', async () => {
    const privateRow = {
      ...jwksRow,
      publicKey: JSON.stringify({
        ...JSON.parse(jwksRow.publicKey as string),
        d: 'secret',
      }),
    }
    for (const row of [
      privateRow,
      { ...jwksRow, alg: 'HS256' },
      { ...jwksRow, crv: 'P-256' },
      { ...jwksRow, expiresAt: 'soon' },
    ]) {
      clearVerificationKeyCache()
      const { ctx } = fakeCtx({
        keys: [row],
        live: { grantId: 'consent-1', user: {} },
      })
      await expect(
        verifyOAuthBearerToken(ctx, component, await token(), {
          allowedScopes: ['mcp:read'],
          audience,
          issuer,
        }),
      ).rejects.toThrow('AUTH_OAUTH_TOKEN_INVALID')
    }
  })

  it('fails construction without a query context, component, or scopes', () => {
    const { ctx } = fakeCtx({ keys: [], live: null })
    expect(() => createVerifier({} as never, { allowedScopes: ['mcp:read'] })).toThrow(
      'AUTH_OAUTH_CONFIG_INVALID',
    )
    expect(() =>
      createBetterConvexAuth(undefined as never).createMcpAccessVerifier(ctx, {
        allowedScopes: ['mcp:read'],
      }),
    ).toThrow('AUTH_OAUTH_CONFIG_INVALID')
    expect(() => createVerifier(ctx, {})).toThrow('AUTH_OAUTH_MCP_PROFILE_REQUIRED')
    expect(() => createVerifier(ctx, { allowedScopes: [] })).toThrow('AUTH_OAUTH_CONFIG_INVALID')
    expect(() =>
      createVerifier(ctx, {
        allowedScopes: ['mcp:read'],
        resource: 'https://deployment.example.test/mcp?x=1',
      }),
    ).toThrow('AUTH_OAUTH_CONFIG_INVALID')
  })

  it('preserves loopback HTTP for the local Convex MCP authority chain', async () => {
    vi.stubEnv('SITE_URL', 'http://127.0.0.1:3210')
    const loopbackIssuer = 'http://127.0.0.1:3210/api/auth'
    const loopbackAudience = 'http://127.0.0.1:3211/mcp'
    const { ctx } = fakeCtx({
      keys: [jwksRow],
      live: { grantId: 'consent-1', user: {} },
    })
    const verifier = createVerifier(ctx, {
      allowedScopes: ['mcp:read'],
    })
    await expect(
      verifier.verifyAccessToken(await token({ aud: loopbackAudience, iss: loopbackIssuer }), {
        issuer: loopbackIssuer,
        resource: new URL(loopbackAudience),
      }),
    ).resolves.toMatchObject({
      access: { issuer: loopbackIssuer, resource: loopbackAudience },
    })
  })
})
