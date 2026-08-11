import { describe, expect, it } from 'vitest'

import {
  isExactLoopbackHost,
  normalizeAuthOrigin,
  requireAuthOrigin,
} from '../../src/runtime/shared/auth-origin'

describe('canonical auth origins', () => {
  it.each([
    ['https://app.example.test', 'https://app.example.test'],
    ['https://app.example.test/', 'https://app.example.test'],
    ['https://app.example.test:444', 'https://app.example.test:444'],
    ['http://localhost:3000', 'http://localhost:3000'],
    ['http://127.0.0.1:3000/', 'http://127.0.0.1:3000'],
    ['http://[::1]:3000', 'http://[::1]:3000'],
  ])('accepts the canonical origin %s', (input, expected) => {
    expect(normalizeAuthOrigin(input, 'SITE_URL')).toBe(expected)
  })

  it.each([
    'ftp://app.example.test',
    'file:///tmp/auth',
    'ws://app.example.test',
    'wss://app.example.test',
    'custom://app.example.test',
    'https://user@app.example.test',
    'https://user:password@app.example.test',
    'https://app.example.test/path',
    'https://app.example.test?query=1',
    'https://app.example.test#fragment',
    'https://APP.example.test',
    'https://app.example.test:443',
    'https://app.example.test.',
    'https://bücher.example',
    ' https://app.example.test',
    'https://app.example.test//',
    'http://worker.localhost:3000',
    'http://localhost.example:3000',
    'http://127.0.0.2:3000',
    'http://127.1:3000',
    'http://0177.0.0.1:3000',
    'http://0x7f000001:3000',
    'http://2130706433:3000',
    'http://[0:0:0:0:0:0:0:1]:3000',
    'http://[::ffff:127.0.0.1]:3000',
  ])('rejects unsafe or noncanonical input %s', (input) => {
    expect(() => normalizeAuthOrigin(input, 'SITE_URL')).toThrow()
  })

  it('recognizes only URL-parser canonical exact loopback hostnames', () => {
    expect(isExactLoopbackHost('localhost')).toBe(true)
    expect(isExactLoopbackHost('127.0.0.1')).toBe(true)
    expect(isExactLoopbackHost('[::1]')).toBe(true)

    for (const hostname of [
      'LOCALHOST',
      'worker.localhost',
      'localhost.',
      '127.0.0.2',
      '127.1',
      '::1',
      '[0:0:0:0:0:0:0:1]',
      '[::ffff:127.0.0.1]',
    ]) {
      expect(isExactLoopbackHost(hostname), hostname).toBe(false)
    }
  })

  it('requires the named environment value', () => {
    expect(requireAuthOrigin('SITE_URL', { SITE_URL: 'https://app.example.test/' })).toBe(
      'https://app.example.test',
    )
    expect(() => requireAuthOrigin('SITE_URL', {})).toThrow('SITE_URL is required')
  })

  it('rejects non-string JavaScript callers before URL coercion', () => {
    expect(() => normalizeAuthOrigin(123 as never, 'SITE_URL')).toThrow('non-empty string')
  })
})
