/// <reference types="vite/client" />

import { convexTest } from 'convex-test'
import { componentsGeneric, defineSchema } from 'convex/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ComponentApi } from '../../src/runtime/convex-auth/component/_generated/component'
import authSchema from '../../src/runtime/convex-auth/component/schema'
import {
  JWKS_GRACE_PERIOD_SECONDS,
  JWKS_PRUNE_MAX_BATCH_SIZE,
} from '../../src/runtime/convex-auth/jwks-rotation'

const rootModules = import.meta.glob('../fixtures/jwks-rotation/convex/**/*.ts')
const authModules = import.meta.glob('../../src/runtime/convex-auth/component/**/*.ts')
const rootSchema = defineSchema({})
const components = componentsGeneric() as unknown as {
  authRotation: ComponentApi<'authRotation'>
}
const auth = components.authRotation.adapter

function initRotationTest() {
  const test = convexTest(rootSchema, rootModules)
  test.registerComponent('authRotation', authSchema, authModules)
  return test
}

function candidate(id: string) {
  return {
    alg: 'RS256' as const,
    crv: null,
    id,
    privateKey: JSON.stringify(`$ba$1$${'ab'.repeat(96)}`),
    publicKey: JSON.stringify({ e: 'AQAB', kty: 'RSA', n: `modulus-${id}` }),
  }
}

async function allKeys(test: ReturnType<typeof initRotationTest>) {
  const result = await test.query(auth.findMany, {
    model: 'jwks',
    paginationOpts: { cursor: null, numItems: 100 },
  })
  return result.page.sort((left, right) => Number(left.createdAt) - Number(right.createdAt))
}

async function insertStoredKey(
  test: ReturnType<typeof initRotationTest>,
  id: string,
  fields: { createdAt: number; expiresAt: number | null; publicKey?: string; privateKey?: string },
) {
  const { publicKey, privateKey, ...rest } = fields
  await test.mutation(auth.create, {
    model: 'jwks',
    data: {
      ...candidate(id),
      ...(publicKey ? { publicKey } : {}),
      ...(privateKey ? { privateKey } : {}),
      ...rest,
    },
  })
}

