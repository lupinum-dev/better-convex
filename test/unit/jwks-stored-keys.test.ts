import type { Jwk } from 'better-auth/plugins'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  JWKS_GRACE_PERIOD_SECONDS,
  JWKS_PRUNE_DEFAULT_BATCH_SIZE,
  JWKS_PRUNE_MAX_BATCH_SIZE,
  describeKeyIdForLog,
  isPrunableSigningKeyExpiry,
  normalizeSigningKeyPruneBatchSize,
  selectUsableStoredJwks,
  storedSigningKeyDocumentIssue,
} from '../../src/runtime/convex-auth/jwks-rotation'

const NOW = 10_000_000
const GRACE_MS = JWKS_GRACE_PERIOD_SECONDS * 1_000
const PUBLIC_KEY = JSON.stringify({ e: 'AQAB', kty: 'RSA', n: 'modulus' })
const PRIVATE_KEY = JSON.stringify(`$ba$1$${'ab'.repeat(32)}`)

function row(id: string, overrides: Partial<Record<keyof Jwk, unknown>> = {}): Jwk {
  return {
    alg: 'RS256',
    createdAt: new Date(NOW - 1_000),
    id,
    privateKey: PRIVATE_KEY,
    publicKey: PUBLIC_KEY,
    ...overrides,
  } as Jwk
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('stored JWKS row selection', () => {
  it('returns canonical public projections for valid current and retired rows', () => {
    const rows = [
      row('current'),
      row('retired', {
        expiresAt: new Date(NOW - 1),
        publicKey: JSON.stringify({ e: 'AQAB', n: 'modulus', kty: 'RSA' }),
      }),
    ]
    const usable = selectUsableStoredJwks(rows, { now: NOW, requireEncryptedCurrentKey: true })
    expect(usable.map((key) => key.id)).toEqual(['current', 'retired'])
    expect(usable[1]!.publicKey).toBe('{"kty":"RSA","n":"modulus","e":"AQAB"}')
  })

  it('treats an unreadable expiry as unusable instead of current', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const usable = selectUsableStoredJwks(
      [row('current'), row('bad-expiry-a', { expiresAt: new Date(Number.NaN) })],
      { now: NOW },
    )
    expect(usable.map((key) => key.id)).toEqual(['current'])
    expect(warn).toHaveBeenCalledWith(
      '[better-convex] AUTH_JWKS_RETIRED_KEY_SKIPPED kid=bad-expiry-a reason=AUTH_JWKS_EXPIRY_INVALID',
    )
  })

  it('warns once per malformed retired key and reason', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const rows = [row('current'), row('dedupe-a', { alg: 'HS256', expiresAt: new Date(NOW - 1) })]
    selectUsableStoredJwks(rows, { now: NOW })
    selectUsableStoredJwks(rows, { now: NOW })
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('fails closed on a malformed current key, including a future-dated expiry', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      selectUsableStoredJwks([row('future', { expiresAt: new Date(NOW + 1), alg: 'none' })], {
        now: NOW,
      }),
    ).toThrow('AUTH_JWKS_CURRENT_KEY_INVALID')
    expect(error).toHaveBeenCalledWith(
      '[better-convex] AUTH_JWKS_CURRENT_KEY_INVALID kid=future reason=AUTH_JWKS_ALGORITHM_INVALID',
    )
  })

  it('requires a versioned encrypted private key only for the signing reader', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const rows = [row('plain', { privateKey: '{"kty":"RSA","d":"secret"}' })]
    expect(selectUsableStoredJwks(rows, { now: NOW })).toHaveLength(1)
    expect(() =>
      selectUsableStoredJwks(rows, { now: NOW, requireEncryptedCurrentKey: true }),
    ).toThrow('AUTH_JWKS_CURRENT_KEY_INVALID')
  })

  it('never logs key material or raw control characters', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    selectUsableStoredJwks(
      [
        row('current'),
        row(`evil\u0007${'x'.repeat(300)}`, {
          expiresAt: new Date(NOW - 1),
          publicKey: JSON.stringify({ d: 'PRIVATE_SENTINEL', e: 'AQAB', kty: 'RSA', n: 'n' }),
        }),
      ],
      { now: NOW },
    )
    const line = String(warn.mock.calls[0]?.[0])
    expect(line).not.toContain('PRIVATE_SENTINEL')
    expect(line).not.toContain('\u0007')
    expect(line.length).toBeLessThan(200)
  })
})

