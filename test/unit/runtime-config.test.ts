import { describe, expect, it, vi } from 'vitest'

import {
  normalizeConvexRuntimeConfig,
  toPublicConvexRuntimeConfig,
} from '../../src/runtime/utils/runtime-config'

vi.mock('#imports', () => ({
  useRuntimeConfig: vi.fn(() => ({ public: { convex: {} } })),
}))

describe('runtime config normalization', () => {
  it('keeps auth disabled for an empty config', () => {
    const config = normalizeConvexRuntimeConfig({})
    expect(config.auth).toBe(false)
  })

  it('disables auth entirely when auth is false', () => {
    const config = normalizeConvexRuntimeConfig({ auth: false })
    expect(config.auth).toBe(false)
  })

  it('validates and retains the configured public auth origin', () => {
    const config = normalizeConvexRuntimeConfig({
      auth: {
        origin: 'https://app.example.test/',
        trustedClientIpHeader: 'cf-connecting-ip',
      },
    })
    if (config.auth === false) throw new Error('expected auth enabled')
    expect(config.auth.origin).toBe('https://app.example.test')
  })

  it('projects only application-useful connection origins', () => {
    const internal = normalizeConvexRuntimeConfig({
      url: 'https://example.convex.cloud',
      logging: 'debug',
      auth: false,
    })

    expect(toPublicConvexRuntimeConfig(internal)).toEqual({
      url: 'https://example.convex.cloud',
      siteUrl: 'https://example.convex.site',
    })
  })

  it.each([
    'https://user:pass@example.convex.cloud',
    'https://example.convex.cloud/path',
    'https://example.convex.cloud?target=private',
    'https://example.convex.cloud#fragment',
    'http://example.convex.cloud',
    'file:///tmp/convex',
  ])('rejects unsafe Convex deployment URLs before client construction: %s', (url) => {
    expect(() => normalizeConvexRuntimeConfig({ url })).toThrow()
  })

  it.each([
    ['https://example.convex.cloud/', 'https://example.convex.cloud'],
    ['http://localhost:3210/', 'http://localhost:3210'],
    ['http://[::1]:3210', 'http://[::1]:3210'],
  ])('normalizes exact deployment origin %s', (url, expected) => {
    expect(normalizeConvexRuntimeConfig({ url }).url).toBe(expected)
  })

  it.each(['http://127.42.0.1:3210', 'http://app.localhost:3210', 'http://2130706433:3210'])(
    'rejects a non-exact loopback deployment URL: %s',
    (url) => {
      expect(() => normalizeConvexRuntimeConfig({ url })).toThrow()
    },
  )
})
