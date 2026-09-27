// OAuth endpoint quotas across both transports (the Nuxt proxy and direct Convex
// HTTP), disabled OAuth surface, and hardened login/consent pages, on the MCP starter.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { startMcpFixture, type McpFixture } from './harness'

const TRUSTED_IP_HEADER = 'x-fixture-client-ip'

interface QuotaProfile {
  name: 'authorize' | 'revoke' | 'token'
  path: string
  limit: number
  /** Status of a request the endpoint rejects on its own, before the quota is exhausted. */
  guardStatus: number
}

const profiles: QuotaProfile[] = [
  { name: 'authorize', path: '/api/auth/oauth2/authorize', limit: 30, guardStatus: 400 },
  { name: 'token', path: '/api/auth/oauth2/token', limit: 20, guardStatus: 401 },
  { name: 'revoke', path: '/api/auth/oauth2/revoke', limit: 30, guardStatus: 401 },
]
const windowSeconds = 60
const primaryIp = { authorize: '198.51.100.41', revoke: '203.0.113.41', token: '192.0.2.41' }
const secondaryIp = { authorize: '198.51.100.42', revoke: '203.0.113.42', token: '192.0.2.42' }

const disabledRoutes = [
  ['POST', '/api/auth/token'],
  ['POST', '/api/auth/get-access-token'],
  ['POST', '/api/auth/refresh-token'],
  ['GET', '/api/auth/.well-known/openid-configuration'],
  ['POST', '/api/auth/oauth2/register'],
  ['POST', '/api/auth/oauth2/introspect'],
  ['POST', '/api/auth/oauth2/userinfo'],
  ['POST', '/api/auth/oauth2/end-session'],
] as const

interface QuotaResult {
  status: number
  retryAfter: number | null
}

