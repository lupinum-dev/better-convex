import { describe, expect, it } from 'vitest'

import {
  buildAuthProxyForwardHeaders,
  shouldSkipProxyResponseHeader,
} from '../../src/runtime/server/api/auth/headers'
import { isCrossOriginAuthRequest, isSameOrigin } from '../../src/runtime/server/api/auth/security'
import { HOSTILE_CALLBACK_PATHS, HOSTILE_ORIGINS, PROXY_CONTROL_HEADERS } from './regression-corpus'
import { runSeededAuthCorpus } from './seeded'

const PUBLIC_ORIGIN = 'https://app.example.test'
const CROSS_SITE_POST = new Headers({
  origin: 'https://identity.example.test',
  'sec-fetch-site': 'cross-site',
})

function randomLabel(value: number): string {
  return `fuzz-${value.toString(36)}`
}

describe('seeded auth proxy HTTP input corpus', () => {
  it('never derives the trusted origin from attacker-controlled host or origin syntax', async () => {
    for (const origin of HOSTILE_ORIGINS) {
      expect(isSameOrigin(origin, PUBLIC_ORIGIN), origin).toBe(false)
      expect(
        isCrossOriginAuthRequest(
          new Headers({ host: 'evil.example.test', origin }),
          'POST',
          PUBLIC_ORIGIN,
          '/sign-in/email',
        ),
        origin,
      ).toBe(true)
    }

    await runSeededAuthCorpus('origin-host', 64, (random) => {
      const label = randomLabel(random.nextUint32())
      const canonical = `https://${label}.example.test`
      expect(isSameOrigin(canonical, canonical)).toBe(true)
      for (const candidate of [
        `http://${label}.example.test`,
        `${canonical}.evil.test`,
        `${canonical}/${random.nextUint32().toString(36)}`,
        `https://${label}.example.test:${1024 + random.integer(50_000)}`,
      ]) {
        expect(isSameOrigin(candidate, canonical)).toBe(false)
      }

      const overridden = new Headers({
        host: `${label}.evil.test`,
        origin: `https://${label}.evil.test`,
        'sec-fetch-site': 'cross-site',
        'x-http-method-override': 'GET',
      })
      expect(isCrossOriginAuthRequest(overridden, 'POST', canonical, '/sign-in/email')).toBe(true)
    })
  })

  it('confines the one cross-site provider callback exception to one decoded-safe segment', async () => {
    for (const path of HOSTILE_CALLBACK_PATHS) {
      expect(isCrossOriginAuthRequest(CROSS_SITE_POST, 'POST', PUBLIC_ORIGIN, path), path).toBe(
        true,
      )
    }

    await runSeededAuthCorpus('callback-path', 64, (random) => {
      const safeProvider = randomLabel(random.nextUint32())
      expect(
        isCrossOriginAuthRequest(
          CROSS_SITE_POST,
          'POST',
          PUBLIC_ORIGIN,
          `/callback/${safeProvider}`,
        ),
      ).toBe(false)

      const encodedEscape = random.pick(['%2f', '%5c', '%00', '%0d', '%0a', '%2e%2e'])
      const path =
        encodedEscape === '%2e%2e'
          ? '/callback/%2e%2e'
          : `/callback/${safeProvider}${encodedEscape}${random.nextUint32().toString(36)}`
      expect(isCrossOriginAuthRequest(CROSS_SITE_POST, 'POST', PUBLIC_ORIGIN, path)).toBe(true)
    })
  })

  it('strips generated proxy controls, hop-by-hop nominations, and response controls', async () => {
    for (const name of PROXY_CONTROL_HEADERS) {
      const forwarded = await buildAuthProxyForwardHeaders(
        { headers: new Headers({ [name]: 'attacker-value' }) } as never,
        {},
      )
      expect(forwarded[name], name).toBeUndefined()
      if (name !== 'host') expect(shouldSkipProxyResponseHeader(name), name).toBe(true)
    }

    await runSeededAuthCorpus('proxy-headers', 64, async (random) => {
      const label = randomLabel(random.nextUint32())
      const hop = `x-hop-${label}`
      const names = [
        `x-bcn-${label}`,
        `x-forwarded-${label}`,
        `x-original-${label}`,
        `${label}-client-ip`,
        `${label}-connecting-ip`,
      ]
      const input = new Headers({ connection: `keep-alive, ${hop}`, [hop]: 'attacker-value' })
      for (const name of names) input.set(name, 'attacker-value')
      const forwarded = await buildAuthProxyForwardHeaders({ headers: input } as never, {})

      expect(forwarded[hop]).toBeUndefined()
      for (const name of names) {
        expect(forwarded[name]).toBeUndefined()
        expect(shouldSkipProxyResponseHeader(name)).toBe(true)
      }
    })
  })
})
