import { httpRouter } from 'convex/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createAuthComponent } from '../../src/runtime/convex-auth/create-auth-component'
import { buildAuthProxyForwardHeaders } from '../../src/runtime/server/api/auth/headers'
import {
  CLIENT_IP_HEADER,
  CLIENT_IP_SIGNATURE_HEADER,
  VERIFIED_CLIENT_IP_HEADER,
  normalizeClientIp,
  signClientIp,
  verifySignedClientIp,
} from '../../src/runtime/shared/client-ip'

const PROXY_IP_SECRET = 'proxy-ip-route-secret-with-32-bytes'

function actionContext(directClientIp: string | null) {
  const getRequestMetadata = vi.fn(async () => ({
    authToken: null,
    ip: directClientIp,
    requestId: 'request-id',
    scheduledFunctionId: null,
    userAgent: null,
  }))
  return { ctx: { meta: { getRequestMetadata } } as never, getRequestMetadata }
}

async function invokeRegisteredAuthRoute({
  body,
  directClientIp,
  headers,
  method = 'GET',
  failure,
}: {
  body?: string
  directClientIp: string | null
  headers?: HeadersInit
  method?: 'GET' | 'POST'
  failure?: 'config' | 'handler'
}) {
  let handledRequest: Request | undefined
  const component = createAuthComponent({ adapter: {} } as never)
  const http = httpRouter()
  component.registerRoutes(http, async () => ({
    $context:
      failure === 'config' ? Promise.reject(new Error('private-config-cause')) : Promise.resolve(),
    handler: async (request: Request) => {
      if (failure === 'handler') throw new Error('private-handler-cause')
      handledRequest = request
      return new Response(null, { status: 204 })
    },
  }))

  const route = http.lookup('/api/auth/get-session', method)
  if (!route) throw new Error('Auth route was not registered')
  const { ctx, getRequestMetadata } = actionContext(directClientIp)
  const registeredHandler = route[0] as (typeof route)[0] & {
    _handler: (ctx: unknown, request: Request) => Promise<Response>
  }
  const response = await registeredHandler._handler(
    ctx,
    new Request('https://deployment.convex.site/api/auth/get-session?fresh=true', {
      body,
      headers,
      method,
    }),
  )
  return { getRequestMetadata, handledRequest, response }
}

