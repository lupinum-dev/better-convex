/// <reference types="vite/client" />

import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fingerprintWorkforceFactor } from '../../src/runtime/convex-auth/workforce/factor-fingerprint'
import type { WorkforceReplayProof } from '../../src/runtime/convex-auth/workforce/operations'
import {
  assertGenericVerificationDelete,
  assertGenericVerificationWrite,
  collectExpiredWorkforceVerificationRows,
  consumeWorkforceTotpReplay,
  isWorkforceReplayMarker,
  workforceReplayPolicy,
} from '../../src/runtime/convex-auth/workforce/replay'
import schema from '../fixtures/workforce-component/convex/betterAuth/schema'

const modules = import.meta.glob('../fixtures/workforce-component/convex/betterAuth/**/*.ts')
const now = 1_700_000_010_000
const counter = now / workforceReplayPolicy.periodMs
const binding = { userId: 'user', factorId: 'factor', factorSecret: 'synthetic-encrypted-factor' }
const proof = {
  userId: binding.userId,
  factorId: binding.factorId,
  factorFingerprint: await fingerprintWorkforceFactor(binding.factorSecret),
  digest: 'a'.repeat(43),
  matchingCounters: [counter],
} satisfies WorkforceReplayProof

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
})
afterEach(() => vi.useRealTimers())

function fixture() {
  const test = convexTest(schema, modules)
  const consume = (input = proof, expected = binding) =>
    test.mutation(async (ctx) => consumeWorkforceTotpReplay(ctx, input, expected))
  return { test, consume }
}

