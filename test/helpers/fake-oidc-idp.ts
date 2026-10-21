/**
 * A fake OpenID Connect identity provider at `fetch`: discovery, JWKS and the
 * token endpoint. It uses only web APIs and `jose`, so it runs in the `node`
 * and `edge-runtime` projects. Each fake has its own issuer, so the per-isolate
 * OIDC caches never need a reset between tests.
 */
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey, type JWK } from 'jose'
import { vi } from 'vitest'

export interface FakeIdpRequest {
  url: string
  method: string
  headers: Headers
  body: URLSearchParams | null
}

type Endpoint = 'discovery' | 'jwks' | 'token'

export interface FakeIdp {
  /** Unique per fake: 'https://idp.example.test/realms/<random>'. */
  readonly issuer: string
  readonly clientId: string
  readonly clientSecret: string
  readonly requests: FakeIdpRequest[]
  /** The discovery document; mutable per test. */
  discovery: Record<string, unknown>
  /** Replace one endpoint's answer. */
  respond: Partial<Record<Endpoint, (request: Request) => Response | Promise<Response>>>
  issueCode(input: {
    nonce: string
    codeChallenge: string
    redirectURI: string
    claims?: Record<string, unknown>
  }): string
  signIdToken(claims?: Record<string, unknown>, header?: Record<string, unknown>): Promise<string>
  signLogoutToken(
    claims?: Record<string, unknown>,
    header?: Record<string, unknown>,
  ): Promise<string>
  /** Replace the signing key. JWKS then serves only the new key. */
  rotateKey(): Promise<void>
  /** Stub `fetch`; other URLs go to the previous `fetch`. Returns the restore function. */
  install(): () => void
}

const BACKCHANNEL_LOGOUT_EVENT = 'http://schemas.openid.net/event/backchannel-logout'

interface SigningKey {
  readonly kid: string
  readonly alg: string
  readonly privateKey: CryptoKey | Uint8Array
  readonly publicJwk: JWK | null
}

async function createSigningKey(alg: string): Promise<SigningKey> {
  const kid = crypto.randomUUID()
  if (alg.startsWith('HS')) {
    return { kid, alg, privateKey: crypto.getRandomValues(new Uint8Array(64)), publicJwk: null }
  }
  const { privateKey, publicKey } = await generateKeyPair(alg, { extractable: true })
  return {
    kid,
    alg,
    privateKey,
    publicJwk: { ...(await exportJWK(publicKey)), kid, alg, use: 'sig' },
  }
}

function randomToken(): string {
  return crypto.randomUUID().replaceAll('-', '')
}

// The statuses a real fetch follows when `redirect` is not 'manual'.
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  let binary = ''
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '')
}

function withoutUndefined(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined))
}