const GRACE_MS = JWKS_GRACE_PERIOD_SECONDS * 1_000

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('additive JWKS rotation on the Convex component', () => {
  it('creates the initial key once when provisioning is retried', async () => {
    const test = initRotationTest()

    const created = await test.mutation(auth.rotateSigningKey, {
      next: candidate('K1'),
      onlyIfEmpty: true,
    })
    const reused = await test.mutation(auth.rotateSigningKey, {
      next: candidate('K2'),
      onlyIfEmpty: true,
    })

    expect(created).toMatchObject({ created: true, newKid: 'K1' })
    expect(reused).toMatchObject({ created: false, newKid: 'K1' })
    expect(await allKeys(test)).toEqual([expect.objectContaining({ expiresAt: null, id: 'K1' })])
  })

  it('serializes concurrent K2/K3 commits without deleting either candidate', async () => {
    const test = initRotationTest()
    const k1 = await test.mutation(auth.rotateSigningKey, {
      next: candidate('K1'),
    })

    const rotations = await Promise.all([
      test.mutation(auth.rotateSigningKey, { next: candidate('K2') }),
      test.mutation(auth.rotateSigningKey, { next: candidate('K3') }),
    ])
    const keys = await allKeys(test)

    expect(keys.map((key) => key.id).sort()).toEqual(['K1', 'K2', 'K3'])
    expect(keys.filter((key) => key.expiresAt === null)).toHaveLength(1)
    expect(new Set(keys.map((key) => key.createdAt)).size).toBe(3)

    const retiredBy = new Map<string, number>()
    for (const rotation of rotations) {
      expect(rotation.previousVerifyUntil).toBe(
        rotation.rotatedAt + JWKS_GRACE_PERIOD_SECONDS * 1_000,
      )
      for (const previousKid of rotation.previousKids) {
        retiredBy.set(previousKid, rotation.rotatedAt)
      }
    }
    expect(retiredBy.get(k1.newKid)).toBeDefined()
    for (const key of keys.filter((row) => row.expiresAt !== null)) {
      expect(key.expiresAt).toBe(retiredBy.get(String(key.id)))
    }
  })

  it('uses the delayed mutation commit time, not candidate generation order', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    const test = initRotationTest()
    await test.mutation(auth.rotateSigningKey, { next: candidate('K1') })
    const delayedK2 = candidate('K2')

    vi.setSystemTime(20_000)
    const k3 = await test.mutation(auth.rotateSigningKey, {
      next: candidate('K3'),
    })
    vi.setSystemTime(30_000)
    const k2 = await test.mutation(auth.rotateSigningKey, { next: delayedK2 })
    const keys = await allKeys(test)

    expect(k3.rotatedAt).toBe(20_000)
    expect(k2.rotatedAt).toBe(30_000)
    expect(k2.previousKids).toEqual(['K3'])
    expect(k2.previousVerifyUntil).toBe(30_000 + JWKS_GRACE_PERIOD_SECONDS * 1_000)
    expect(keys.find((key) => key.id === 'K3')?.expiresAt).toBe(30_000)
    expect(keys.find((key) => key.id === 'K2')).toMatchObject({
      createdAt: 30_000,
      expiresAt: null,
    })
  })

  it('does not partially retire the current key when candidate validation fails', async () => {
    const test = initRotationTest()
    await test.mutation(auth.rotateSigningKey, { next: candidate('K1') })
    const invalid = {
      ...candidate('K2'),
      privateKey: JSON.stringify({ d: 'plaintext-private-member', kty: 'RSA' }),
    }

    await expect(test.mutation(auth.rotateSigningKey, { next: invalid })).rejects.toThrow(
      'AUTH_JWKS_PRIVATE_KEY_NOT_ENCRYPTED',
    )
    await expect(test.mutation(auth.rotateSigningKey, { next: candidate('K1') })).rejects.toThrow(
      'AUTH_UNIQUE_CONFLICT:jwks.id',
    )
    expect(await allKeys(test)).toEqual([expect.objectContaining({ expiresAt: null, id: 'K1' })])
  })

  it('returns only bounded operator metadata, never a key row', async () => {
    const test = initRotationTest()
    await test.mutation(auth.rotateSigningKey, { next: candidate('K1') })
    const metadata = await test.mutation(auth.rotateSigningKey, {
      next: candidate('K2'),
    })
    const serialized = JSON.stringify(metadata)

    expect(metadata).toEqual({
      createdAt: expect.any(Number),
      newKid: 'K2',
      previousKids: ['K1'],
      previousVerifyUntil: expect.any(Number),
      rotatedAt: expect.any(Number),
    })
    expect(serialized).not.toMatch(/private|public|cipher|"d"|"k"/iu)
  })

  it('rotates past a retired row whose createdAt is not an integer', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const test = initRotationTest()
    await insertStoredKey(test, 'BROKEN', { createdAt: 1.5, expiresAt: 50_000 })
    await test.mutation(auth.rotateSigningKey, { next: candidate('K1') })

    vi.setSystemTime(200_000)
    const rotated = await test.mutation(auth.rotateSigningKey, { next: candidate('K2') })

    expect(rotated).toMatchObject({ newKid: 'K2', previousKids: ['K1'] })
    const keys = await allKeys(test)
    expect(keys.find((key) => key.id === 'K2')).toMatchObject({ expiresAt: null })
    expect(keys.find((key) => key.id === 'BROKEN')).toMatchObject({ expiresAt: 50_000 })
    const logged = warn.mock.calls.map((call) => call.join(' ')).join('\n')
    expect(logged).toContain('kid=BROKEN')
    expect(logged).toContain('AUTH_JWKS_CREATED_AT_INVALID')
    expect(logged).not.toMatch(/modulus|\$ba\$/u)
  })

  it('refuses to report a malformed current key as ready but lets rotation replace it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const test = initRotationTest()
    await insertStoredKey(test, 'BAD_CURRENT', {
      createdAt: 1_000,
      expiresAt: null,
      publicKey: '{not json',
    })

    await expect(
      test.mutation(auth.rotateSigningKey, { next: candidate('K1'), onlyIfEmpty: true }),
    ).rejects.toThrow('AUTH_JWKS_CURRENT_KEY_INVALID')
    expect(error.mock.calls.map((call) => call.join(' ')).join('\n')).toContain(
      'kid=BAD_CURRENT reason=AUTH_JWKS_PUBLIC_KEY_INVALID',
    )

    const rotated = await test.mutation(auth.rotateSigningKey, { next: candidate('K1') })
    expect(rotated.previousKids).toEqual(['BAD_CURRENT'])
    const keys = await allKeys(test)
    expect(keys.filter((key) => key.expiresAt === null).map((key) => key.id)).toEqual(['K1'])
  })

  it('refuses to report ready when any current key could not sign', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const test = initRotationTest()
    // An older current key with a plaintext private JWK, then a valid newest key:
    // the signer fails closed on the older one, so ensure must too.
    await insertStoredKey(test, 'PLAINTEXT_CURRENT', {
      createdAt: 1_000,
      expiresAt: null,
      privateKey: JSON.stringify({ kty: 'RSA', d: 'private-exponent' }),
    })
    await insertStoredKey(test, 'VALID_CURRENT', { createdAt: 2_000, expiresAt: null })

    await expect(
      test.mutation(auth.rotateSigningKey, { next: candidate('K1'), onlyIfEmpty: true }),
    ).rejects.toThrow('AUTH_JWKS_CURRENT_KEY_INVALID')
    const logged = error.mock.calls.map((call) => call.join(' ')).join('\n')
    expect(logged).toContain('kid=PLAINTEXT_CURRENT reason=AUTH_JWKS_PRIVATE_KEY_NOT_ENCRYPTED')
    expect(logged).not.toContain('private-exponent')

    const rotated = await test.mutation(auth.rotateSigningKey, { next: candidate('K1') })
    expect(rotated.previousKids.toSorted()).toEqual(['PLAINTEXT_CURRENT', 'VALID_CURRENT'])
  })
})

