import { describe, expect, it, vi } from 'vitest'

import { verifyOAuthBearerToken } from '../../src/runtime/convex-auth/oauth-resource'
import {
  assertOAuthAccessTokenClaims,
  assertSingleParameters,
  parseBoundedFormRequest,
  requireSingleParameter,
  validateOAuthRedirectUris,
} from '../../src/runtime/convex-auth/oauth-security'
import {
  AMBIGUOUS_UNKNOWN_FORM_FIELDS,
  HOSTILE_REDIRECT_URIS,
  MALFORMED_BEARER_TOKENS,
  OAUTH_SINGLETON_FIELDS,
} from './regression-corpus'
import { runSeededAuthCorpus } from './seeded'

const ISSUER = 'https://app.example.test/api/auth'
const RESOURCE = 'https://app.example.test/mcp'
const ALLOWED_FIELDS = [...OAUTH_SINGLETON_FIELDS]

function encodedFieldName(field: string, index: number): string {
  const offset = index % field.length
  const character = field.charCodeAt(offset).toString(16).padStart(2, '0')
  return `${field.slice(0, offset)}%${character}${field.slice(offset + 1)}`
}

function formRequest(body: string, headers: HeadersInit = {}): Request {
  return new Request(`${ISSUER}/oauth2/token`, {
    body,
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    method: 'POST',
  })
}

function tokenClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    aud: RESOURCE,
    azp: 'client-1',
    client_id: 'client-1',
    exp: 1_600,
    iat: 1_000,
    iss: ISSUER,
    jti: 'token-1',
    scope: 'mcp:read mcp:write',
    sid: 'session-1',
    sub: 'user-1',
    token_use: 'oauth-access',
    ...overrides,
  }
}

describe('seeded OAuth HTTP input corpus', () => {
  it('rejects duplicate query and form singleton fields after percent decoding', async () => {
    await runSeededAuthCorpus('oauth-duplicate-parameters', 96, async (random, caseIndex) => {
      const field = random.pick(OAUTH_SINGLETON_FIELDS)
      const duplicateName = encodedFieldName(field, caseIndex)
      const body = `${field}=first&${duplicateName}=second`
      await expect(parseBoundedFormRequest(formRequest(body), ALLOWED_FIELDS)).rejects.toThrow(
        'AUTH_OAUTH_REQUEST_INVALID',
      )

      const query = new URL(`${ISSUER}/oauth2/authorize?${body}`).searchParams
      expect(query.getAll(field)).toEqual(['first', 'second'])
      expect(() => assertSingleParameters(query, ALLOWED_FIELDS)).toThrow(
        'AUTH_OAUTH_REQUEST_INVALID',
      )
    })
  })

  it('rejects unknown ambiguous field encodings while preserving encoded separators as data', async () => {
    for (const field of AMBIGUOUS_UNKNOWN_FORM_FIELDS) {
      await expect(
        parseBoundedFormRequest(formRequest(`${field}=attacker`), ALLOWED_FIELDS),
        field,
      ).rejects.toThrow('AUTH_OAUTH_REQUEST_INVALID')
    }

    await runSeededAuthCorpus('oauth-ambiguous-encoding', 64, async (random) => {
      const nestedField = random.pick(['resource', 'client_id', 'code', 'scope'])
      const nestedValue = `${random.nextUint32().toString(36)}&${nestedField}=injected`
      const parsed = await parseBoundedFormRequest(
        formRequest(`resource=${encodeURIComponent(nestedValue)}`),
        ALLOWED_FIELDS,
      )
      expect(parsed.getAll('resource')).toEqual([nestedValue])
      expect(() => requireSingleParameter(parsed, 'resource')).not.toThrow()
      expect([...parsed.keys()]).toEqual(['resource'])
    })
  })

  it('enforces exact body bytes and rejects false Content-Length syntax', async () => {
    await runSeededAuthCorpus('oauth-form-size', 48, async (random) => {
      const maxBytes = 32 + random.integer(224)
      const prefix = 'code='
      const exactBody = `${prefix}${'a'.repeat(maxBytes - prefix.length)}`
      await expect(
        parseBoundedFormRequest(formRequest(exactBody), ['code'], maxBytes),
      ).resolves.toBeInstanceOf(URLSearchParams)
      await expect(
        parseBoundedFormRequest(formRequest(`${exactBody}a`), ['code'], maxBytes),
      ).rejects.toThrow('AUTH_OAUTH_REQUEST_INVALID')

      const malformedLength = random.pick(['-1', '1.5', 'NaN', 'Infinity', `${maxBytes}junk`])
      await expect(
        parseBoundedFormRequest(
          formRequest('code=a', { 'content-length': malformedLength }),
          ['code'],
          maxBytes,
        ),
      ).rejects.toThrow('AUTH_OAUTH_REQUEST_INVALID')
    })
  })

  it('rejects unsafe redirect URI variants', async () => {
    for (const redirectUri of HOSTILE_REDIRECT_URIS) {
      expect(() => validateOAuthRedirectUris([redirectUri]), redirectUri).toThrow(
        'AUTH_OAUTH_CONFIG_INVALID',
      )
    }

    await runSeededAuthCorpus('oauth-redirect', 64, (random) => {
      const label = random.nextUint32().toString(36)
      for (const redirectUri of [
        `https://*.${label}.example.test/callback`,
        `http://${label}.example.test/callback`,
        `https://${label}.example.test/callback#fragment`,
      ]) {
        expect(() => validateOAuthRedirectUris([redirectUri])).toThrow('AUTH_OAUTH_CONFIG_INVALID')
      }
    })
  })

  it('rejects malformed bearer syntax before any JWKS transport is possible', async () => {
    const verifyOptions = {
      allowedScopes: ['mcp:read'],
      audience: RESOURCE,
      issuer: ISSUER,
      jwksUrl: `${ISSUER}/jwks`,
    }
    for (const token of MALFORMED_BEARER_TOKENS) {
      await expect(verifyOAuthBearerToken(token, verifyOptions), token).rejects.toThrow(
        'AUTH_OAUTH_TOKEN_INVALID',
      )
    }

    await runSeededAuthCorpus('oauth-malformed-bearer', 48, async (random) => {
      const payload = btoa(`not-json-${random.nextUint32().toString(36)}`)
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replace(/=+$/u, '')
      const token = `header.${payload}.signature`
      await expect(verifyOAuthBearerToken(token, verifyOptions)).rejects.toThrow(
        'AUTH_OAUTH_TOKEN_INVALID',
      )
    })
  })

  it('rejects generated token-class and exact-binding claim drift', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(1_200 * 1_000))
    try {
      await runSeededAuthCorpus('oauth-token-claims', 80, (random) => {
        const mutation = random.pick([
          { aud: `${RESOURCE}/${random.nextUint32().toString(36)}` },
          { azp: 'client-2' },
          { client_id: 'client-2' },
          { scope: 'mcp:read admin' },
          { scope: 'mcp:read  mcp:write' },
          { token_use: 'session' },
        ])
        expect(() =>
          assertOAuthAccessTokenClaims(tokenClaims(mutation), {
            allowedScopes: ['mcp:read', 'mcp:write'],
            audience: RESOURCE,
            clientId: 'client-1',
            issuer: ISSUER,
            requiredScopes: ['mcp:read'],
            subject: 'user-1',
          }),
        ).toThrow('AUTH_OAUTH_TOKEN_INVALID')
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
