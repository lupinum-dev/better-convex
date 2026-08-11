import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from 'jose'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { verifyAndNormalizeMcpAccess } from '../../packages/mcp/src/access'
import {
  discoverExternalOAuthVerifier,
  type ExternalOAuthVerifierOptions,
} from '../helpers/external-oauth-profile'

const issuer = 'https://external.example.test/'
const discoveryUrl = new URL('https://external.example.test/.well-known/oauth-authorization-server')
const jwksUrl = 'https://external.example.test/oauth/jwks'
const resource = new URL('https://notes.example.test/mcp')
const keyId = 'external-rs256-1'
let privateKey: CryptoKey
let publicJwk: JWK

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true })
  privateKey = pair.privateKey
  publicJwk = {
    ...(await exportJWK(pair.publicKey)),
    alg: 'RS256',
    kid: keyId,
    use: 'sig',
  }
})

function externalFetch(metadataOverrides: Record<string, unknown> = {}) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url === discoveryUrl.href) {
      return Response.json(
        {
          authorization_endpoint: `${issuer}authorize`,
          issuer,
          jwks_uri: jwksUrl,
          token_endpoint: `${issuer}token`,
          ...metadataOverrides,
        },
        { headers: { 'content-type': 'application/json' } },
      )
    }
    if (url === jwksUrl) {
      return Response.json(
        { keys: [publicJwk] },
        { headers: { 'cache-control': 'public, max-age=60', 'content-type': 'application/json' } },
      )
    }
    return new Response(null, { status: 404 })
  })
}

async function createVerifier(
  now: () => number = () => 1_800_000_000,
  overrides: Partial<ExternalOAuthVerifierOptions> = {},
) {
  return await discoverExternalOAuthVerifier({
    allowedScopes: ['notes:read', 'notes:write'],
    discoveryUrl,
    fetch: externalFetch(),
    issuer,
    maxLifetimeSeconds: 300,
    now,
    ...overrides,
  })
}

async function accessToken(
  overrides: Record<string, unknown> = {},
  headerOverrides: Record<string, unknown> = {},
): Promise<string> {
  return await new SignJWT({
    aud: resource.href,
    client_id: 'external-client-1',
    exp: 1_800_000_240,
    iat: 1_800_000_000,
    iss: issuer,
    jti: 'external-token-1',
    scope: 'notes:read notes:write',
    sub: 'external-user-1',
    ...overrides,
  })
    .setProtectedHeader({ alg: 'RS256', kid: keyId, typ: 'at+jwt', ...headerOverrides })
    .sign(privateKey)
}

describe('external RFC 8414 and RFC 9068 verifier profile', () => {
  const expectation = () => Object.freeze({ issuer, resource: new URL(resource.href) })

  it('discovers an exact issuer, verifies its public JWKS, and returns only safe access provenance', async () => {
    const fetch = externalFetch()
    const verifier = await createVerifier(() => 1_800_000_000, { fetch })
    const token = await accessToken()

    await expect(
      verifyAndNormalizeMcpAccess({
        verifier,
        token,
        expectedIssuer: issuer,
        expectedResource: resource,
        now: () => 1_800_000_000,
      }),
    ).resolves.toEqual({
      access: {
        clientId: 'external-client-1',
        issuer,
        resource: resource.href,
        scopes: ['notes:read', 'notes:write'],
        subject: 'external-user-1',
      },
      expiresAt: 1_800_000_240,
    })

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([discoveryUrl.href, jwksUrl])
    const serialized = JSON.stringify(await verifier.verifyAccessToken(token, expectation()))
    expect(serialized).not.toContain(token)
    expect(serialized).not.toContain('jti')
  })

  it.each([
    ['ID-token class', {}, { typ: 'JWT' }],
    ['missing access-token class', {}, { typ: undefined }],
    ['foreign issuer', { iss: 'https://foreign.example.test/' }, {}],
    ['foreign resource', { aud: 'https://other.example.test/mcp' }, {}],
    ['multi-resource audience', { aud: [resource.href, 'https://other.example.test/mcp'] }, {}],
    ['missing client', { client_id: undefined }, {}],
    ['future issue time', { iat: 1_800_000_001 }, {}],
    ['excess lifetime', { exp: 1_800_000_301 }, {}],
    ['unapproved scope', { scope: 'notes:read notes:admin' }, {}],
  ])('rejects %s', async (_label, claimOverrides, headerOverrides) => {
    const verifier = await createVerifier()
    await expect(
      verifier.verifyAccessToken(await accessToken(claimOverrides, headerOverrides), expectation()),
    ).rejects.toThrow()
  })

  it('rejects malformed, expired, and wrong-key access tokens', async () => {
    const verifier = await createVerifier()
    await expect(verifier.verifyAccessToken('not-a-jwt', expectation())).rejects.toThrow()
    await expect(
      verifier.verifyAccessToken(await accessToken({ exp: 1_799_999_999 }), expectation()),
    ).rejects.toThrow()

    const foreign = await generateKeyPair('RS256')
    const wrongKeyToken = await new SignJWT({
      aud: resource.href,
      client_id: 'external-client-1',
      exp: 1_800_000_240,
      iat: 1_800_000_000,
      iss: issuer,
      jti: 'foreign-key-token',
      scope: 'notes:read',
      sub: 'external-user-1',
    })
      .setProtectedHeader({ alg: 'RS256', kid: keyId, typ: 'at+jwt' })
      .sign(foreign.privateKey)
    await expect(verifier.verifyAccessToken(wrongKeyToken, expectation())).rejects.toThrow()
  })

  it('rejects discovery issuer substitution before accepting token material', async () => {
    await expect(
      createVerifier(() => 1_800_000_000, {
        fetch: externalFetch({ issuer: 'https://attacker.example.test/' }),
      }),
    ).rejects.toThrow('External OAuth access validation failed')
  })

  it('keeps offline provider revocation expiry-bounded while application revocation is immediate', async () => {
    let now = 1_800_000_000
    const verifier = await createVerifier(() => now)
    const token = await accessToken()
    const providerState = { grantRevoked: false }
    let applicationCredentialActive = true

    const invokeApplicationEffect = async () => {
      const verified = await verifier.verifyAccessToken(token, expectation())
      if (!applicationCredentialActive) throw new Error('APPLICATION_ACCESS_REVOKED')
      return `${verified.access.issuer}:${verified.access.subject}`
    }

    await expect(invokeApplicationEffect()).resolves.toBe(`${issuer}:external-user-1`)
    providerState.grantRevoked = true
    expect(providerState.grantRevoked).toBe(true)
    await expect(invokeApplicationEffect()).resolves.toBe(`${issuer}:external-user-1`)

    applicationCredentialActive = false
    await expect(invokeApplicationEffect()).rejects.toThrow('APPLICATION_ACCESS_REVOKED')

    now = 1_800_000_241
    await expect(verifier.verifyAccessToken(token, expectation())).rejects.toThrow()
  })
})
