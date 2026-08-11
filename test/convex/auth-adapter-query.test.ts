/// <reference types="vite/client" />

import { convexTest } from 'convex-test'
import { componentsGeneric, defineSchema } from 'convex/server'
import { describe, expect, it } from 'vitest'

import type { ComponentApi } from '../../src/runtime/convex-auth/component/_generated/component'
import authSchema from '../../src/runtime/convex-auth/component/schema'

const rootModules = import.meta.glob('../fixtures/jwks-rotation/convex/**/*.ts')
const authModules = import.meta.glob('../../src/runtime/convex-auth/component/**/*.ts')
const rootSchema = defineSchema({})
const components = componentsGeneric() as unknown as {
  authQuery: ComponentApi<'authQuery'>
}
const auth = components.authQuery.adapter

function initAuthQueryTest() {
  const test = convexTest(rootSchema, rootModules)
  test.registerComponent('authQuery', authSchema, authModules)
  return test
}

async function createVerification(
  test: ReturnType<typeof initAuthQueryTest>,
  id: string,
  identifier = `identifier-${id}`,
) {
  return test.mutation(auth.create, {
    data: {
      createdAt: 1,
      expiresAt: 10_000,
      id,
      identifier,
      updatedAt: 1,
      value: `value-${id}`,
    },
    model: 'verification',
  })
}