describe('JWKS pruning on the Convex component', () => {
  it('deletes only keys whose retirement plus the verification overlap has passed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const test = initRotationTest()
    await test.mutation(auth.rotateSigningKey, { next: candidate('K1') })
    vi.setSystemTime(2_000_000)
    await test.mutation(auth.rotateSigningKey, { next: candidate('K2') })
    vi.setSystemTime(3_000_000)
    await test.mutation(auth.rotateSigningKey, { next: candidate('K3') })

    // K1 retired at 2_000_000, K2 at 3_000_000; K3 is current.
    vi.setSystemTime(2_000_000 + GRACE_MS - 1)
    expect(await test.mutation(auth.pruneSigningKeys, {})).toEqual({
      deleted: 0,
      deletedKids: [],
      hasMore: false,
    })

    vi.setSystemTime(2_000_000 + GRACE_MS)
    expect(await test.mutation(auth.pruneSigningKeys, {})).toEqual({
      deleted: 1,
      deletedKids: ['K1'],
      hasMore: false,
    })
    expect((await allKeys(test)).map((key) => key.id)).toEqual(['K2', 'K3'])

    vi.setSystemTime(3_000_000 + GRACE_MS + 365 * 24 * 60 * 60 * 1_000)
    expect(await test.mutation(auth.pruneSigningKeys, {})).toMatchObject({
      deletedKids: ['K2'],
    })
    expect(await allKeys(test)).toEqual([expect.objectContaining({ expiresAt: null, id: 'K3' })])
  })

  it('is idempotent and never deletes the current key', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const test = initRotationTest()
    await test.mutation(auth.rotateSigningKey, { next: candidate('K1') })
    vi.setSystemTime(1_000_000 + 10 * GRACE_MS)

    for (let attempt = 0; attempt < 3; attempt++) {
      expect(await test.mutation(auth.pruneSigningKeys, {})).toEqual({
        deleted: 0,
        deletedKids: [],
        hasMore: false,
      })
    }
    expect(await allKeys(test)).toEqual([expect.objectContaining({ expiresAt: null, id: 'K1' })])
  })

  it('prunes in bounded oldest-first batches, including malformed retired rows', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000_000)
    const test = initRotationTest()
    await insertStoredKey(test, 'OLD_BROKEN', {
      createdAt: 1.5,
      expiresAt: 1_000,
      publicKey: '{not json',
    })
    await insertStoredKey(test, 'OLD_2', { createdAt: 2, expiresAt: 2_000 })
    await insertStoredKey(test, 'OLD_3', { createdAt: 3, expiresAt: 3_000 })
    await test.mutation(auth.rotateSigningKey, { next: candidate('CURRENT') })
    vi.setSystemTime(10_000_000 + GRACE_MS)

    expect(await test.mutation(auth.pruneSigningKeys, { batchSize: 2 })).toEqual({
      deleted: 2,
      deletedKids: ['OLD_BROKEN', 'OLD_2'],
      hasMore: true,
    })
    expect(await test.mutation(auth.pruneSigningKeys, { batchSize: 2 })).toEqual({
      deleted: 1,
      deletedKids: ['OLD_3'],
      hasMore: false,
    })
    expect(await allKeys(test)).toEqual([
      expect.objectContaining({ expiresAt: null, id: 'CURRENT' }),
    ])
  })

  it.each([0, -1, 1.5, JWKS_PRUNE_MAX_BATCH_SIZE + 1, Number.NaN])(
    'rejects an unbounded batch size %s',
    async (batchSize) => {
      const test = initRotationTest()
      await expect(test.mutation(auth.pruneSigningKeys, { batchSize })).rejects.toThrow(
        'AUTH_JWKS_PRUNE_BATCH_SIZE_INVALID',
      )
    },
  )
})
