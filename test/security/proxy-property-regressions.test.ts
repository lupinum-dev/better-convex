import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildAuthProxyForwardHeaders } from '../../src/runtime/server/api/auth/headers'
import { isSameOrigin } from '../../src/runtime/server/api/auth/security'
import { normalizeConvexSiteUrl } from '../../src/runtime/utils/site-url'

const SEED = 1_589_649_446
const PROXY_IP_SECRET = 'proxy-ip-property-secret-32-bytes'

function generator(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return state >>> 0
  }
}

describe('seeded auth proxy security properties', () => {
  beforeEach(() => vi.stubEnv('BCN_AUTH_PROXY_IP_SECRET', PROXY_IP_SECRET))
  afterEach(() => vi.unstubAllEnvs())

  it('never accepts an origin that is not exactly the request origin', () => {
    const next = generator(SEED)
    for (let index = 0; index < 1_000; index += 1) {
      const label = `tenant-${next().toString(36)}`
      const requestOrigin = `https://${label}.example.test`
      expect(isSameOrigin(requestOrigin, requestOrigin), `seed=${SEED} case=${index}`).toBe(true)
      for (const candidate of [
        `${requestOrigin}.evil.test`,
        `${requestOrigin}/path`,
        `${requestOrigin}?query=1`,
        `${requestOrigin}#fragment`,
        `http://${label}.example.test`,
        `https://${label}.example.test.evil.test`,
      ]) {
        expect(isSameOrigin(candidate, requestOrigin), `seed=${SEED} case=${index}`).toBe(false)
      }
    }
  })

  it('accepts only one valid trusted-ingress IP and strips the source header', async () => {
    const next = generator(SEED)
    for (let index = 0; index < 1_000; index += 1) {
      const octets = [next() % 400, next() % 400, next() % 400, next() % 400]
      const candidate = octets.join('.')
      const event = { headers: new Headers({ 'cf-connecting-ip': candidate }) } as never
      const valid = octets.every((octet) => octet <= 255)
      if (valid) {
        const headers = await buildAuthProxyForwardHeaders(event, {
          trustedClientIpHeader: 'cf-connecting-ip',
        })
        expect(headers['x-bcn-client-ip'], `seed=${SEED} case=${index}`).toBe(candidate)
        expect(headers['x-bcn-client-ip-signature'], `seed=${SEED} case=${index}`).toMatch(
          /^[\w-]{43}$/,
        )
        expect(headers['x-forwarded-for']).toBeUndefined()
        expect(headers['cf-connecting-ip']).toBeUndefined()
      } else {
        await expect(
          buildAuthProxyForwardHeaders(event, {
            trustedClientIpHeader: 'cf-connecting-ip',
          }),
          `seed=${SEED} case=${index}`,
        ).rejects.toThrow('exactly one valid IP address')
      }
    }
  })

  it('keeps generated non-loopback HTTP destinations outside the credential boundary', () => {
    const next = generator(SEED)
    for (let index = 0; index < 500; index += 1) {
      const hostname = `host-${next().toString(36)}.example.test`
      expect(
        () => normalizeConvexSiteUrl(`http://${hostname}`),
        `seed=${SEED} case=${index}`,
      ).toThrow(/loopback/)
      expect(normalizeConvexSiteUrl(`https://${hostname}`)).toBe(`https://${hostname}`)
    }
  })
})