describe('stored JWKS helpers', () => {
  it('describes key ids for logs without echoing unbounded input', () => {
    expect(describeKeyIdForLog('kid-1')).toBe('kid-1')
    expect(describeKeyIdForLog(42)).toBe('<invalid>')
    expect(describeKeyIdForLog('')).toBe('<invalid>')
    expect(describeKeyIdForLog('a\nb')).toBe('a?b')
    expect(describeKeyIdForLog('k'.repeat(100))).toBe(`${'k'.repeat(64)}...`)
  })

  it('bounds the prune batch size', () => {
    expect(normalizeSigningKeyPruneBatchSize(undefined)).toBe(JWKS_PRUNE_DEFAULT_BATCH_SIZE)
    expect(normalizeSigningKeyPruneBatchSize(1)).toBe(1)
    expect(normalizeSigningKeyPruneBatchSize(JWKS_PRUNE_MAX_BATCH_SIZE)).toBe(
      JWKS_PRUNE_MAX_BATCH_SIZE,
    )
    for (const invalid of [0, -1, 2.5, JWKS_PRUNE_MAX_BATCH_SIZE + 1, Number.NaN, Infinity]) {
      expect(() => normalizeSigningKeyPruneBatchSize(invalid)).toThrow(
        'AUTH_JWKS_PRUNE_BATCH_SIZE_INVALID',
      )
    }
  })

  it('prunes only after retirement plus the full verification overlap', () => {
    expect(isPrunableSigningKeyExpiry(null, NOW)).toBe(false)
    expect(isPrunableSigningKeyExpiry(undefined, NOW)).toBe(false)
    expect(isPrunableSigningKeyExpiry(Number.NaN, NOW)).toBe(false)
    expect(isPrunableSigningKeyExpiry(-Infinity, NOW)).toBe(false)
    expect(isPrunableSigningKeyExpiry('0', NOW)).toBe(false)
    expect(isPrunableSigningKeyExpiry(NOW - GRACE_MS + 1, NOW)).toBe(false)
    expect(isPrunableSigningKeyExpiry(NOW - GRACE_MS, NOW)).toBe(true)
  })

  it('reports storage-level document issues by stable code', () => {
    const valid = {
      alg: 'RS256',
      createdAt: 1,
      crv: null,
      expiresAt: null,
      id: 'k',
      privateKey: PRIVATE_KEY,
      publicKey: PUBLIC_KEY,
    }
    expect(storedSigningKeyDocumentIssue(valid)).toBeUndefined()
    // Same private-key rule as the signer's reader, so ensure cannot disagree.
    expect(storedSigningKeyDocumentIssue({ ...valid, privateKey: undefined })).toBe(
      'AUTH_JWKS_PRIVATE_KEY_NOT_ENCRYPTED',
    )
    expect(
      storedSigningKeyDocumentIssue({ ...valid, privateKey: JSON.stringify({ kty: 'RSA' }) }),
    ).toBe('AUTH_JWKS_PRIVATE_KEY_NOT_ENCRYPTED')
    expect(storedSigningKeyDocumentIssue({ ...valid, createdAt: 1.5 })).toBe(
      'AUTH_JWKS_CREATED_AT_INVALID',
    )
    expect(storedSigningKeyDocumentIssue({ ...valid, crv: 'P-256' })).toBe(
      'AUTH_JWKS_ALGORITHM_INVALID',
    )
    expect(storedSigningKeyDocumentIssue({ ...valid, id: 7 })).toBe('AUTH_JWKS_KEY_ID_INVALID')
    expect(storedSigningKeyDocumentIssue({ ...valid, publicKey: '[]' })).toBe(
      'AUTH_JWKS_PUBLIC_KEY_INVALID',
    )
  })
})