describe('canonical TOTP replay consumption', () => {
  it('stores only an opaque marker, with no primary challenge assurance', async () => {
    const { test, consume } = fixture()
    await consume()
    const rows = await test.query((ctx) => ctx.db.query('verification').take(2))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: `bcn-totp-replay:${proof.digest}`,
      identifier: `bcn-totp-replay:${proof.digest}`,
      value: 'bcn-totp-replay',
      createdAt: now,
      expiresAt: now + workforceReplayPolicy.retentionMs,
      bcnAssuranceGeneration: null,
    })
  })

  it('rejects sequential reuse independently of password challenge or session', async () => {
    const { consume } = fixture()
    await consume()
    await expect(consume()).rejects.toThrow('AUTH_WORKFORCE_TOTP_REPLAYED')
  })

  it('permits only one concurrent consumption', async () => {
    const { test, consume } = fixture()
    const outcomes = await Promise.allSettled([consume(), consume(), consume()])
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(await test.query((ctx) => ctx.db.query('verification').take(4))).toHaveLength(1)
  })

  it('consumes distinct server-derived digests independently', async () => {
    const { test, consume } = fixture()
    await consume()
    await consume({ ...proof, digest: 'b'.repeat(43) })
    expect(await test.query((ctx) => ctx.db.query('verification').take(3))).toHaveLength(2)
  })

  it('rolls back the marker and the protected write when the containing mutation fails', async () => {
    const { test, consume } = fixture()
    await expect(
      test.mutation(async (ctx) => {
        await consumeWorkforceTotpReplay(ctx, proof, binding)
        await ctx.db.insert('verification', {
          id: 'synthetic-protected-write',
          identifier: 'synthetic-protected-write',
          value: 'synthetic',
          createdAt: now,
          updatedAt: now,
          expiresAt: now + 1000,
          bcnAssuranceGeneration: null,
        })
        throw new Error('TEST_ONLY_POST_WRITE_FAILURE')
      }),
    ).rejects.toThrow('TEST_ONLY_POST_WRITE_FAILURE')
    expect(await test.query((ctx) => ctx.db.query('verification').take(3))).toEqual([])
    await expect(consume()).resolves.toBeNull()
  })

  it.each([
    { userId: 'other' },
    { factorId: 'other' },
    { digest: '' },
    { digest: 'a'.repeat(42) },
    { digest: `${'a'.repeat(42)}=` },
    { factorFingerprint: '' },
    { factorFingerprint: 'a'.repeat(64) },
    { matchingCounters: [] },
    { matchingCounters: [Number.NaN] },
    { matchingCounters: [-1] },
    { matchingCounters: [counter + 0.5] },
    { matchingCounters: [counter - 2] },
    { matchingCounters: [counter + 2] },
    { matchingCounters: [counter, counter] },
    { matchingCounters: [counter, counter + 1000] },
    { matchingCounters: [counter - 1, counter, counter + 1, counter + 2] },
  ])('rejects invalid or stale metadata %j before writing', async (patch) => {
    const { test, consume } = fixture()
    await expect(consume({ ...proof, ...patch })).rejects.toThrow(
      'AUTH_WORKFORCE_REPLAY_PROOF_INVALID',
    )
    expect(await test.query((ctx) => ctx.db.query('verification').take(1))).toEqual([])
  })

  it.each([counter - 1, counter, counter + 1])(
    'accepts a provider-matched counter inside the canonical window %i',
    async (matched) => {
      const { consume } = fixture()
      await expect(consume({ ...proof, matchingCounters: [matched] })).resolves.toBeNull()
    },
  )

  it('does not revive an already-verified stalled request after marker expiry', async () => {
    const { consume } = fixture()
    await consume()
    vi.setSystemTime(now + workforceReplayPolicy.retentionMs)
    await expect(consume()).rejects.toThrow('AUTH_WORKFORCE_REPLAY_PROOF_INVALID')
    await expect(
      consume({
        ...proof,
        matchingCounters: [Math.floor(Date.now() / workforceReplayPolicy.periodMs)],
      }),
    ).resolves.toBeNull()
  })

  it('rejects reuse immediately before retention ends and permits a fresh request at expiry', async () => {
    const { test, consume } = fixture()
    await consume()
    vi.setSystemTime(now + workforceReplayPolicy.retentionMs - 1)
    await expect(
      consume({
        ...proof,
        matchingCounters: [Math.floor(Date.now() / workforceReplayPolicy.periodMs)],
      }),
    ).rejects.toThrow('AUTH_WORKFORCE_TOTP_REPLAYED')
    vi.setSystemTime(now + workforceReplayPolicy.retentionMs)
    await consume({
      ...proof,
      matchingCounters: [Math.floor(Date.now() / workforceReplayPolicy.periodMs)],
    })
    expect(await test.query((ctx) => ctx.db.query('verification').take(2))).toHaveLength(1)
  })

  it('retains collisions through the last matched counter acceptance interval', async () => {
    const { test, consume } = fixture()
    await consume({ ...proof, matchingCounters: [counter + 1, counter + 3] })
    const marker = await test.query((ctx) => ctx.db.query('verification').first())
    expect(marker?.expiresAt).toBe((counter + 5) * workforceReplayPolicy.periodMs)
    vi.setSystemTime((counter + 4) * workforceReplayPolicy.periodMs)
    await expect(
      consume({ ...proof, matchingCounters: [counter + 1, counter + 3] }),
    ).rejects.toThrow('AUTH_WORKFORCE_TOTP_REPLAYED')
    vi.setSystemTime((counter + 5) * workforceReplayPolicy.periodMs)
    await expect(
      consume({ ...proof, matchingCounters: [counter + 1, counter + 3] }),
    ).rejects.toThrow('AUTH_WORKFORCE_REPLAY_PROOF_INVALID')
  })

  it('invalidates evidence when the canonical encrypted factor differs', async () => {
    const { consume } = fixture()
    await expect(
      consume(proof, { ...binding, factorSecret: 'different-envelope' }),
    ).rejects.toThrow('AUTH_WORKFORCE_REPLAY_PROOF_INVALID')
  })

  it('retains a consumed digest across encryption rotation and factor-row recreation', async () => {
    const { consume } = fixture()
    await consume()
    const rotated = { ...binding, factorId: 'new-row', factorSecret: 'new-encrypted-envelope' }
    await expect(
      consume(
        {
          ...proof,
          factorId: rotated.factorId,
          factorFingerprint: await fingerprintWorkforceFactor(rotated.factorSecret),
        },
        rotated,
      ),
    ).rejects.toThrow('AUTH_WORKFORCE_TOTP_REPLAYED')
  })

  it('fails closed on an existing malformed marker without overwriting it', async () => {
    const { test, consume } = fixture()
    await consume()
    await test.run(async (ctx) => {
      const marker = await ctx.db.query('verification').first()
      if (!marker) throw new Error('TEST_ONLY_MISSING_MARKER')
      await ctx.db.patch('verification', marker._id, { value: 'not-a-replay-marker' })
    })
    await expect(consume()).rejects.toThrow('AUTH_WORKFORCE_REPLAY_MARKER_INVALID')
    expect((await test.query((ctx) => ctx.db.query('verification').first()))?.value).toBe(
      'not-a-replay-marker',
    )
  })
})

