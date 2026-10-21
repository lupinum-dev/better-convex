import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { oidcDeadline } from '../../src/runtime/convex-auth/oidc-fetch'
import { getOidcClient, type OidcJwtCheck } from '../../src/runtime/convex-auth/oidc-metadata'
import { resolveOidcConfig } from '../../src/runtime/convex-auth/oidc-options'
import { createFakeIdp, type FakeIdp } from '../helpers/fake-oidc-idp'

const ID_TOKEN: OidcJwtCheck = {
  typ: 'id_token',
  requiredClaims: ['iss', 'sub', 'aud', 'exp', 'iat', 'nonce'],
  maxTokenAgeSeconds: 600,
}
const VERIFIER = 'v'.repeat(64)
const CHALLENGE = 'w1TpKUdYE9hUAcNSeeSRFioHDxfUxuHho_JHAfZ_vDM'

let installed: Array<() => void> = []

async function fakeIdp(options?: Parameters<typeof createFakeIdp>[0]): Promise<FakeIdp> {
  const idp = await createFakeIdp(options)
  installed.push(idp.install())
  return idp
}

function clientOf(idp: FakeIdp) {
  return getOidcClient(
    resolveOidcConfig({
      issuer: idp.issuer,
      clientId: idp.clientId,
      clientSecret: idp.clientSecret,
    }),
  )
}

function requestsTo(idp: FakeIdp, suffix: string): number {
  return idp.requests.filter((request) => request.url.endsWith(suffix)).length
}

const now = () => Math.floor(Date.now() / 1000)

function base64url(value: string): string {
  return btoa(value).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '')
}

function tamper(token: string): string {
  const [header, payload, signature] = token.split('.')
  const claims = JSON.parse(atob(payload!.replace(/-/gu, '+').replace(/_/gu, '/')))
  return `${header}.${base64url(JSON.stringify({ ...claims, sub: 'admin' }))}.${signature}`
}

