import { describe, expect, it } from 'vitest'

import {
  closeOAuthCodeResources,
  inspectTokenResponse,
  runExternalAuthorizationCodeRace,
} from '../../scripts/run-oauth-code-concurrency.mjs'

const origin = 'http://localhost:3050'
const resource = `${origin}/mcp`
const clientId = 'public-client'

function encoded(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function accessToken(overrides: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000)
  return [
    encoded({ alg: 'RS256', typ: 'at+jwt' }),
    encoded({
      aud: resource,
      azp: clientId,
      client_id: clientId,
      exp: now + 600,
      iat: now,
      iss: `${origin}/api/auth`,
      jti: 'access-token-id',
      scope: 'mcp:read mcp:write',
      sid: 'session-id',
      sub: 'user-id',
      token_use: 'oauth-access',
      ...overrides,
    }),
    'signature',
  ].join('.')
}

describe('OAuth authorization-code worker result projection', () => {
  it('reports only a correctly bound access-token response as success', () => {
    expect(
      inspectTokenResponse(
        200,
        {
          access_token: accessToken(),
          expires_in: 600,
          scope: 'mcp:read mcp:write',
          token_type: 'Bearer',
        },
        { clientId, origin, resource },
      ),
    ).toEqual({ credentialFree: false, error: undefined, status: 200, success: true })

    expect(
      inspectTokenResponse(
        200,
        {
          access_token: accessToken({ aud: `${origin}/wrong-resource` }),
          expires_in: 600,
          scope: 'mcp:read mcp:write',
          token_type: 'Bearer',
        },
        { clientId, origin, resource },
      ).success,
    ).toBe(false)
  })

  it('requires failures to remain credential-free, including nested values', () => {
    expect(
      inspectTokenResponse(400, { error: 'invalid_grant' }, { clientId, origin, resource }),
    ).toEqual({ credentialFree: true, error: 'invalid_grant', status: 400, success: false })

    const leaked = inspectTokenResponse(
      400,
      { error: 'invalid_grant', metadata: { leaked: accessToken() } },
      { clientId, origin, resource },
    )
    expect(leaked.credentialFree).toBe(false)
    expect(leaked.success).toBe(false)
  })

  it('rejects refresh and ID tokens even beside a valid access token', () => {
    const result = inspectTokenResponse(
      200,
      {
        access_token: accessToken(),
        expires_in: 600,
        id_token: 'forbidden-id-token',
        refresh_token: 'forbidden-refresh-token',
        scope: 'mcp:read mcp:write',
        token_type: 'Bearer',
      },
      { clientId, origin, resource },
    )
    expect(result.success).toBe(false)
    expect(result.credentialFree).toBe(false)
  })

  it('rejects external fixture credentials before any browser work unless the origin is HTTPS', async () => {
    await expect(
      runExternalAuthorizationCodeRace({
        email: 'staging@example.test',
        ingressLease: 'a'.repeat(43),
        origin: 'http://staging.example.test',
        password: 'correct horse battery staple',
      }),
    ).rejects.toThrow('OAUTH_CODE_EXTERNAL_ORIGIN_INVALID')

    await expect(
      runExternalAuthorizationCodeRace({
        email: 'staging@example.test',
        ingressLease: 'a'.repeat(43),
        origin: 'https://staging.example.test/unexpected-path',
        password: 'correct horse battery staple',
      }),
    ).rejects.toThrow('OAUTH_CODE_EXTERNAL_ORIGIN_INVALID')

    await expect(
      runExternalAuthorizationCodeRace({
        email: 'staging@example.test',
        ingressLease: 'too-short',
        origin: 'https://staging.example.test',
        password: 'correct horse battery staple',
      }),
    ).rejects.toThrow('OAUTH_CODE_EXTERNAL_INGRESS_LEASE_INVALID')
  })

  it('attempts every teardown step and fails closed without exposing teardown errors', async () => {
    const attempted: string[] = []
    await expect(
      closeOAuthCodeResources([
        async () => {
          attempted.push('context')
          throw new Error('secret-bearing teardown failure')
        },
        async () => {
          attempted.push('browser')
        },
        undefined,
        async () => {
          attempted.push('callback')
          throw new Error('another private failure')
        },
      ]),
    ).rejects.toThrow('OAUTH_CODE_CLEANUP_FAILED')
    expect(attempted).toEqual(['context', 'browser', 'callback'])
  })
})
