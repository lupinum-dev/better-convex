import { afterEach, describe, expect, it, vi } from 'vitest'

import { createLogger } from '../../src/runtime/utils/logger'
import { sanitizeDiagnosticValue } from '../../src/runtime/utils/sanitize-diagnostic'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('sanitizeDiagnosticValue', () => {
  it('redacts nested secrets, bounds strings, and handles circular and bigint values', () => {
    const input: Record<string, unknown> = {
      authorization: 'Bearer private',
      nested: { sessionToken: 'private', value: 12n },
      long: 'x'.repeat(600),
    }
    input.circular = input

    expect(sanitizeDiagnosticValue(input)).toEqual({
      authorization: '[Redacted]',
      nested: { sessionToken: '[Redacted]', value: '12n' },
      long: `${'x'.repeat(512)}[Truncated]`,
      circular: '[Circular]',
    })
  })

  it('preserves bounded output for oversized control-character strings', () => {
    expect(sanitizeDiagnosticValue('\u0000'.repeat(1_000_000))).toBe(
      sanitizeDiagnosticValue('\u0000'.repeat(1024)),
    )
  })

  it('redacts common consumer secret labels without treating every key as secret', () => {
    expect(
      sanitizeDiagnosticValue({
        jwt: 'private',
        bearer: 'private',
        apiKey: 'private',
        private_key: 'private',
        accessKey: 'private',
        passphrase: 'private',
        keyboardLayout: 'dvorak',
      }),
    ).toEqual({
      jwt: '[Redacted]',
      bearer: '[Redacted]',
      apiKey: '[Redacted]',
      private_key: '[Redacted]',
      accessKey: '[Redacted]',
      passphrase: '[Redacted]',
      keyboardLayout: 'dvorak',
    })
  })

  it('does not invoke accessors and survives hostile proxies', () => {
    const getter = vi.fn(() => 'private')
    const value = Object.defineProperty({}, 'tokenFromGetter', { get: getter, enumerable: true })
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('blocked')
        },
      },
    )

    expect(sanitizeDiagnosticValue(value)).toEqual({ tokenFromGetter: '[Redacted]' })
    expect(getter).not.toHaveBeenCalled()
    expect(sanitizeDiagnosticValue(hostile)).toBe('[Unreadable]')
  })

  it('keeps logger methods immutable and prevents hostile data from breaking logging', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const logger = createLogger('debug')
    const hostile = Object.defineProperty({ password: 'private' }, 'boom', {
      get() {
        throw new Error('must not run')
      },
      enumerable: true,
    })

    expect(() => logger.debug('diagnostic', hostile)).not.toThrow()
    expect(log).toHaveBeenCalled()
    expect(JSON.stringify(log.mock.calls)).not.toContain('private')
    expect(Object.isFrozen(logger)).toBe(true)
  })

  it('escapes terminal controls in values, property names, and event labels', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const logger = createLogger('debug')

    logger.auth({
      phase: 'session\nforged\u001B[31m',
      outcome: 'success',
      details: { 'line\rbreak': 'value\twith\u007Fcontrols' },
    })
    logger.upload({ name: 'upload\nforged', event: 'success', filename: 'file\rname.png' })

    const output = JSON.stringify(log.mock.calls)
    expect(output).not.toContain('session\\nforged')
    expect(output).toContain('session\\\\u000Aforged\\\\u001B[31m')
    expect(output).toContain('line\\\\u000Dbreak')
    expect(output).toContain('value\\\\u0009with\\\\u007Fcontrols')
    expect(output).toContain('file\\\\u000Dname.png')
    expect(sanitizeDiagnosticValue(Symbol('symbol\nforged\u001B[2J'))).toBe(
      'Symbol(symbol\\u000Aforged\\u001B[2J)',
    )
  })

  it('omits JWT-shaped values and arbitrary errors even when their field names are neutral', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logger = createLogger('debug')
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkaWFnbm9zdGljLXNlbnRpbmVsIn0.signature'
    const sentinel = 'BCN_DIAGNOSTIC_SECRET_SENTINEL'

    logger.debug('transport failed', { value: jwt, sentinel })
    logger.auth({
      phase: 'ssr.auth.completed',
      outcome: 'error',
      error: new Error(`${jwt}:${sentinel}`),
    })

    const output = JSON.stringify([...log.mock.calls, ...error.mock.calls])
    expect(output).not.toContain(jwt)
    expect(output).not.toContain(sentinel)
    expect(output).toContain('[Omitted]')
  })
})
