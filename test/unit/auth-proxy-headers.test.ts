import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildAuthProxyForwardHeaders,
  isSupportedProxyResponseContentEncoding,
  shouldSkipProxyResponseHeader,
} from '../../src/runtime/server/api/auth/headers'
import { verifySignedPublicOrigin } from '../../src/runtime/shared/client-ip'

const PROXY_IP_SECRET = 'proxy-ip-test-secret-with-32-bytes'

describe('auth proxy header helpers', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('strips hop-by-hop headers and preserves useful headers', async () => {
    const event = {
      headers: new Headers({
        host: 'app.example.com',
        cookie:
          'a=1; not-better-auth=secret; better-auth.session_token=session; __Secure-better-auth.callback=state',
        origin: 'https://app.example.com',
        referer: 'https://app.example.com/account',
        'sec-fetch-site': 'same-origin',
        accept: 'application/json',
        'accept-encoding': 'unknown',
        connection: 'keep-alive, x-hop',
        'content-encoding': 'gzip',
        expect: '100-continue',
        'proxy-connection': 'keep-alive',
        'transfer-encoding': 'chunked',
        'x-hop': 'must-not-forward',
      }),
    } as never

    const headers = await buildAuthProxyForwardHeaders(event, {
      publicOrigin: 'https://app.example.test',
    })

    expect(headers.cookie).toBe(
      'better-auth.session_token=session; __Secure-better-auth.callback=state',
    )
    expect(headers.cookie).not.toContain('a=1')
    expect(headers.cookie).not.toContain('not-better-auth')
    expect(headers.accept).toBe('application/json')
    expect(headers.origin).toBe('https://app.example.com')
    expect(headers.referer).toBe('https://app.example.com/account')
    expect(headers['sec-fetch-site']).toBe('same-origin')
    expect(headers.connection).toBeUndefined()
    expect(headers['accept-encoding']).toBeUndefined()
    expect(headers['content-encoding']).toBeUndefined()
    expect(headers.expect).toBeUndefined()
    expect(headers['proxy-connection']).toBeUndefined()
    expect(headers['transfer-encoding']).toBeUndefined()
    expect(headers['x-hop']).toBeUndefined()
    expect(headers.host).toBeUndefined()
  })

  it('drops unowned host, protocol, client-IP, platform, and Better Auth proxy controls', async () => {
    const event = {
      headers: new Headers({
        forwarded: 'for=10.0.0.1;host=evil.test;proto=http',
        'x-better-auth-forwarded-host': 'evil.test',
        'x-better-auth-forwarded-proto': 'http',
        'x-bcn-client-ip': '10.0.0.5',
        'x-bcn-client-ip-signature': 'attacker-signature',
        'x-bcn-verified-client-ip': '10.0.0.6',
        'x-bcn-future-internal-control': 'attacker-value',
        'x-bcn-public-origin': 'https://evil.test',
        'x-bcn-public-origin-signature': 'attacker-signature',
        'x-forwarded-for': '10.0.0.1',
        'x-forwarded-host': 'evil.test',
        'x-forwarded-proto': 'http',
        'x-real-ip': '10.0.0.2',
        'x-original-host': 'evil.test',
        'x-original-proto': 'http',
        'x-vercel-forwarded-host': 'evil.test',
        'cf-connecting-ip': '10.0.0.3',
        'true-client-ip': '10.0.0.4',
        'cloudfront-forwarded-proto': 'http',
        'cf-visitor': '{"scheme":"http"}',
        'front-end-https': 'off',
        'x-envoy-external-address': '10.0.0.7',
        'x-url-scheme': 'http',
        'x-scheme': 'http',
        'x-arr-ssl': 'insecure',
      }),
    } as never
    vi.stubEnv('BCN_AUTH_PROXY_IP_SECRET', PROXY_IP_SECRET)
    const headers = await buildAuthProxyForwardHeaders(event, {
      publicOrigin: 'https://app.example.test',
    })

    // Only the proxy's own signed origin pair remains.
    expect(Object.keys(headers).sort()).toEqual([
      'x-bcn-public-origin',
      'x-bcn-public-origin-signature',
    ])
    expect(headers['x-bcn-public-origin']).toBe('https://app.example.test')
    await expect(
      verifySignedPublicOrigin(
        headers['x-bcn-public-origin']!,
        headers['x-bcn-public-origin-signature']!,
        PROXY_IP_SECRET,
      ),
    ).resolves.toBe('https://app.example.test')
  })

  it('sends no origin pair without the proxy secret (loopback development)', async () => {
    vi.stubEnv('BCN_AUTH_PROXY_IP_SECRET', '')
    const headers = await buildAuthProxyForwardHeaders({ headers: new Headers() } as never, {
      publicOrigin: 'http://localhost:3000',
    })
    expect(headers).toEqual({})
  })

  it('skips unsafe proxy response headers', () => {
    for (const header of [
      'set-cookie',
      'Access-Control-Allow-Origin',
      'Access-Control-Allow-Credentials',
      'Access-Control-Allow-Headers',
      'Access-Control-Allow-Methods',
      'Access-Control-Expose-Headers',
      'Access-Control-Max-Age',
      'Content-Length',
      'connection',
      'keep-alive',
      'proxy-authenticate',
      'trailer',
      'Cache-Control',
      'Expires',
      'Surrogate-Control',
      'CDN-Cache-Control',
      'Vercel-CDN-Cache-Control',
      'Cloudflare-CDN-Cache-Control',
      'Netlify-CDN-Cache-Control',
      'Edge-Control',
      'X-Accel-Expires',
      'Forwarded',
      'X-Forwarded-Host',
      'X-Better-Auth-Forwarded-Proto',
      'X-BCN-Client-IP-Signature',
      'X-BCN-Verified-Client-IP',
      'CF-Visitor',
    ]) {
      expect(shouldSkipProxyResponseHeader(header), header).toBe(true)
    }
    expect(shouldSkipProxyResponseHeader('x-hop', 'keep-alive, X-Hop')).toBe(true)
    expect(shouldSkipProxyResponseHeader('content-type')).toBe(false)
  })

  it('accepts only encodings that the pinned Node fetch transparently decodes', () => {
    for (const value of [null, 'gzip', 'deflate', 'br', 'x-gzip', 'identity', 'gzip, br']) {
      expect(isSupportedProxyResponseContentEncoding(value), String(value)).toBe(true)
    }
    for (const value of [
      '',
      'compress',
      'zstd',
      'gzip, unknown',
      'identity, gzip',
      'gzip, identity',
      ',',
    ]) {
      expect(isSupportedProxyResponseContentEncoding(value), value).toBe(false)
    }
  })
})
