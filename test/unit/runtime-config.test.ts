import { describe, expect, it, vi } from 'vitest'

import {
  normalizeConvexRuntimeConfig,
  toPublicConvexRuntimeConfig,
} from '../../src/runtime/utils/runtime-config'

vi.mock('#imports', () => ({
  useRuntimeConfig: vi.fn(() => ({ public: { convex: {} } })),
}))

describe('runtime config normalization', () => {
  it.each([[{}], [{ auth: false }]])('keeps auth disabled for %j', (input) => {
    expect(normalizeConvexRuntimeConfig(input).auth).toBe(false)
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

  it('does not enable retention by default or lose configured keepAlive bounds', () => {
    expect(normalizeConvexRuntimeConfig({}).experimental.keepAlive).toBeUndefined()
    expect(
      normalizeConvexRuntimeConfig({ experimental: { keepAlive: { ms: 60_000, max: 30 } } })
        .experimental.keepAlive,
    ).toEqual({ ms: 60_000, max: 30 })
  })

  it.each([
    null,
    {},
    { ms: '60000', max: 30 },
    { ms: 60_000, max: '30' },
    { ms: 0, max: 30 },
    { ms: 1.5, max: 30 },
    { ms: Infinity, max: 30 },
    { ms: Number.MAX_SAFE_INTEGER + 1, max: 30 },
    { ms: 60_000, max: 0 },
    { ms: 60_000, max: 1.5 },
    { ms: 60_000, max: Infinity },
    { ms: 60_000, max: Number.MAX_SAFE_INTEGER + 1 },
  ])('does not accept invalid keepAlive bounds from runtime config: %j', (keepAlive) => {
    expect(() => normalizeConvexRuntimeConfig({ experimental: { keepAlive } })).toThrow(TypeError)
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

  it('keeps only explicitly configured client options and validated server bounds', () => {
    const config = normalizeConvexRuntimeConfig({
      client: { verbose: true, unsavedChangesWarning: false },
      server: { maxResponseBytes: 2_097_152, queryTimeoutMs: 12_000 },
    })
    expect(config.client).toEqual({ verbose: true, unsavedChangesWarning: false })
    expect(config.server).toEqual({ maxResponseBytes: 2_097_152, queryTimeoutMs: 12_000 })
    expect(toPublicConvexRuntimeConfig(config)).not.toHaveProperty('client')
    expect(toPublicConvexRuntimeConfig(config)).not.toHaveProperty('server')
  })

  it.each([
    [{ client: { verbose: 'true' } }, 'client.verbose must be a boolean'],
    [{ client: { logger: false } }, 'client.logger is not a supported option'],
    [{ client: { webSocketConstructor: 'ws' } }, 'client.webSocketConstructor is not a supported'],
    [{ client: { disabled: true } }, 'client.disabled is not a supported'],
    [{ client: [] }, 'client must be an object'],
    [{ server: { maxResponseBytes: '1048576' } }, 'server.maxResponseBytes must be a positive'],
    [{ server: { maxResponseBytes: 0 } }, 'server.maxResponseBytes must be a positive integer'],
    [{ server: { maxResponseBytes: 1.5 } }, 'server.maxResponseBytes must be a positive integer'],
    [{ server: { queryTimeoutMs: 0 } }, 'server.queryTimeoutMs must be a positive'],
    [{ server: { queryTimeoutMs: Number.POSITIVE_INFINITY } }, 'server.queryTimeoutMs'],
    [{ server: { queryTimeoutMs: 2_147_483_648 } }, 'no greater than 2147483647'],
    [{ server: { timeoutMs: 1 } }, 'server.timeoutMs is not a supported'],
  ])('rejects an invalid transport option: %j', (input, message) => {
    expect(() => normalizeConvexRuntimeConfig(input)).toThrow(message)
  })
})
