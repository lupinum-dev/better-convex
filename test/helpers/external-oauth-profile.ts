import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose'

import type {
  McpAccessVerifier,
  McpVerificationExpectation,
  VerifiedMcpAccess,
} from '../../packages/mcp/src/index'

export interface ExternalOAuthVerifierOptions {
  readonly allowedScopes: readonly string[]
  readonly discoveryUrl: URL
  readonly fetch: typeof fetch
  readonly issuer: string
  readonly maxLifetimeSeconds: number
  readonly now?: () => number
}

export async function discoverExternalOAuthVerifier(
  options: ExternalOAuthVerifierOptions,
): Promise<McpAccessVerifier> {
  const issuer = canonicalHttpsUrl(options.issuer, false)
  const discoveryUrl = canonicalHttpsUrl(options.discoveryUrl.href, false)
  const maximumLifetime = options.maxLifetimeSeconds
  if (!Number.isSafeInteger(maximumLifetime) || maximumLifetime <= 0) invalid()
  const allowedScopes = new Set(options.allowedScopes)
  if (
    allowedScopes.size !== options.allowedScopes.length ||
    [...allowedScopes].some((scope) => !safeScope(scope))
  ) {
    invalid()
  }

  const metadataResponse = await options.fetch(discoveryUrl, {
    headers: { accept: 'application/json' },
    method: 'GET',
    redirect: 'error',
  })
  if (!metadataResponse.ok || !isJson(metadataResponse.headers.get('content-type'))) invalid()
  const metadata = await metadataResponse.json()
  if (!isRecord(metadata) || metadata.issuer !== issuer || typeof metadata.jwks_uri !== 'string') {
    invalid()
  }
  const jwksUrl = new URL(canonicalHttpsUrl(metadata.jwks_uri, false))
  const keys = createRemoteJWKSet(jwksUrl, {
    [customFetch]: async (url, init) => {
      if (url !== jwksUrl.href) invalid()
      return await options.fetch(url, init)
    },
    cooldownDuration: 0,
    timeoutDuration: 1_000,
  })

  return Object.freeze({
    async verifyAccessToken(
      token: string,
      expected: McpVerificationExpectation,
    ): Promise<VerifiedMcpAccess> {
      if (expected.issuer !== issuer) invalid()
      const resource = canonicalHttpsUrl(expected.resource.href, true)
      const now = options.now?.() ?? Date.now() / 1_000
      if (!Number.isSafeInteger(now)) invalid()
      const { payload, protectedHeader } = await jwtVerify(token, keys, {
        algorithms: ['RS256'],
        audience: resource,
        clockTolerance: 0,
        currentDate: new Date(now * 1_000),
        issuer,
        requiredClaims: ['sub', 'client_id', 'iat', 'jti'],
        typ: 'at+jwt',
      })
      if (
        protectedHeader.alg !== 'RS256' ||
        payload.aud !== resource ||
        typeof payload.sub !== 'string' ||
        !safeIdentity(payload.sub) ||
        typeof payload.client_id !== 'string' ||
        !safeIdentity(payload.client_id) ||
        !Number.isSafeInteger(payload.iat) ||
        !Number.isSafeInteger(payload.exp) ||
        (payload.iat as number) > now ||
        (payload.exp as number) <= (payload.iat as number) ||
        (payload.exp as number) - (payload.iat as number) > maximumLifetime ||
        typeof payload.scope !== 'string'
      ) {
        invalid()
      }
      const scopes = payload.scope.split(' ')
      if (
        scopes.length === 0 ||
        new Set(scopes).size !== scopes.length ||
        scopes.some((scope) => !allowedScopes.has(scope))
      ) {
        invalid()
      }
      return Object.freeze({
        access: Object.freeze({
          issuer,
          subject: payload.sub,
          clientId: payload.client_id,
          resource,
          scopes: Object.freeze(scopes),
        }),
        expiresAt: payload.exp as number,
      })
    },
  })
}

function canonicalHttpsUrl(value: string, allowQuery: boolean): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    invalid()
  }
  if (
    url.href !== value ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    (!allowQuery && url.search)
  ) {
    invalid()
  }
  return value
}

function isJson(value: string | null): boolean {
  return value?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function safeIdentity(value: string): boolean {
  return value.length > 0 && value.length <= 512 && value.trim() === value && !hasUnsafeText(value)
}

function safeScope(value: string): boolean {
  if (value.length === 0 || value.length > 256) return false
  for (const character of value) {
    const codePoint = character.codePointAt(0)!
    if (codePoint < 33 || codePoint > 126 || codePoint === 34 || codePoint === 92) return false
  }
  return true
}

function hasUnsafeText(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!
    if (codePoint <= 31 || codePoint === 127) return true
  }
  return false
}

function invalid(): never {
  throw new Error('External OAuth access validation failed')
}
