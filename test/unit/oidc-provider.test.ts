import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getOidcClient } from '../../src/runtime/convex-auth/oidc-metadata'
import { resolveOidcConfig } from '../../src/runtime/convex-auth/oidc-options'
import {
  createOidcProvider,
  isOwnedOidcProvider,
} from '../../src/runtime/convex-auth/oidc-provider'
import { createFakeIdp, type FakeIdp } from '../helpers/fake-oidc-idp'

const VERIFIER = 'v'.repeat(64)
const CHALLENGE = 'w1TpKUdYE9hUAcNSeeSRFioHDxfUxuHho_JHAfZ_vDM'
const REDIRECT_URI = 'https://app.example.test/api/auth/callback/oidc'
const NONCE = 'n'.repeat(32)

let installed: Array<() => void> = []

async function fakeIdp(options?: Parameters<typeof createFakeIdp>[0]): Promise<FakeIdp> {
  const idp = await createFakeIdp(options)
  installed.push(idp.install())
  return idp
}

function providerOf(idp: FakeIdp) {
  return createOidcProvider(
    getOidcClient(
      resolveOidcConfig({
        issuer: idp.issuer,
        clientId: idp.clientId,
        clientSecret: idp.clientSecret,
      }),
    ),
  )
}

function requestsTo(idp: FakeIdp, suffix: string): number {
  return idp.requests.filter((request) => request.url.endsWith(suffix)).length
}

function loggedCodes(spy: { readonly mock: { readonly calls: unknown[][] } }): unknown[] {
  return spy.mock.calls.map((call) => (call[1] as { code?: unknown } | undefined)?.code)
}

afterEach(() => {
  for (const restore of installed.reverse()) restore()
  installed = []
  vi.restoreAllMocks()
})