beforeEach(() => {
  vi.stubEnv('SITE_URL', 'https://app.example.test')
  vi.stubEnv('BCN_AUTH_PROXY_IP_SECRET', PROXY_IP_SECRET)
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('authenticated proxy client-IP handoff', () => {
  it.each([
    ['203.0.113.9', '203.0.113.9'],
    ['2001:0DB8:0000:0000:0000:0000:0000:0001', '2001:db8::1'],
    ['::FFFF:192.0.2.128', '::ffff:c000:280'],
  ])('normalizes one IP literal: %s', (input, expected) => {
    expect(normalizeClientIp(input)).toBe(expected)
  })

  it.each([
    '',
    ' 203.0.113.9',
    '203.0.113.9 ',
    '203.0.113.9, 10.0.0.1',
    '203.0.113.9:443',
    '01.2.3.4',
    '256.2.3.4',
    '[2001:db8::1]',
    'fe80::1%eth0',
    'not-an-ip',
  ])('rejects an ambiguous or invalid IP literal: %s', (input) => {
    expect(normalizeClientIp(input)).toBeNull()
  })

  it('strictly verifies the v1 HMAC pair', async () => {
    const signature = await signClientIp('2001:db8::1', PROXY_IP_SECRET)
    await expect(verifySignedClientIp('2001:db8::1', signature, PROXY_IP_SECRET)).resolves.toBe(
      '2001:db8::1',
    )

    for (const [clientIp, candidateSignature, secret] of [
      [null, signature, PROXY_IP_SECRET],
      ['2001:db8::1', null, PROXY_IP_SECRET],
      ['2001:0db8::1', signature, PROXY_IP_SECRET],
      ['2001:db8::2', signature, PROXY_IP_SECRET],
      ['2001:db8::1', `${signature}=`, PROXY_IP_SECRET],
      ['2001:db8::1', signature.slice(1), PROXY_IP_SECRET],
      ['2001:db8::1', `${signature.slice(0, -1)}+`, PROXY_IP_SECRET],
      ['2001:db8::1', 'A'.repeat(1_000), PROXY_IP_SECRET],
      ['2001:db8::1', signature, 'short'],
      ['2001:db8::1', signature, undefined],
    ] as const) {
      await expect(verifySignedClientIp(clientIp, candidateSignature, secret)).resolves.toBeNull()
    }
  })

  it('uses a valid signed proxy IP and exposes only the synthetic Better Auth header', async () => {
    const signature = await signClientIp('203.0.113.9', PROXY_IP_SECRET)

    const result = await invokeRegisteredAuthRoute({
      directClientIp: '198.51.100.7',
      headers: {
        [CLIENT_IP_HEADER]: '203.0.113.9',
        [CLIENT_IP_SIGNATURE_HEADER]: signature,
        [VERIFIED_CLIENT_IP_HEADER]: '192.0.2.250',
        'x-bcn-future-internal': 'attacker-controlled',
        'x-request-context': 'preserved',
      },
    })

    expect(result.response.status).toBe(204)
    expect(result.getRequestMetadata).not.toHaveBeenCalled()
    expect(result.handledRequest?.url).toBe(
      'https://app.example.test/api/auth/get-session?fresh=true',
    )
    expect(result.handledRequest?.headers.get(VERIFIED_CLIENT_IP_HEADER)).toBe('203.0.113.9')
    expect(result.handledRequest?.headers.get(CLIENT_IP_HEADER)).toBeNull()
    expect(result.handledRequest?.headers.get(CLIENT_IP_SIGNATURE_HEADER)).toBeNull()
    expect(result.handledRequest?.headers.get('x-bcn-future-internal')).toBeNull()
    expect(result.handledRequest?.headers.get('x-request-context')).toBe('preserved')
  })

  it('hands a trusted ingress IP from Nitro through Convex to Better Auth end to end', async () => {
    const forwardHeaders = await buildAuthProxyForwardHeaders(
      {
        headers: new Headers({
          'cf-connecting-ip': '2001:0DB8:0000:0000:0000:0000:0000:0001',
          [CLIENT_IP_HEADER]: '192.0.2.250',
          [CLIENT_IP_SIGNATURE_HEADER]: 'forged-by-caller',
          [VERIFIED_CLIENT_IP_HEADER]: '192.0.2.251',
        }),
      } as never,
      {
        publicOrigin: 'https://app.example.test',
        trustedClientIpHeader: 'cf-connecting-ip',
      },
    )

    const result = await invokeRegisteredAuthRoute({
      directClientIp: '198.51.100.7',
      headers: forwardHeaders,
    })

    expect(result.response.status).toBe(204)
    expect(result.getRequestMetadata).not.toHaveBeenCalled()
    expect(result.handledRequest?.headers.get(VERIFIED_CLIENT_IP_HEADER)).toBe('2001:db8::1')
    expect(result.handledRequest?.headers.get(CLIENT_IP_HEADER)).toBeNull()
    expect(result.handledRequest?.headers.get(CLIENT_IP_SIGNATURE_HEADER)).toBeNull()
  })

  it('preserves a POST body while replacing the internal header namespace', async () => {
    const result = await invokeRegisteredAuthRoute({
      body: '{"email":"agent@example.test"}',
      directClientIp: '198.51.100.7',
      headers: {
        'content-type': 'application/json',
        [VERIFIED_CLIENT_IP_HEADER]: '203.0.113.9',
      },
      method: 'POST',
    })

    expect(result.response.status).toBe(204)
    expect(result.handledRequest?.method).toBe('POST')
    await expect(result.handledRequest?.text()).resolves.toBe('{"email":"agent@example.test"}')
    expect(result.handledRequest?.headers.get(VERIFIED_CLIENT_IP_HEADER)).toBe('198.51.100.7')
  })

  const forge = (signature: string) => `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`
  it.each([
    [
      'a forged pair',
      PROXY_IP_SECRET,
      (signature: string) => ({
        [CLIENT_IP_HEADER]: '203.0.113.9',
        [CLIENT_IP_SIGNATURE_HEADER]: forge(signature),
        [VERIFIED_CLIENT_IP_HEADER]: '192.0.2.250',
      }),
    ],
    [
      'drifted Nuxt and Convex secrets',
      `${PROXY_IP_SECRET}-different`,
      (signature: string) => ({
        [CLIENT_IP_HEADER]: '203.0.113.9',
        [CLIENT_IP_SIGNATURE_HEADER]: signature,
      }),
    ],
    ['an IP without a signature', PROXY_IP_SECRET, () => ({ [CLIENT_IP_HEADER]: '203.0.113.9' })],
    [
      'a signature without an IP',
      PROXY_IP_SECRET,
      () => ({ [CLIENT_IP_SIGNATURE_HEADER]: 'A'.repeat(43) }),
    ],
    [
      'an oversized signature',
      PROXY_IP_SECRET,
      () => ({
        [CLIENT_IP_HEADER]: '203.0.113.9',
        [CLIENT_IP_SIGNATURE_HEADER]: 'A'.repeat(2_000),
      }),
    ],
    [
      'a duplicated IP',
      PROXY_IP_SECRET,
      () => ({
        [CLIENT_IP_HEADER]: '203.0.113.9, 198.51.100.4',
        [CLIENT_IP_SIGNATURE_HEADER]: 'A'.repeat(43),
      }),
    ],
  ] as const)(
    'fails closed on %s instead of collapsing to the direct caller',
    async (_case, convexSecret, headers) => {
      const signature = await signClientIp('203.0.113.9', PROXY_IP_SECRET)
      vi.stubEnv('BCN_AUTH_PROXY_IP_SECRET', convexSecret)

      const result = await invokeRegisteredAuthRoute({
        directClientIp: '198.51.100.7',
        headers: headers(signature),
      })

      expect(result.response.status).toBe(500)
      expect(result.getRequestMetadata).not.toHaveBeenCalled()
      expect(result.handledRequest).toBeUndefined()
      await expect(result.response.json()).resolves.toEqual({
        code: 'AUTH_REQUEST_METADATA_INVALID',
      })
    },
  )

  it('fails closed when trusted Convex request metadata lacks a valid IP', async () => {
    const result = await invokeRegisteredAuthRoute({
      directClientIp: 'not-an-ip',
      headers: { [VERIFIED_CLIENT_IP_HEADER]: '203.0.113.9' },
    })

    expect(result.response.status).toBe(500)
    expect(result.getRequestMetadata).toHaveBeenCalledOnce()
    expect(result.handledRequest).toBeUndefined()
    await expect(result.response.json()).resolves.toEqual({
      code: 'AUTH_REQUEST_METADATA_INVALID',
    })
  })

  it.each([
    ['config', 'AUTH_CONFIG_INVALID'],
    ['handler', 'AUTH_HANDLER_FAILED'],
  ] as const)('classifies %s failures without exposing their causes', async (failure, code) => {
    const result = await invokeRegisteredAuthRoute({
      directClientIp: '198.51.100.7',
      failure,
    })

    expect(result.response.status).toBe(500)
    const body = await result.response.text()
    expect(JSON.parse(body)).toEqual({ code })
    expect(body).not.toContain('private-')
  })
})