describe('replay marker namespace', () => {
  const ordinary = { id: 'ordinary', identifier: 'hashed-provider-value', expiresAt: now + 1000 }
  const marker = { ...ordinary, identifier: `bcn-totp-replay:${proof.digest}` }

  it('recognizes either reserved identity field without classifying ordinary challenges', () => {
    expect(isWorkforceReplayMarker(null)).toBe(false)
    expect(isWorkforceReplayMarker(ordinary)).toBe(false)
    expect(isWorkforceReplayMarker(marker)).toBe(true)
    expect(isWorkforceReplayMarker({ ...ordinary, id: marker.identifier })).toBe(true)
  })

  it('rejects forged creation, marker changes and renaming in either direction', () => {
    for (const [previous, next] of [
      [null, marker],
      [marker, marker],
      [marker, ordinary],
      [ordinary, marker],
    ] as const) {
      expect(() => assertGenericVerificationWrite(previous, next)).toThrow(
        'AUTH_WORKFORCE_REPLAY_MARKER_OWNED',
      )
    }
    expect(() => assertGenericVerificationWrite(null, ordinary)).not.toThrow()
    expect(() => assertGenericVerificationWrite(ordinary, ordinary)).not.toThrow()
  })

  it('allows deletion only once a marker expires, failing closed on malformed expiry', () => {
    expect(() => assertGenericVerificationDelete(ordinary)).not.toThrow()
    for (const expiresAt of [now + 1, null, Number.NaN, 0]) {
      expect(() => assertGenericVerificationDelete({ ...marker, expiresAt })).toThrow(
        'AUTH_WORKFORCE_REPLAY_MARKER_OWNED',
      )
    }
    expect(() => assertGenericVerificationDelete({ ...marker, expiresAt: now })).not.toThrow()
    expect(() => assertGenericVerificationDelete({ ...marker, expiresAt: now - 1 })).not.toThrow()
  })
})

describe('bounded verification cleanup selection', () => {
  it('preserves an older requested cutoff and clamps a future one to canonical time', async () => {
    const { test, consume } = fixture()
    await consume()
    await test.run(async (ctx) => {
      for (const [id, expiresAt] of [
        ['older', now - 2000],
        ['recent', now - 1],
      ] as const) {
        await ctx.db.insert('verification', {
          id,
          identifier: id,
          value: 'ordinary',
          expiresAt,
          createdAt: now - 5000,
          updatedAt: now - 5000,
          bcnAssuranceGeneration: null,
        })
      }
    })
    expect(
      (await test.mutation((ctx) => collectExpiredWorkforceVerificationRows(ctx, now - 1000))).map(
        (row) => row.id,
      ),
    ).toEqual(['older'])
    expect(
      (await test.mutation((ctx) => collectExpiredWorkforceVerificationRows(ctx, now - 1.5))).map(
        (row) => row.id,
      ),
    ).toEqual(['older'])
    expect(
      (
        await test.mutation((ctx) => collectExpiredWorkforceVerificationRows(ctx, now + 500_000))
      ).map((row) => row.id),
    ).toEqual(['older', 'recent'])
    for (const cutoff of [Number.NaN, Infinity, 0, -1]) {
      await expect(
        test.mutation((ctx) => collectExpiredWorkforceVerificationRows(ctx, cutoff)),
      ).rejects.toThrow('AUTH_WORKFORCE_CLEANUP_CUTOFF_INVALID')
    }
  })

  it('drains more than 128 expired markers through bounded batches and preserves live rows', async () => {
    const { test, consume } = fixture()
    await consume()
    await test.run(async (ctx) => {
      await ctx.db.insert('verification', {
        id: 'ordinary-expired',
        identifier: 'ordinary-expired',
        value: 'ordinary',
        expiresAt: now - 2,
        createdAt: now - 200_000,
        updatedAt: now - 200_000,
        bcnAssuranceGeneration: null,
      })
      for (let index = 0; index < 260; index++) {
        await ctx.db.insert('verification', {
          id: `bcn-totp-replay:expired-${index}`,
          identifier: `bcn-totp-replay:expired-${index}`,
          value: 'bcn-totp-replay',
          expiresAt: now - 1,
          createdAt: now - 200_000,
          updatedAt: now - 200_000,
          bcnAssuranceGeneration: null,
        })
      }
    })
    const batches = []
    for (let batch = 0; batch < 4; batch++) {
      batches.push(
        await test.mutation(async (ctx) => {
          const rows = await collectExpiredWorkforceVerificationRows(ctx)
          for (const row of rows) {
            assertGenericVerificationDelete(row)
            const id = typeof row._id === 'string' && ctx.db.normalizeId('verification', row._id)
            if (!id) throw new Error('TEST_ONLY_INVALID_ROW')
            await ctx.db.delete('verification', id)
          }
          return rows.length
        }),
      )
    }
    expect(batches).toEqual([128, 128, 5, 0])
    expect(await test.query((ctx) => ctx.db.query('verification').take(2))).toHaveLength(1)
  })
})
