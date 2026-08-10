import { describe, expect, it } from 'vitest'

import type { ModuleOptions } from '../../src/module'
import { isConvexAuthEnabled, normalizeConvexAuthConfig } from '../../src/runtime/utils/auth-config'

describe('auth config normalization', () => {
  it('keeps omission and false as Convex-only builds', () => {
    expect(normalizeConvexAuthConfig(undefined)).toBe(false)
    expect(normalizeConvexAuthConfig(false)).toBe(false)
    expect(isConvexAuthEnabled(false)).toBe(false)
  })

  it('requires one explicit canonical application origin to enable auth', () => {
    expect(() => normalizeConvexAuthConfig({})).toThrow('auth.origin')
    expect(() => normalizeConvexAuthConfig({ origin: '' })).toThrow('auth.origin')
    expect(() => normalizeConvexAuthConfig({ origin: 'https://app.example.test/path' })).toThrow()

    const auth = normalizeConvexAuthConfig({
      origin: 'https://app.example.test/',
      trustedClientIpHeader: 'CF-Connecting-IP',
    })
    if (auth === false) throw new Error('expected auth enabled')
    expect(auth).toEqual({
      origin: 'https://app.example.test',
      trustedClientIpHeader: 'cf-connecting-ip',
      redirectTo: '/auth/signin',
    })
    expect(isConvexAuthEnabled(auth)).toBe(true)
  })

  it('normalizes the local redirect and strips the build-only client path', () => {
    const auth = normalizeConvexAuthConfig({
      origin: 'http://localhost:3000',
      client: './convex-auth.ts',
      redirectTo: '/account/login?source=protected',
    })
    if (auth === false) throw new Error('expected auth enabled')
    expect(auth.redirectTo).toBe('/account/login?source=protected')
    expect('client' in auth).toBe(false)
  })

  it.each(['https://evil.example', '//evil.example', '/%2f%2fevil.example', '/bad\\path'])(
    'rejects an unsafe redirect target: %s',
    (redirectTo) => {
      expect(() =>
        normalizeConvexAuthConfig({
          origin: 'http://localhost:3000',
          redirectTo,
        }),
      ).toThrow('safe local application path')
    },
  )

  it('rejects malformed or reserved trusted ingress header names', () => {
    expect(() =>
      normalizeConvexAuthConfig({
        origin: 'https://app.example.test',
        trustedClientIpHeader: 'bad\nheader',
      }),
    ).toThrow('valid HTTP header name')
    expect(() =>
      normalizeConvexAuthConfig({
        origin: 'https://app.example.test',
        trustedClientIpHeader: 'X-BCN-Verified-Client-IP',
      }),
    ).toThrow('reserved x-bcn-* namespace')
  })

  it('requires an ingress-owned client IP header outside exact loopback development', () => {
    for (const origin of ['https://app.example.test', 'https://192.0.2.1']) {
      expect(() => normalizeConvexAuthConfig({ origin })).toThrow(
        'trustedClientIpHeader is required',
      )
    }

    for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000']) {
      const auth = normalizeConvexAuthConfig({ origin })
      if (auth === false) throw new Error('expected auth enabled')
      expect(auth.trustedClientIpHeader).toBe('')
    }
  })
})

function assertModuleOptions(_options: ModuleOptions): void {}

function _moduleOptionsTypeContracts() {
  assertModuleOptions({})
  assertModuleOptions({ auth: false })
  assertModuleOptions({ auth: { origin: 'http://localhost:3000' } })
  assertModuleOptions({
    auth: {
      origin: 'https://app.example.test',
      client: './convex-auth.ts',
      trustedClientIpHeader: 'cf-connecting-ip',
      redirectTo: '/login',
    },
  })

  // @ts-expect-error enabling auth requires the exact application origin
  assertModuleOptions({ auth: {} })
  // @ts-expect-error old origin vocabulary was removed
  assertModuleOptions({ auth: { publicOrigin: 'https://app.example.test' } })
  assertModuleOptions({
    auth: {
      origin: 'https://app.example.test',
      // @ts-expect-error proxy implementation knobs are internal
      proxy: { maxRequestBodyBytes: 10 },
    },
  })
  assertModuleOptions({
    auth: {
      origin: 'https://app.example.test',
      // @ts-expect-error route policy is flat and preserve-return is fixed
      routeProtection: { redirectTo: '/login' },
    },
  })
  // @ts-expect-error there is no redundant enabled toggle
  assertModuleOptions({ auth: { origin: 'https://app.example.test', enabled: false } })
}

void _moduleOptionsTypeContracts

describe('auth config type contracts', () => {
  it('keeps invalid build states out of ModuleOptions', () => {
    expect(true).toBe(true)
  })
})