describe('OIDC provider', () => {
  let idp: FakeIdp

  beforeEach(async () => {
    idp = await fakeIdp()
  })

  const expectedAuthorizationParams = () => ({
    response_type: 'code',
    client_id: 'better-convex',
    state: 'state-1',
    scope: 'openid email profile',
    redirect_uri: REDIRECT_URI,
    nonce: NONCE,
    code_challenge_method: 'S256',
    code_challenge: CHALLENGE,
  })

  it('builds an authorization URL with S256, nonce, state and the fixed scopes', async () => {
    const url = await providerOf(idp).createAuthorizationURL({
      state: 'state-1',
      codeVerifier: VERIFIER,
      idTokenNonce: NONCE,
      redirectURI: REDIRECT_URI,
    })

    expect(`${url.origin}${url.pathname}`).toBe(idp.discovery.authorization_endpoint)
    expect(Object.fromEntries(url.searchParams)).toEqual(expectedAuthorizationParams())
  })

  it('ignores scopes, loginHint and additionalParams from the client', async () => {
    const url = await providerOf(idp).createAuthorizationURL({
      state: 'state-1',
      codeVerifier: VERIFIER,
      idTokenNonce: NONCE,
      redirectURI: REDIRECT_URI,
      scopes: ['offline_access', 'admin'],
      loginHint: 'boss@example.test',
      display: 'popup',
      additionalParams: { prompt: 'none', acr_values: 'weak' },
    })

    expect(Object.fromEntries(url.searchParams)).toEqual(expectedAuthorizationParams())
  })

  it('exchanges the code with the verifier and client_secret_basic', async () => {
    const code = idp.issueCode({
      nonce: NONCE,
      codeChallenge: CHALLENGE,
      redirectURI: REDIRECT_URI,
    })

    const tokens = await providerOf(idp).validateAuthorizationCode({
      code,
      codeVerifier: VERIFIER,
      redirectURI: REDIRECT_URI,
    })

    expect(tokens).toMatchObject({ tokenType: 'Bearer', idToken: expect.any(String) })
    const tokenRequest = idp.requests.find((request) => request.method === 'POST')!
    expect(tokenRequest.headers.get('authorization')).toBe(
      `Basic ${btoa('better-convex:test-client-secret')}`,
    )
    expect(Object.fromEntries(tokenRequest.body!)).toEqual({
      grant_type: 'authorization_code',
      code,
      code_verifier: VERIFIER,
      redirect_uri: REDIRECT_URI,
    })
  })

  it('throws when the token response has no id_token', async () => {
    idp.respond.token = () =>
      Response.json({ access_token: 'access-1', token_type: 'Bearer', expires_in: 300 })

    await expect(
      providerOf(idp).validateAuthorizationCode({
        code: 'code-1',
        codeVerifier: VERIFIER,
        redirectURI: REDIRECT_URI,
      }),
    ).rejects.toThrow('AUTH_OIDC_ID_TOKEN_INVALID:missing')
  })

  it('returns the verified profile for a valid id_token and nonce', async () => {
    const idToken = await idp.signIdToken({
      nonce: NONCE,
      picture: 'https://cdn.example.test/ada.png',
      groups: ['admin'],
    })

    const result = await providerOf(idp).getUserInfo({ idToken, expectedIdTokenNonce: NONCE })

    expect(result).not.toBeNull()
    expect(result!.user).toEqual({
      email: 'ada@example.test',
      emailVerified: true,
      name: 'Ada Lovelace',
      image: 'https://cdn.example.test/ada.png',
    })
    expect(result!.data).toMatchObject({ iss: idp.issuer, sub: 'user-1', nonce: NONCE })
  })

  it('rejects an id_token whose nonce differs', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const idToken = await idp.signIdToken({ nonce: 'm'.repeat(32) })

    const result = await providerOf(idp).getUserInfo({ idToken, expectedIdTokenNonce: NONCE })

    expect(result).toBeNull()
    expect(loggedCodes(error)).toEqual(['AUTH_OIDC_ID_TOKEN_INVALID:nonce'])
  })

  it('returns null without an expected nonce', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const idToken = await idp.signIdToken({ nonce: NONCE })

    const result = await providerOf(idp).getUserInfo({ idToken })

    expect(result).toBeNull()
    expect(loggedCodes(error)).toEqual(['AUTH_OIDC_ID_TOKEN_INVALID:missing'])
    expect(idp.requests).toEqual([])
  })

  for (const testCase of [
    { name: 'true → true', claims: { email_verified: true }, expected: true },
    { name: '"true" → false', claims: { email_verified: 'true' }, expected: false },
    { name: 'absent → false', claims: { email_verified: undefined }, expected: false },
    { name: '1 → false', claims: { email_verified: 1 }, expected: false },
  ]) {
    it(`maps email_verified ${testCase.name}`, async () => {
      const idToken = await idp.signIdToken({ nonce: NONCE, ...testCase.claims })

      const result = await providerOf(idp).getUserInfo({ idToken, expectedIdTokenNonce: NONCE })

      expect(result?.user.emailVerified).toBe(testCase.expected)
    })
  }

  it('uses the issuer-tagged sub as the account subject', async () => {
    const tagged = await fakeIdp({ issuer: 'https://idp.example.test/realms/provider-account-key' })
    const provider = providerOf(tagged)
    const idToken = await tagged.signIdToken({ nonce: NONCE, sub: 'user-7' })
    const result = await provider.getUserInfo({ idToken, expectedIdTokenNonce: NONCE })

    const subject = await provider.accountSubject({ tokens: { idToken }, profile: result!.data })

    expect(subject).toBe('DCsRq5KQ1E2_1faS:user-7')
  })

  it('builds the end-session URL with client_id, id_token_hint, post_logout_redirect_uri and state', async () => {
    const url = await providerOf(idp).createEndSessionURL!({
      idToken: 'stored-id-token',
      postLogoutRedirectURI: 'https://app.example.test/signed-out',
      state: 'logout-state',
    })

    expect(url?.toString()).toBe(
      `${String(idp.discovery.end_session_endpoint)}?client_id=better-convex` +
        '&id_token_hint=stored-id-token' +
        '&post_logout_redirect_uri=https%3A%2F%2Fapp.example.test%2Fsigned-out' +
        '&state=logout-state',
    )
  })

  it('returns null when discovery has no end_session_endpoint', async () => {
    delete idp.discovery.end_session_endpoint

    const url = await providerOf(idp).createEndSessionURL!({ idToken: 'stored-id-token' })

    expect(url).toBeNull()
  })

  it('answers SERVICE_UNAVAILABLE OIDC_UNAVAILABLE when discovery fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    idp.respond.discovery = () => new Response('down', { status: 500 })

    const attempt = providerOf(idp).createAuthorizationURL({
      state: 'state-1',
      codeVerifier: VERIFIER,
      idTokenNonce: NONCE,
      redirectURI: REDIRECT_URI,
    })

    await expect(attempt).rejects.toMatchObject({
      status: 'SERVICE_UNAVAILABLE',
      statusCode: 503,
      body: { code: 'OIDC_UNAVAILABLE', message: 'OIDC_UNAVAILABLE' },
    })
    expect(requestsTo(idp, '/.well-known/openid-configuration')).toBe(1)
  })

  it('is frozen', () => {
    const provider = providerOf(idp)

    expect(() => {
      provider.options!.disableIdTokenSignIn = false
    }).toThrow(TypeError)
    expect(() => {
      provider.requiresIdTokenNonce = false
    }).toThrow(TypeError)
    expect(provider.options).toMatchObject({
      disableIdTokenSignIn: true,
      overrideUserInfoOnSignIn: false,
    })
  })

  it('recognizes only the provider it built', () => {
    const provider = providerOf(idp)

    expect(isOwnedOidcProvider(provider)).toBe(true)
    expect(isOwnedOidcProvider({ ...provider })).toBe(false)
  })
})
