/// <reference types="vite/client" />

import { convexTest } from 'convex-test'
import { componentsGeneric, defineSchema } from 'convex/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ComponentApi } from '../../src/runtime/convex-auth/component/_generated/component'
import authSchema from '../../src/runtime/convex-auth/component/schema'
import { JWKS_GRACE_PERIOD_SECONDS } from '../../src/runtime/convex-auth/jwks-rotation'

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

afterEach(() => {
  vi.useRealTimers()
})

describe('additive JWKS rotation on the Convex component', () => {
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
    expect(keys.map((key) => key.createdAt)).toEqual(
      [...keys.map((key) => key.createdAt)].sort((a, b) => Number(a) - Number(b)),
    )

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
})