afterEach(() => {
  for (const restore of installed.reverse()) restore()
  installed = []
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('OIDC discovery and keys', () => {
  let idp: FakeIdp

  beforeEach(async () => {
    idp = await fakeIdp()
  })

  it('rejects a document whose issuer differs from the configured issuer', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    idp.discovery.issuer = 'https://attacker.example.test/realms/acme'

    await expect(clientOf(idp).metadata(oidcDeadline())).rejects.toThrow(
      'AUTH_OIDC_ISSUER_MISMATCH',
    )
    expect(log).toHaveBeenCalledWith('[better-convex] AUTH_OIDC_FAILURE', {
      code: 'AUTH_OIDC_ISSUER_MISMATCH',
      cause: undefined,
      expected: idp.issuer,
      received: 'https://attacker.example.test/realms/acme',
    })
  })

  for (const testCase of [
    {
      name: 'token_endpoint on http',
      loopbackIssuer: false,
      change: { token_endpoint: 'http://idp.example.test/token' },
      error: 'AUTH_OIDC_DISCOVERY_INVALID:token_endpoint',
    },
    {
      name: 'token_endpoint on http on a public host with a loopback http issuer',
      loopbackIssuer: true,
      change: { token_endpoint: 'http://idp.example.test/token' },
      error: 'AUTH_OIDC_DISCOVERY_INVALID:token_endpoint',
    },
    {
      name: 'jwks_uri with credentials',
      loopbackIssuer: false,
      change: { jwks_uri: 'https://user:pass@idp.example.test/certs' },
      error: 'AUTH_OIDC_DISCOVERY_INVALID:jwks_uri',
    },
    {
      name: 'no S256 in code_challenge_methods_supported',
      loopbackIssuer: false,
      change: { code_challenge_methods_supported: ['plain'] },
      error: 'AUTH_OIDC_DISCOVERY_INVALID:pkce',
    },
    {
      name: 'only HS256 advertised',
      loopbackIssuer: false,
      change: { id_token_signing_alg_values_supported: ['HS256'] },
      error: 'AUTH_OIDC_DISCOVERY_INVALID:algorithms',
    },
    {
      name: 'none advertised',
      loopbackIssuer: false,
      change: { id_token_signing_alg_values_supported: ['none'] },
      error: 'AUTH_OIDC_DISCOVERY_INVALID:algorithms',
    },
    {
      name: 'no supported token auth method',
      loopbackIssuer: false,
      change: { token_endpoint_auth_methods_supported: ['private_key_jwt'] },
      error: 'AUTH_OIDC_DISCOVERY_INVALID:token_auth',
    },
  ]) {
    it(`rejects discovery with ${testCase.name}`, async () => {
      const { loopbackIssuer, change, error } = testCase
      const target = loopbackIssuer
        ? await fakeIdp({ issuer: `http://127.0.0.1:8080/realms/${crypto.randomUUID()}` })
        : idp
      Object.assign(target.discovery, change)

      await expect(clientOf(target).metadata(oidcDeadline())).rejects.toThrow(error)
    })
  }

  it('uses the advertised algorithms in our order', async () => {
    idp.discovery.id_token_signing_alg_values_supported = [
      'ES256',
      'HS256',
      'RS256',
      'none',
      'PS256',
    ]

    const metadata = await clientOf(idp).metadata(oidcDeadline())

    expect(metadata.algorithms).toEqual(['RS256', 'PS256', 'ES256'])
  })

  it('does not fetch again within 10 s after a discovery failure', async () => {
    vi.useFakeTimers()
    idp.respond.discovery = () => new Response('down', { status: 500 })
    const client = clientOf(idp)

    await expect(client.metadata(oidcDeadline())).rejects.toThrow('AUTH_OIDC_DISCOVERY_FAILED:500')
    await vi.advanceTimersByTimeAsync(9_999)
    await expect(client.metadata(oidcDeadline())).rejects.toThrow('AUTH_OIDC_DISCOVERY_FAILED:500')

    expect(requestsTo(idp, '/.well-known/openid-configuration')).toBe(1)
  })

  it('retries discovery after the backoff', async () => {
    vi.useFakeTimers()
    idp.respond.discovery = () => new Response('down', { status: 500 })
    const client = clientOf(idp)
    await expect(client.metadata(oidcDeadline())).rejects.toThrow('AUTH_OIDC_DISCOVERY_FAILED:500')

    delete idp.respond.discovery
    await vi.advanceTimersByTimeAsync(10_000)

    await expect(client.metadata(oidcDeadline())).resolves.toMatchObject({
      issuer: idp.issuer,
      algorithms: ['RS256'],
    })
    expect(requestsTo(idp, '/.well-known/openid-configuration')).toBe(2)
  })

  it('verifies a valid id_token', async () => {
    const token = await idp.signIdToken({ nonce: 'n-1' })

    const result = await clientOf(idp).verifyJwt(token, ID_TOKEN, oidcDeadline())

    expect(result).toMatchObject({
      ok: true,
      payload: { iss: idp.issuer, aud: 'better-convex', sub: 'user-1', nonce: 'n-1' },
      header: { alg: 'RS256', typ: 'JWT' },
    })
  })

  for (const testCase of [
    {
      name: 'signed with RS384 when only RS256 is advertised',
      sign: (fake: FakeIdp) => fake.signIdToken({ nonce: 'n' }, { alg: 'RS384' }),
      reason: 'algorithm',
      keyFetches: 1,
    },
    {
      name: 'with alg HS256',
      sign: (fake: FakeIdp) => fake.signIdToken({ nonce: 'n' }, { alg: 'HS256' }),
      reason: 'algorithm',
      keyFetches: 0,
    },
    {
      name: 'from another issuer',
      sign: (fake: FakeIdp) =>
        fake.signIdToken({ nonce: 'n', iss: 'https://other.example.test/realms/acme' }),
      reason: 'issuer',
      keyFetches: 1,
    },
    {
      name: 'for another audience',
      sign: (fake: FakeIdp) => fake.signIdToken({ nonce: 'n', aud: 'other-client' }),
      reason: 'audience',
      keyFetches: 1,
    },
    {
      name: 'with azp of another client',
      sign: (fake: FakeIdp) => fake.signIdToken({ nonce: 'n', azp: 'other-client' }),
      reason: 'azp',
      keyFetches: 1,
    },
    {
      name: 'with two audiences and no azp',
      sign: (fake: FakeIdp) =>
        fake.signIdToken({ nonce: 'n', aud: ['better-convex', 'other-client'] }),
      reason: 'azp',
      keyFetches: 1,
    },
    {
      name: 'expired',
      sign: (fake: FakeIdp) => fake.signIdToken({ nonce: 'n', iat: now() - 300, exp: now() - 120 }),
      reason: 'expired',
      keyFetches: 1,
    },
    {
      // The 60 s clock tolerance applies to the age too, so 600 s + 60 s is still accepted.
      name: 'issued 13 minutes ago',
      sign: (fake: FakeIdp) => fake.signIdToken({ nonce: 'n', iat: now() - 780, exp: now() + 300 }),
      reason: 'too_old',
      keyFetches: 1,
    },
    {
      name: 'issued 2 minutes in the future',
      sign: (fake: FakeIdp) => fake.signIdToken({ nonce: 'n', iat: now() + 120, exp: now() + 600 }),
      reason: 'not_yet_valid',
      keyFetches: 1,
    },
    {
      name: 'with typ at+jwt',
      sign: (fake: FakeIdp) => fake.signIdToken({ nonce: 'n' }, { typ: 'at+jwt' }),
      reason: 'typ',
      keyFetches: 0,
    },
    {
      name: 'tampered payload',
      sign: async (fake: FakeIdp) => tamper(await fake.signIdToken({ nonce: 'n' })),
      reason: 'signature',
      keyFetches: 1,
    },
    {
      name: 'over 16 KiB',
      sign: (fake: FakeIdp) => fake.signIdToken({ nonce: 'n', padding: 'x'.repeat(17_000) }),
      reason: 'too_large',
      keyFetches: 0,
    },
    {
      name: 'with a header that is not JSON',
      sign: async (fake: FakeIdp) =>
        `${base64url('not json')}.${(await fake.signIdToken({ nonce: 'n' })).split('.').slice(1).join('.')}`,
      reason: 'malformed',
      keyFetches: 0,
    },
  ]) {
    it(`rejects a token ${testCase.name}`, async () => {
      const { sign, reason, keyFetches } = testCase
      const token = await sign(idp)

      const result = await clientOf(idp).verifyJwt(token, ID_TOKEN, oidcDeadline())

      expect(result).toEqual({ ok: false, reason })
      expect(requestsTo(idp, '/certs')).toBe(keyFetches)
    })
  }

  it('refetches the key set once for an unknown kid after the cooldown', async () => {
    vi.useFakeTimers()
    const client = clientOf(idp)
    const before = await idp.signIdToken({ nonce: 'n' })
    expect(await client.verifyJwt(before, ID_TOKEN, oidcDeadline())).toMatchObject({ ok: true })

    await idp.rotateKey()
    await vi.advanceTimersByTimeAsync(30_000)
    const after = await idp.signIdToken({ nonce: 'n' })

    expect(await client.verifyJwt(after, ID_TOKEN, oidcDeadline())).toMatchObject({ ok: true })
    expect(requestsTo(idp, '/certs')).toBe(2)
  })

  it('fetches JWKS at most once per 30 s for unknown kids and answers keys_unavailable', async () => {
    vi.useFakeTimers()
    const client = clientOf(idp)
    const valid = await idp.signIdToken({ nonce: 'n' })
    expect(await client.verifyJwt(valid, ID_TOKEN, oidcDeadline())).toMatchObject({ ok: true })
    const forged = (kid: string) => idp.signIdToken({ nonce: 'n' }, { kid })

    expect(await client.verifyJwt(await forged('unknown-1'), ID_TOKEN, oidcDeadline())).toEqual({
      ok: false,
      reason: 'keys_unavailable',
    })
    expect(requestsTo(idp, '/certs')).toBe(1)

    await vi.advanceTimersByTimeAsync(30_000)
    expect(await client.verifyJwt(await forged('unknown-2'), ID_TOKEN, oidcDeadline())).toEqual({
      ok: false,
      reason: 'signature',
    })
    expect(await client.verifyJwt(await forged('unknown-3'), ID_TOKEN, oidcDeadline())).toEqual({
      ok: false,
      reason: 'keys_unavailable',
    })
    expect(requestsTo(idp, '/certs')).toBe(2)
  })

  it('gives another account key for the same sub at another issuer', async () => {
    const config = { clientId: 'app', clientSecret: 'secret' }
    const acme = getOidcClient(
      resolveOidcConfig({ ...config, issuer: 'https://sso.example.com/realms/acme' }),
    )
    const other = getOidcClient(
      resolveOidcConfig({ ...config, issuer: 'https://sso.example.com/realms/other' }),
    )

    expect(await acme.accountKey('42')).toBe('iROJEEDHRBnJS7so:42')
    expect(await other.accountKey('42')).toBe('YS8I_84mwxXYd7JX:42')
  })

  it('sends client_secret_basic by default and client_secret_post when only that is advertised', async () => {
    const postIdp = await fakeIdp()
    postIdp.discovery.token_endpoint_auth_methods_supported = ['client_secret_post']
    const redirectURI = 'https://app.example.test/api/auth/callback/oidc'

    for (const fake of [idp, postIdp]) {
      const code = fake.issueCode({ nonce: 'n', codeChallenge: CHALLENGE, redirectURI })
      const result = await clientOf(fake).requestTokens(
        { type: 'authorization_code', code, codeVerifier: VERIFIER, redirectURI },
        oidcDeadline(),
      )
      expect(result).toMatchObject({ ok: true, tokens: { tokenType: 'Bearer' } })
    }

    const [basic] = idp.requests.filter((request) => request.method === 'POST')
    expect(basic!.headers.get('authorization')).toBe(
      `Basic ${btoa('better-convex:test-client-secret')}`,
    )
    expect(basic!.body!.has('client_secret')).toBe(false)
    const [post] = postIdp.requests.filter((request) => request.method === 'POST')
    expect(post!.headers.get('authorization')).toBeNull()
    expect(post!.body!.get('client_id')).toBe('better-convex')
    expect(post!.body!.get('client_secret')).toBe('test-client-secret')
  })

  it('returns the error code of a 400 token response', async () => {
    idp.respond.token = () =>
      Response.json(
        { error: 'invalid_grant', error_description: 'Session not active' },
        { status: 400 },
      )

    const result = await clientOf(idp).requestTokens(
      { type: 'refresh_token', refreshToken: 'stale' },
      oidcDeadline(),
    )

    expect(result).toEqual({ ok: false, status: 400, error: 'invalid_grant' })
  })

  it('never logs the client secret', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mismatch = await fakeIdp()
    mismatch.discovery.issuer = 'https://attacker.example.test/realms/acme'
    const down = await fakeIdp()
    down.respond.discovery = () => new Response('down', { status: 500 })
    idp.respond.token = () => Response.json({ error: 'invalid_client' }, { status: 401 })
    const broken = await fakeIdp()
    broken.respond.token = () => {
      throw new TypeError(`connection reset; client_secret=${broken.clientSecret}`)
    }
    const refresh = { type: 'refresh_token', refreshToken: 'r' } as const

    await expect(clientOf(mismatch).metadata(oidcDeadline())).rejects.toThrow()
    await expect(clientOf(down).metadata(oidcDeadline())).rejects.toThrow()
    await expect(clientOf(idp).requestTokens(refresh, oidcDeadline())).resolves.toEqual({
      ok: false,
      status: 401,
      error: 'invalid_client',
    })
    await expect(clientOf(broken).requestTokens(refresh, oidcDeadline())).rejects.toThrow(
      'AUTH_OIDC_TOKEN_REQUEST_FAILED:network',
    )

    expect(log).toHaveBeenCalled()
    for (const call of log.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('test-client-secret')
    }
  })
})