describe('Convex auth adapter ordered queries', () => {
  it('uses the identifier + createdAt index for isolated final-factor verification lookup', async () => {
    const test = initAuthQueryTest()
    const rows = [
      { createdAt: 100, id: 'a-old', identifier: 'mfa:a' },
      { createdAt: 300, id: 'b-only', identifier: 'mfa:b' },
      { createdAt: 200, id: 'a-new', identifier: 'mfa:a' },
    ]
    for (const row of rows) {
      await test.mutation(auth.create, {
        data: {
          ...row,
          expiresAt: 10_000,
          updatedAt: row.createdAt,
          value: `value-${row.id}`,
        },
        model: 'verification',
      })
    }

    const result = await test.query(auth.findMany, {
      model: 'verification',
      paginationOpts: { cursor: null, numItems: 10 },
      sortBy: { direction: 'desc', field: 'createdAt' },
      where: [{ field: 'identifier', value: 'mfa:a' }],
    })

    expect(result.page.map((row) => row.id)).toEqual(['a-new', 'a-old'])
    expect(result.isDone).toBe(true)
  })

  it('uses exact indexes for bounded in reads shared by find, count, update, and delete', async () => {
    const test = initAuthQueryTest()
    for (let index = 0; index < 205; index += 1) {
      await createVerification(test, `noise-${String(index).padStart(3, '0')}`)
    }
    await createVerification(test, 'target-a')
    await createVerification(test, 'target-b')
    const where = [{ field: 'id', operator: 'in' as const, value: ['target-a', 'target-b'] }]

    const found = await test.query(auth.findMany, {
      model: 'verification',
      paginationOpts: { cursor: null, numItems: 10 },
      where,
    })
    expect(found.page.map((row) => row.id)).toEqual(['target-a', 'target-b'])
    expect(found.isDone).toBe(true)

    await expect(test.query(auth.count, { model: 'verification', where })).resolves.toBe(2)
    await expect(
      test.mutation(auth.updateMany, {
        model: 'verification',
        update: { value: 'revoked' },
        where,
      }),
    ).resolves.toBe(2)
    await expect(
      test.mutation(auth.deleteMany, {
        model: 'verification',
        where,
      }),
    ).resolves.toBe(2)
    await expect(test.query(auth.count, { model: 'verification', where })).resolves.toBe(0)
  })

  it('matches randomized OR equality and preserves creation order across in cursors', async () => {
    const test = initAuthQueryTest()
    let randomState = 24_301
    const groups = ['group-a', 'group-b', 'group-c', 'other']
    const identifiers = Array.from({ length: 48 }, () => {
      randomState = (randomState * 1664525 + 1013904223) >>> 0
      return groups[randomState % groups.length]!
    })
    for (const [index, identifier] of identifiers.entries()) {
      await createVerification(test, `row-${index}`, identifier)
    }

    const values = ['group-a', 'group-b', 'group-c', 'group-a']
    const inWhere = [{ field: 'identifier', operator: 'in' as const, value: values }]
    const orWhere = [...new Set(values)].map((value, index) => ({
      connector: index === 0 ? ('AND' as const) : ('OR' as const),
      field: 'identifier',
      value,
    }))
    const expected = await test.query(auth.findMany, {
      model: 'verification',
      paginationOpts: { cursor: null, numItems: 100 },
      where: orWhere,
    })

    const actualIds: unknown[] = []
    let cursor: string | null = null
    do {
      const page: {
        continueCursor: string
        isDone: boolean
        page: Array<Record<string, unknown>>
      } = await test.query(auth.findMany, {
        model: 'verification',
        paginationOpts: { cursor, numItems: 2 },
        where: inWhere,
      })
      actualIds.push(...page.page.map((row) => row.id))
      cursor = page.isDone ? null : page.continueCursor
    } while (cursor !== null)

    expect(actualIds).toEqual(expected.page.map((row) => row.id))
    expect(actualIds).toEqual(
      identifiers.flatMap((identifier, index) => (identifier === 'other' ? [] : [`row-${index}`])),
    )
  })

  it('keeps OR, insensitive, and non-index operators as final residual predicates', async () => {
    const test = initAuthQueryTest()
    await createVerification(test, 'alpha', 'Tenant-A')
    await createVerification(test, 'alphabet', 'tenant-a')
    await createVerification(test, 'omega', 'tenant-b')

    const cases = [
      {
        expected: ['alpha', 'alphabet'],
        where: [
          {
            field: 'identifier',
            mode: 'insensitive' as const,
            operator: 'in' as const,
            value: ['TENANT-A'],
          },
        ],
      },
      {
        expected: ['alpha', 'omega'],
        where: [
          { field: 'id', operator: 'in' as const, value: ['alpha'] },
          { connector: 'OR' as const, field: 'id', value: 'omega' },
        ],
      },
      {
        expected: ['alphabet'],
        where: [
          { field: 'id', operator: 'in' as const, value: ['alpha', 'alphabet', 'omega'] },
          { field: 'id', operator: 'contains' as const, value: 'pha' },
          { field: 'id', operator: 'starts_with' as const, value: 'alpha' },
          { field: 'id', operator: 'ends_with' as const, value: 'bet' },
          { field: 'id', operator: 'not_in' as const, value: ['alpha'] },
        ],
      },
    ]

    for (const { expected, where } of cases) {
      const result = await test.query(auth.findMany, {
        model: 'verification',
        paginationOpts: { cursor: null, numItems: 10 },
        where,
      })
      expect(result.page.map((row) => row.id)).toEqual(expected)
    }
  })

  it('rejects oversized exact-index in fan-out with one private error', async () => {
    const test = initAuthQueryTest()
    const atLimit = Array.from({ length: 64 }, (_, index) => `id-${index}`)
    await expect(
      test.query(auth.findMany, {
        model: 'verification',
        paginationOpts: { cursor: null, numItems: 10 },
        where: [{ field: 'id', operator: 'in', value: atLimit }],
      }),
    ).resolves.toMatchObject({ isDone: true, page: [] })

    await expect(
      test.query(auth.findMany, {
        model: 'verification',
        paginationOpts: { cursor: null, numItems: 10 },
        where: [
          {
            field: 'id',
            operator: 'in',
            value: [...atLimit, 'one-too-many'],
          },
        ],
      }),
    ).rejects.toThrow('AUTH_IN_FANOUT_LIMIT_EXCEEDED')
  })

  it('rejects oversized bulk updates and deletes before effects', async () => {
    const test = initAuthQueryTest()
    for (let index = 0; index < 129; index += 1) {
      await createVerification(test, `bulk-${index}`, 'bulk-operation')
    }
    const where = [{ field: 'identifier', value: 'bulk-operation' }]

    await expect(
      test.mutation(auth.updateMany, {
        model: 'verification',
        update: { value: 'updated' },
        where,
      }),
    ).rejects.toThrow('AUTH_BULK_OPERATION_LIMIT_EXCEEDED')
    await expect(
      test.query(auth.findOne, {
        model: 'verification',
        where: [{ field: 'id', value: 'bulk-0' }],
      }),
    ).resolves.toMatchObject({ value: 'value-bulk-0' })

    await expect(
      test.mutation(auth.deleteMany, {
        model: 'verification',
        where,
      }),
    ).rejects.toThrow('AUTH_BULK_OPERATION_LIMIT_EXCEEDED')
    await expect(test.query(auth.count, { model: 'verification', where })).resolves.toBe(129)

    await test.mutation(auth.deleteOne, {
      model: 'verification',
      where: [{ field: 'id', value: 'bulk-128' }],
    })
    await expect(
      test.mutation(auth.updateMany, {
        model: 'verification',
        update: { value: 'updated' },
        where,
      }),
    ).resolves.toBe(128)
    await expect(
      test.mutation(auth.deleteMany, {
        model: 'verification',
        where,
      }),
    ).resolves.toBe(128)
  })

  it('rejects immutable-id and unique-field bulk updates before effects', async () => {
    const test = initAuthQueryTest()

    await expect(
      test.mutation(auth.updateMany, {
        model: 'user',
        update: { id: 'attacker-chosen-id' },
        where: [],
      }),
    ).rejects.toThrow('AUTH_FIELD_IMMUTABLE:user.id')
    await expect(
      test.mutation(auth.updateMany, {
        model: 'user',
        update: { email: 'shared@example.test' },
        where: [],
      }),
    ).rejects.toThrow('AUTH_BULK_UNIQUE_UPDATE_FORBIDDEN:user.email')
  })
})