export async function createFakeIdp(
  options: { issuer?: string; algorithm?: 'RS256' | 'ES256' } = {},
): Promise<FakeIdp> {
  const issuer = options.issuer ?? `https://idp.example.test/realms/${crypto.randomUUID()}`
  const algorithm = options.algorithm ?? 'RS256'
  const clientId = 'better-convex'
  const clientSecret = 'test-client-secret'
  const base = issuer.endsWith('/') ? issuer.slice(0, -1) : issuer
  const urls = {
    discovery: issuer.endsWith('/')
      ? `${issuer}.well-known/openid-configuration`
      : `${issuer}/.well-known/openid-configuration`,
    authorization: `${base}/protocol/openid-connect/auth`,
    token: `${base}/protocol/openid-connect/token`,
    jwks: `${base}/protocol/openid-connect/certs`,
    endSession: `${base}/protocol/openid-connect/logout`,
  }
  let key = await createSigningKey(algorithm)
  const otherKeys = new Map<string, SigningKey>()
  const codes = new Map<
    string,
    { nonce: string; codeChallenge: string; redirectURI: string; claims: Record<string, unknown> }
  >()
  // Live refresh tokens and the claims of the sign-in they belong to.
  const refreshTokens = new Map<string, Record<string, unknown>>()

  const now = () => Math.floor(Date.now() / 1000)

  async function sign(
    payload: Record<string, unknown>,
    header: Record<string, unknown>,
  ): Promise<string> {
    const protectedHeader = withoutUndefined({ alg: key.alg, kid: key.kid, ...header })
    const alg = String(protectedHeader.alg)
    let signer = key
    if (alg !== key.alg) {
      signer = otherKeys.get(alg) ?? (await createSigningKey(alg))
      otherKeys.set(alg, signer)
    }
    return await new SignJWT(withoutUndefined(payload))
      .setProtectedHeader({ ...protectedHeader, alg })
      .sign(signer.privateKey)
  }

  const idp: FakeIdp = {
    issuer,
    clientId,
    clientSecret,
    requests: [],
    discovery: {
      issuer,
      authorization_endpoint: urls.authorization,
      token_endpoint: urls.token,
      jwks_uri: urls.jwks,
      end_session_endpoint: urls.endSession,
      response_types_supported: ['code'],
      code_challenge_methods_supported: ['S256'],
      id_token_signing_alg_values_supported: [algorithm],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    },
    respond: {},
    issueCode(input) {
      const code = randomToken()
      codes.set(code, { ...input, claims: input.claims ?? {} })
      return code
    },
    signIdToken(claims = {}, header = {}) {
      const issuedAt = now()
      return sign(
        {
          iss: issuer,
          aud: clientId,
          sub: 'user-1',
          iat: issuedAt,
          exp: issuedAt + 300,
          email: 'ada@example.test',
          email_verified: true,
          name: 'Ada Lovelace',
          ...claims,
        },
        { typ: 'JWT', ...header },
      )
    },
    signLogoutToken(claims = {}, header = {}) {
      return sign(
        {
          iss: issuer,
          aud: clientId,
          sub: 'user-1',
          iat: now(),
          jti: crypto.randomUUID(),
          events: { [BACKCHANNEL_LOGOUT_EVENT]: {} },
          ...claims,
        },
        { typ: 'logout+jwt', ...header },
      )
    },
    async rotateKey() {
      key = await createSigningKey(algorithm)
    },
    install() {
      const previous = globalThis.fetch
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        const endpoint = endpointOf(request.url)
        if (endpoint === null) return previous(input, init)
        const text = request.method === 'POST' ? await request.clone().text() : null
        idp.requests.push({
          url: request.url,
          method: request.method,
          headers: request.headers,
          body: text === null ? null : new URLSearchParams(text),
        })
        const override = idp.respond[endpoint]
        if (override) {
          const response = await override(request)
          // A real fetch follows a 3xx unless the caller asked for 'manual'; mimic that so a
          // dropped `redirect: 'manual'` lands on the redirect target's 200 body.
          if (request.redirect !== 'manual' && REDIRECT_STATUSES.has(response.status)) {
            return json({ followed: response.headers.get('location') })
          }
          return response
        }
        if (endpoint === 'discovery') return json(idp.discovery)
        if (endpoint === 'jwks') return json({ keys: key.publicJwk ? [key.publicJwk] : [] })
        return tokenEndpoint(request.headers, new URLSearchParams(text ?? ''))
      })
      return () => {
        vi.stubGlobal('fetch', previous)
      }
    },
  }

  function endpointOf(url: string): Endpoint | null {
    if (url === urls.discovery) return 'discovery'
    if (url === urls.jwks) return 'jwks'
    if (url === urls.token) return 'token'
    return null
  }

  function clientAuthenticated(headers: Headers, body: URLSearchParams): boolean {
    const methods = idp.discovery.token_endpoint_auth_methods_supported
    const postOnly =
      Array.isArray(methods) &&
      !methods.includes('client_secret_basic') &&
      methods.includes('client_secret_post')
    if (postOnly) {
      return (
        headers.get('authorization') === null &&
        body.get('client_id') === clientId &&
        body.get('client_secret') === clientSecret
      )
    }
    const expected = `Basic ${btoa(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`)}`
    return headers.get('authorization') === expected && !body.has('client_secret')
  }

  async function tokens(claims: Record<string, unknown>, nonce?: string): Promise<Response> {
    const refreshToken = randomToken()
    refreshTokens.set(refreshToken, claims)
    return json({
      access_token: randomToken(),
      token_type: 'Bearer',
      expires_in: 300,
      refresh_token: refreshToken,
      id_token: await idp.signIdToken({ ...claims, nonce }),
    })
  }

  async function tokenEndpoint(headers: Headers, body: URLSearchParams): Promise<Response> {
    if (!clientAuthenticated(headers, body)) return json({ error: 'invalid_client' }, 401)
    const grantType = body.get('grant_type')
    if (grantType === 'authorization_code') {
      const stored = codes.get(body.get('code') ?? '')
      codes.delete(body.get('code') ?? '')
      const verifier = body.get('code_verifier')
      if (
        !stored ||
        verifier === null ||
        (await s256(verifier)) !== stored.codeChallenge ||
        body.get('redirect_uri') !== stored.redirectURI
      ) {
        return json({ error: 'invalid_grant' }, 400)
      }
      return tokens(stored.claims, stored.nonce)
    }
    if (grantType === 'refresh_token') {
      const presented = body.get('refresh_token') ?? ''
      const claims = refreshTokens.get(presented)
      if (!claims) return json({ error: 'invalid_grant' }, 400)
      refreshTokens.delete(presented)
      return tokens(claims)
    }
    return json({ error: 'unsupported_grant_type' }, 400)
  }

  return idp
}