/** A request the endpoint rejects on its own, so only its rate-limit step persists state. */
async function quotaRequest(
  profile: QuotaProfile,
  baseUrl: string,
  origin: string,
  headers: Record<string, string>,
): Promise<QuotaResult> {
  const url = new URL(profile.path, baseUrl)
  const init: RequestInit = { headers: { ...headers, origin }, method: 'GET', redirect: 'manual' }
  if (profile.name === 'authorize') {
    const parameters = new URLSearchParams({
      client_id: 'lookup-must-not-run',
      code_challenge: 'A'.repeat(43),
      code_challenge_method: 'S256',
      redirect_uri: 'http://127.0.0.1:3334/oauth/callback#fragment-not-allowed',
      resource: `${origin}/mcp`,
      response_type: 'code',
      scope: 'mcp:read',
      state: 'quota-boundary',
    })
    parameters.append('resource', `${origin}/mcp`)
    url.search = parameters.toString()
  } else {
    init.method = 'POST'
    init.headers = {
      ...init.headers,
      authorization: `Basic ${Buffer.from('lookup-must-not-run:invalid').toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    }
    init.body = new URLSearchParams(
      profile.name === 'token'
        ? {
            client_id: 'lookup-must-not-run',
            code: 'not-an-authorization-code',
            code_verifier: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~',
            grant_type: 'authorization_code',
            redirect_uri: 'http://127.0.0.1:3334/oauth/callback',
            resource: `${origin}/mcp`,
          }
        : {
            client_id: 'lookup-must-not-run',
            token: 'not-an-access-token',
            token_type_hint: 'access_token',
          },
    ).toString()
  }
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) })
  await response.body?.cancel().catch(() => {})
  const retryAfter = response.headers.get('x-retry-after')
  return {
    status: response.status,
    retryAfter: retryAfter !== null && /^\d{1,3}$/u.test(retryAfter) ? Number(retryAfter) : null,
  }
}

const guarded = (profile: QuotaProfile) => ({ status: profile.guardStatus, retryAfter: null })
const isThrottled = (result: QuotaResult) =>
  result.status === 429 &&
  result.retryAfter !== null &&
  result.retryAfter > 0 &&
  result.retryAfter <= windowSeconds

describe('OAuth transport quotas on the MCP starter', () => {
  let fixture: McpFixture

  beforeAll(async () => {
    fixture = await startMcpFixture({ trustedClientIpHeader: TRUSTED_IP_HEADER })
  })

  afterAll(async () => {
    await fixture?.release()
  })

  const send = async (profile: QuotaProfile, transport: 'nuxt' | 'direct', ip: string) =>
    transport === 'nuxt'
      ? quotaRequest(profile, fixture.origin, fixture.origin, { [TRUSTED_IP_HEADER]: ip })
      : quotaRequest(
          profile,
          fixture.convexSiteUrl,
          fixture.origin,
          await fixture.signedClientIpHeaders(ip),
        )

  it('serves no disabled OAuth route on either transport', async () => {
    for (const baseUrl of [fixture.origin, fixture.convexSiteUrl]) {
      for (const [method, path] of disabledRoutes) {
        const headers: Record<string, string> =
          method === 'POST'
            ? { 'content-type': 'application/x-www-form-urlencoded', origin: fixture.origin }
            : {}
        if (baseUrl === fixture.origin) headers[TRUSTED_IP_HEADER] = '198.51.100.250'
        const response = await fetch(new URL(path, baseUrl), {
          body: method === 'POST' ? '' : undefined,
          headers,
          method,
          redirect: 'manual',
        })
        await response.body?.cancel().catch(() => {})
        expect(
          response.status,
          `OAUTH_QUOTA_DISABLED_ROUTE_EXPOSED ${method} ${baseUrl}${path}`,
        ).toBe(404)
      }
    }
  })

  it('serves the login and consent pages uncached and unframeable', async () => {
    for (const path of ['/login', '/oauth/consent']) {
      const response = await fetch(new URL(path, fixture.origin), { redirect: 'manual' })
      await response.body?.cancel().catch(() => {})
      expect(response.status, 'OAUTH_QUOTA_CEREMONY_PAGE_UNAVAILABLE').toBe(200)
      const cacheControl = (response.headers.get('cache-control') ?? '').toLowerCase().split(',')
      expect(
        cacheControl.map((value) => value.trim()),
        'OAUTH_QUOTA_CEREMONY_PAGE_CACHEABLE',
      ).toContain('no-store')
      const csp = (response.headers.get('content-security-policy') ?? '').split(';')
      expect(
        csp.map((value) => value.trim().toLowerCase()),
        'OAUTH_QUOTA_CEREMONY_PAGE_FRAMEABLE',
      ).toContain("frame-ancestors 'none'")
      expect(
        response.headers.get('x-frame-options')?.toUpperCase(),
        'OAUTH_QUOTA_CEREMONY_PAGE_HEADERS_INVALID',
      ).toBe('DENY')
      expect(
        response.headers.get('referrer-policy')?.toLowerCase(),
        'OAUTH_QUOTA_CEREMONY_PAGE_HEADERS_INVALID',
      ).toBe('no-referrer')
    }
  })

  it.each(profiles)(
    'shares one $name quota across both transports per signed client IP',
    async (profile) => {
      const ip = primaryIp[profile.name]
      // Alternate transports up to one below the limit: every request reaches the endpoint's own guard.
      for (let index = 0; index < profile.limit - 1; index += 1) {
        expect(
          await send(profile, index % 2 === 0 ? 'nuxt' : 'direct', ip),
          'OAUTH_QUOTA_LIMIT_TOO_LOW',
        ).toEqual(guarded(profile))
      }
      // Race the last slot from both transports at once: exactly one is admitted.
      const boundary = await Promise.all([send(profile, 'nuxt', ip), send(profile, 'direct', ip)])
      const admitted = boundary.filter(
        (result) => result.status === profile.guardStatus && result.retryAfter === null,
      )
      expect(admitted, 'OAUTH_QUOTA_BOUNDARY_EXCEEDED').toHaveLength(1)
      expect(boundary.filter(isThrottled), 'OAUTH_QUOTA_BOUNDARY_RESULT_INVALID').toHaveLength(1)

      for (const transport of ['nuxt', 'direct'] as const) {
        expect(
          isThrottled(await send(profile, transport, ip)),
          'OAUTH_QUOTA_TRANSPORT_BYPASS',
        ).toBe(true)
      }
      for (const transport of ['nuxt', 'direct'] as const) {
        expect(
          await send(profile, transport, secondaryIp[profile.name]),
          'OAUTH_QUOTA_SIGNED_IP_NOT_INDEPENDENT',
        ).toEqual(guarded(profile))
      }
    },
  )

  it('rejects forged client-IP pairs directly and ignores them behind the proxy', async () => {
    const token = profiles.find((profile) => profile.name === 'token')!
    const forged = 'A'.repeat(43)
    for (const suffix of [1, 2]) {
      expect(
        await quotaRequest(token, fixture.convexSiteUrl, fixture.origin, {
          'x-bcn-client-ip': `10.88.0.${suffix}`,
          'x-bcn-client-ip-signature': forged,
        }),
        'OAUTH_QUOTA_FORGED_DIRECT_PAIR_NOT_REJECTED',
      ).toEqual({ status: 500, retryAfter: null })
    }
    // Behind the proxy the forged pair is replaced; all requests share the trusted ingress IP bucket.
    for (let index = 1; index <= token.limit; index += 1) {
      expect(
        await quotaRequest(token, fixture.origin, fixture.origin, {
          [TRUSTED_IP_HEADER]: '198.51.100.88',
          'x-bcn-client-ip': `10.88.0.${index}`,
          'x-bcn-client-ip-signature': forged,
        }),
        'OAUTH_QUOTA_FORGED_PROXY_HEADER_ESCAPE',
      ).toEqual(guarded(token))
    }
    const overflow = await quotaRequest(token, fixture.origin, fixture.origin, {
      [TRUSTED_IP_HEADER]: '198.51.100.88',
      'x-bcn-client-ip': '10.88.0.202',
      'x-bcn-client-ip-signature': forged,
    })
    expect(isThrottled(overflow), 'OAUTH_QUOTA_FORGED_PROXY_HEADER_ESCAPE').toBe(true)
    expect(
      await quotaRequest(
        token,
        fixture.convexSiteUrl,
        fixture.origin,
        await fixture.signedClientIpHeaders('192.0.2.99'),
      ),
      'OAUTH_QUOTA_FORGED_IP_POISONED_SIGNED_BUCKET',
    ).toEqual(guarded(token))
  })
})
