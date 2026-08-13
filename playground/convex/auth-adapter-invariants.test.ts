/// <reference types="vite/client" />

import type { ComponentApi } from '@lupinum/better-convex-nuxt/convex-auth/_generated/component.js'
import authTest from '@lupinum/better-convex-nuxt/convex-auth/test'
import { convexTest } from 'convex-test'
import { componentsGeneric, makeFunctionReference } from 'convex/server'
import { describe, expect, it } from 'vitest'

import schema from './schema'

const rootModules = import.meta.glob('./**/*.ts')
const components = componentsGeneric() as unknown as {
  authInvariant: ComponentApi<'authInvariant'>
}
const auth = components.authInvariant.adapter
type AuthWhere = NonNullable<(typeof auth.findMany)['_args']['where']>[number]

type ReferenceUser = {
  createdAt: number
  email: string
  emailVerified: boolean
  id: string
  image: string | null
  name: string
}

type AuthTestPage = {
  continueCursor: string
  isDone: boolean
  page: Array<Record<string, unknown>>
}

const faultFunctions = {
  create: makeFunctionReference<'mutation', { id: string; key: string }, Record<string, unknown>>(
    'authConcurrency:createRaceRow',
  ),
  consume: makeFunctionReference<'mutation', { id: string }, Record<string, unknown> | null>(
    'authConcurrency:consumeRaceRowWithFailingTrigger',
  ),
  increment: makeFunctionReference<'mutation', { id: string }, Record<string, unknown> | null>(
    'authConcurrency:incrementRaceRowWithFailingTrigger',
  ),
  read: makeFunctionReference<'query', { id: string }, Record<string, unknown> | null>(
    'authConcurrency:readRaceRow',
  ),
  updateMany: makeFunctionReference<'mutation', { keyPrefix: string }, number>(
    'authConcurrency:updateRaceRowsWithFailingTrigger',
  ),
}

function initAuthTest() {
  const t = convexTest(schema, rootModules)
  authTest.register(t, 'authInvariant')
  return t
}

function initFaultTest() {
  const t = convexTest(schema, rootModules)
  authTest.register(t)
  return t
}

async function createUser(
  t: ReturnType<typeof initAuthTest>,
  input: {
    id: string
    name: string
    email: string
    image?: string | null
    emailVerified?: boolean
    createdAt?: number
  },
) {
  const now = input.createdAt ?? Date.now()
  return await t.mutation(auth.create, {
    model: 'user',
    data: {
      id: input.id,
      name: input.name,
      email: input.email,
      emailVerified: input.emailVerified ?? true,
      ...(input.image !== undefined ? { image: input.image } : {}),
      createdAt: now,
      updatedAt: now,
    },
  })
}

async function findAll(
  t: ReturnType<typeof initAuthTest>,
  args: {
    model: string
    where?: AuthWhere[]
  },
) {
  const rows: Array<Record<string, unknown>> = []
  let cursor: string | null = null
  do {
    const result = (await t.query(auth.findMany, {
      ...args,
      paginationOpts: { cursor, numItems: 25 },
    })) as AuthTestPage
    rows.push(...result.page)
    cursor = result.isDone ? null : result.continueCursor
  } while (cursor !== null)
  return rows
}

function referenceCompare(left: unknown, right: unknown): number {
  if (left === right) return 0
  if (left === null || left === undefined) return -1
  if (right === null || right === undefined) return 1
  if (typeof left === 'number' && typeof right === 'number') return left < right ? -1 : 1
  if (typeof left === 'string' && typeof right === 'string') return left < right ? -1 : 1
  if (typeof left === 'boolean' && typeof right === 'boolean') return left === false ? -1 : 1
  return String(left).localeCompare(String(right))
}

function referenceMatches(row: ReferenceUser, where: readonly AuthWhere[]): boolean {
  if (where.length === 0) return true
  const evaluate = (clause: AuthWhere) => {
    const actual = row[clause.field as keyof ReferenceUser]
    const normalize = (value: unknown) =>
      clause.mode === 'insensitive' && typeof value === 'string' ? value.toLowerCase() : value
    const expected = Array.isArray(clause.value)
      ? clause.value.map(normalize)
      : normalize(clause.value)
    const value = normalize(actual)
    switch (clause.operator ?? 'eq') {
      case 'eq':
        return clause.value === null ? actual === null || actual === undefined : value === expected
      case 'ne':
        return value !== expected
      case 'lt':
        return clause.value !== null && referenceCompare(actual, clause.value) < 0
      case 'lte':
        return clause.value !== null && referenceCompare(actual, clause.value) <= 0
      case 'gt':
        return clause.value !== null && referenceCompare(actual, clause.value) > 0
      case 'gte':
        return clause.value !== null && referenceCompare(actual, clause.value) >= 0
      case 'in':
        return Array.isArray(expected) && expected.includes(value as never)
      case 'not_in':
        return Array.isArray(expected) && !expected.includes(value as never)
      case 'contains':
        return typeof value === 'string' && typeof expected === 'string' && value.includes(expected)
      case 'starts_with':
        return (
          typeof value === 'string' && typeof expected === 'string' && value.startsWith(expected)
        )
      case 'ends_with':
        return typeof value === 'string' && typeof expected === 'string' && value.endsWith(expected)
    }
  }

  let matches = evaluate(where[0]!)
  for (const clause of where.slice(1)) {
    const next = evaluate(clause)
    matches = clause.connector === 'OR' ? matches || next : matches && next
  }
  return matches
}

async function findMany(
  t: ReturnType<typeof initAuthTest>,
  args: {
    model: string
    where?: AuthWhere[]
    sortBy?: { field: string; direction: 'asc' | 'desc' }
    select?: string[]
  },
) {
  return await t.query(auth.findMany, {
    ...args,
    paginationOpts: { cursor: null, numItems: 100 },
  })
}

describe('Better Convex Nuxt auth component adapter invariants', () => {
  it('preserves logical ids, strips storage fields, and canonicalizes absent nullable fields', async () => {
    const t = initAuthTest()

    const created = await createUser(t, {
      id: 'user_logical_ada',
      name: 'Ada',
      email: 'ada@example.com',
    })

    expect(created).toMatchObject({
      id: 'user_logical_ada',
      name: 'Ada',
      email: 'ada@example.com',
      image: null,
    })
    expect(created).not.toHaveProperty('_id')
    expect(created).not.toHaveProperty('_creationTime')

    const found = await t.query(auth.findOne, {
      model: 'user',
      where: [{ field: 'id', value: 'user_logical_ada' }],
    })
    expect(found).toEqual(created)
  })

  it('keeps canonical nulls unchanged during a partial update', async () => {
    const t = initAuthTest()
    await createUser(t, {
      id: 'user_partial',
      name: 'Before',
      email: 'partial@example.com',
    })

    const updated = await t.mutation(auth.updateOne, {
      model: 'user',
      where: [{ field: 'id', value: 'user_partial' }],
      update: { name: 'After' },
    })

    expect(updated).toMatchObject({
      id: 'user_partial',
      name: 'After',
      email: 'partial@example.com',
      image: null,
    })
  })

  it('rejects every invalid bulk patch before changing rows', async () => {
    const t = initAuthTest()
    await createUser(t, { id: 'bulk_a', name: 'A', email: 'a@example.com' })
    await createUser(t, { id: 'bulk_b', name: 'B', email: 'b@example.com' })

    await expect(
      t.mutation(auth.updateMany, {
        model: 'user',
        where: [],
        update: { id: 'rewritten' },
      }),
    ).rejects.toThrow('AUTH_FIELD_IMMUTABLE:user.id')
    await expect(
      t.mutation(auth.updateMany, {
        model: 'user',
        where: [],
        update: { email: 'shared@example.com' },
      }),
    ).rejects.toThrow('AUTH_BULK_UNIQUE_UPDATE_FORBIDDEN:user.email')
    await expect(
      t.mutation(auth.updateMany, {
        model: 'user',
        where: [],
        update: { notAUserField: 'value' },
      }),
    ).rejects.toThrow('AUTH_FIELD_UNKNOWN:user.notAUserField')
    await expect(
      t.mutation(auth.updateMany, {
        model: 'user',
        where: [],
        update: {},
      }),
    ).rejects.toThrow('AUTH_UPDATE_EMPTY')

    const rows = await findMany(t, { model: 'user', sortBy: { field: 'name', direction: 'asc' } })
    expect(rows.page.map((row) => [row.id, row.email])).toEqual([
      ['bulk_a', 'a@example.com'],
      ['bulk_b', 'b@example.com'],
    ])
  })

  it('applies AND/OR, null, insensitive filters and indexed sorting consistently', async () => {
    const t = initAuthTest()
    await createUser(t, {
      id: 'filter_ada',
      name: 'Ada',
      email: 'ada@example.com',
      createdAt: 300,
    })
    await createUser(t, {
      id: 'filter_bob',
      name: 'Bob',
      email: 'bob@outside.test',
      image: 'https://example.com/bob.png',
      createdAt: 100,
    })
    await createUser(t, {
      id: 'filter_carol',
      name: 'Carol',
      email: 'carol@example.com',
      createdAt: 200,
    })

    const mixed = await findMany(t, {
      model: 'user',
      where: [
        { field: 'email', operator: 'ends_with', value: '@example.com' },
        { field: 'image', value: null, connector: 'AND' },
        { field: 'name', value: 'Bob', connector: 'OR' },
      ],
      sortBy: { field: 'name', direction: 'asc' },
    })
    expect(mixed.page.map((row) => row.id)).toEqual(['filter_ada', 'filter_bob', 'filter_carol'])

    const insensitive = await findMany(t, {
      model: 'user',
      where: [
        { field: 'name', operator: 'contains', value: 'A', mode: 'insensitive' },
        {
          field: 'email',
          operator: 'in',
          value: ['ADA@EXAMPLE.COM', 'CAROL@EXAMPLE.COM'],
          mode: 'insensitive',
        },
      ],
      sortBy: { field: 'name', direction: 'desc' },
      select: ['id', 'name'],
    })
    expect(insensitive.page).toEqual([
      { id: 'filter_carol', name: 'Carol' },
      { id: 'filter_ada', name: 'Ada' },
    ])
  })

  it('matches the pinned deterministic reference corpus and count contract', async () => {
    const t = initAuthTest()
    const users: ReferenceUser[] = [
      {
        id: 'reference_ada',
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        emailVerified: true,
        image: null,
        createdAt: 100,
      },
      {
        id: 'reference_alan',
        name: 'Alan Turing',
        email: 'alan@example.com',
        emailVerified: true,
        image: 'https://example.com/alan.png',
        createdAt: 200,
      },
      {
        id: 'reference_grace',
        name: 'Grace Hopper',
        email: 'grace@navy.mil',
        emailVerified: false,
        image: null,
        createdAt: 300,
      },
      {
        id: 'reference_bob',
        name: 'bob stone',
        email: 'bob@example.com',
        emailVerified: false,
        image: 'https://example.com/bob.png',
        createdAt: 400,
      },
    ]
    await Promise.all(users.map((user) => createUser(t, user)))

    const corpus: Array<{ name: string; where: AuthWhere[] }> = [
      { name: 'indexed equality', where: [{ field: 'email', value: 'ada@example.com' }] },
      { name: 'indexed name', where: [{ field: 'name', value: 'Alan Turing' }] },
      { name: 'canonical null', where: [{ field: 'image', value: null }] },
      { name: 'not null', where: [{ field: 'image', operator: 'ne', value: null }] },
      { name: 'less than', where: [{ field: 'createdAt', operator: 'lt', value: 250 }] },
      { name: 'less than or equal', where: [{ field: 'createdAt', operator: 'lte', value: 200 }] },
      { name: 'greater than', where: [{ field: 'createdAt', operator: 'gt', value: 200 }] },
      {
        name: 'greater than or equal',
        where: [{ field: 'createdAt', operator: 'gte', value: 300 }],
      },
      {
        name: 'in',
        where: [{ field: 'name', operator: 'in', value: ['Ada Lovelace', 'Grace Hopper'] }],
      },
      {
        name: 'not in',
        where: [
          {
            field: 'email',
            operator: 'not_in',
            value: ['alan@example.com', 'grace@navy.mil'],
          },
        ],
      },
      { name: 'contains', where: [{ field: 'name', operator: 'contains', value: 'stone' }] },
      {
        name: 'starts with',
        where: [{ field: 'email', operator: 'starts_with', value: 'grace@' }],
      },
      {
        name: 'ends with',
        where: [{ field: 'email', operator: 'ends_with', value: '@example.com' }],
      },
      {
        name: 'insensitive',
        where: [{ field: 'name', operator: 'contains', value: 'ADA', mode: 'insensitive' }],
      },
      {
        name: 'and',
        where: [
          { field: 'email', operator: 'ends_with', value: '@example.com' },
          { field: 'image', value: null, connector: 'AND' },
        ],
      },
      {
        name: 'or',
        where: [
          { field: 'image', value: null },
          { field: 'email', value: 'bob@example.com', connector: 'OR' },
        ],
      },
    ]

    for (const entry of corpus) {
      const expected = users
        .filter((row) => referenceMatches(row, entry.where))
        .map((row) => row.id)
        .sort()
      const found = await findAll(t, { model: 'user', where: entry.where })
      const foundIds = found.map((row) => String(row.id)).sort()
      const count = await t.query(auth.count, { model: 'user', where: entry.where })

      expect(foundIds, entry.name).toEqual(expected)
      expect(count, entry.name).toBe(found.length)
    }
  })

  it('counts the complete multi-page findMany result without materializing one giant page', async () => {
    const t = initAuthTest()
    await Promise.all(
      Array.from({ length: 205 }, (_, index) =>
        createUser(t, {
          id: `paged_${String(index).padStart(3, '0')}`,
          name: `Paged ${String(index).padStart(3, '0')}`,
          email: `paged-${index}@example.com`,
        }),
      ),
    )

    const rows = await findAll(t, { model: 'user' })
    expect(rows).toHaveLength(205)
    await expect(t.query(auth.count, { model: 'user' })).resolves.toBe(rows.length)
  })

  it('uses the ordered session compound index without changing filter semantics', async () => {
    const t = initAuthTest()
    const now = Date.now()
    await createUser(t, {
      id: 'user_a',
      name: 'User A',
      email: 'user-a@example.com',
      createdAt: now,
    })
    await createUser(t, {
      id: 'user_b',
      name: 'User B',
      email: 'user-b@example.com',
      createdAt: now,
    })
    for (const [id, userId, expiresAt] of [
      ['session_a', 'user_a', now + 1_000],
      ['session_b', 'user_a', now + 2_000],
      ['session_c', 'user_b', now + 3_000],
    ] as const) {
      await t.mutation(auth.create, {
        model: 'session',
        data: {
          id,
          token: `token_${id}`,
          userId,
          expiresAt,
          createdAt: now,
          updatedAt: now,
        },
      })
    }

    const rows = await findMany(t, {
      model: 'session',
      where: [
        { field: 'userId', value: 'user_a' },
        { field: 'expiresAt', operator: 'gt', value: now + 1_500 },
      ],
    })
    expect(rows.page.map((row) => row.id)).toEqual(['session_b'])
  })

  it('consumes a one-time row at most once under concurrent attempts', async () => {
    const t = initAuthTest()
    const now = Date.now()
    await t.mutation(auth.create, {
      model: 'verification',
      data: {
        id: 'verification_once',
        identifier: 'challenge',
        value: 'secret',
        expiresAt: now + 60_000,
        createdAt: now,
        updatedAt: now,
      },
    })

    const results = await Promise.all([
      t.mutation(auth.consumeOne, {
        model: 'verification',
        where: [{ field: 'id', value: 'verification_once' }],
      }),
      t.mutation(auth.consumeOne, {
        model: 'verification',
        where: [{ field: 'id', value: 'verification_once' }],
      }),
    ])

    expect(results.filter((result) => result !== null)).toHaveLength(1)
    expect(results.filter((result) => result === null)).toHaveLength(1)
    expect(
      await t.query(auth.findOne, {
        model: 'verification',
        where: [{ field: 'id', value: 'verification_once' }],
      }),
    ).toBeNull()
  })

  it('does not lose concurrent increments', async () => {
    const t = initAuthTest()
    await t.mutation(auth.create, {
      model: 'rateLimit',
      data: {
        id: 'rate_limit_counter',
        key: 'tenant:acme',
        count: 0,
        lastRequest: 1,
      },
    })

    await Promise.all(
      Array.from({ length: 12 }, () =>
        t.mutation(auth.incrementOne, {
          model: 'rateLimit',
          where: [{ field: 'id', value: 'rate_limit_counter' }],
          increment: { count: 1 },
        }),
      ),
    )

    const row = await t.query(auth.findOne, {
      model: 'rateLimit',
      where: [{ field: 'id', value: 'rate_limit_counter' }],
    })
    expect(row).toMatchObject({ id: 'rate_limit_counter', count: 12 })
  })

  it('supports decrement and set return semantics while rejecting overlap and overflow', async () => {
    const t = initAuthTest()
    await t.mutation(auth.create, {
      model: 'rateLimit',
      data: {
        id: 'rate_limit_arithmetic',
        key: 'tenant:arithmetic',
        count: 10,
        lastRequest: 1,
      },
    })

    const decremented = await t.mutation(auth.incrementOne, {
      model: 'rateLimit',
      where: [{ field: 'id', value: 'rate_limit_arithmetic' }],
      increment: { count: -3 },
      set: { lastRequest: 2 },
    })
    expect(decremented).toMatchObject({
      id: 'rate_limit_arithmetic',
      count: 7,
      lastRequest: 2,
    })
    await expect(
      t.mutation(auth.incrementOne, {
        model: 'rateLimit',
        where: [{ field: 'id', value: 'rate_limit_arithmetic' }],
        increment: { count: 1 },
        set: { count: 99 },
      }),
    ).rejects.toThrow('AUTH_INCREMENT_SET_OVERLAP:count')
    expect(
      await t.query(auth.findOne, {
        model: 'rateLimit',
        where: [{ field: 'id', value: 'rate_limit_arithmetic' }],
      }),
    ).toMatchObject({ count: 7, lastRequest: 2 })

    await t.mutation(auth.create, {
      model: 'rateLimit',
      data: {
        id: 'rate_limit_overflow',
        key: 'tenant:overflow',
        count: Number.MAX_VALUE,
        lastRequest: 1,
      },
    })
    await expect(
      t.mutation(auth.incrementOne, {
        model: 'rateLimit',
        where: [{ field: 'id', value: 'rate_limit_overflow' }],
        increment: { count: Number.MAX_VALUE },
      }),
    ).rejects.toThrow('AUTH_INCREMENT_OVERFLOW:count')
    expect(
      await t.query(auth.findOne, {
        model: 'rateLimit',
        where: [{ field: 'id', value: 'rate_limit_overflow' }],
      }),
    ).toMatchObject({ count: Number.MAX_VALUE, lastRequest: 1 })
  })

  it('rolls back consume and increment when their app trigger fails', async () => {
    const t = initFaultTest()
    const consumeRow = { id: 'fault_consume', key: 'fault:consume' }
    const incrementRow = {
      id: 'fault_increment-update-trigger-fault',
      key: 'fault:increment',
    }
    await t.mutation(faultFunctions.create, consumeRow)
    await t.mutation(faultFunctions.create, incrementRow)

    await expect(t.mutation(faultFunctions.consume, { id: consumeRow.id })).rejects.toThrow(
      'AUTH_TRIGGER_FAULT_INJECTED',
    )
    await expect(t.mutation(faultFunctions.increment, { id: incrementRow.id })).rejects.toThrow(
      'AUTH_TRIGGER_FAULT_INJECTED',
    )

    await expect(t.query(faultFunctions.read, { id: consumeRow.id })).resolves.toMatchObject({
      ...consumeRow,
      count: 0,
      lastRequest: 0,
    })
    await expect(t.query(faultFunctions.read, { id: incrementRow.id })).resolves.toMatchObject({
      ...incrementRow,
      count: 0,
      lastRequest: 0,
    })
  })

  it('rolls back earlier updateMany rows when a later trigger fails', async () => {
    const t = initFaultTest()
    const keyPrefix = 'fault:update-many:'
    const passRow = { id: 'fault_update_many_pass', key: `${keyPrefix}a` }
    const faultRow = {
      id: 'fault_update_many-update-trigger-fault',
      key: `${keyPrefix}b`,
    }
    await t.mutation(faultFunctions.create, passRow)
    await t.mutation(faultFunctions.create, faultRow)

    await expect(t.mutation(faultFunctions.updateMany, { keyPrefix })).rejects.toThrow(
      'AUTH_TRIGGER_FAULT_INJECTED',
    )
    await expect(t.query(faultFunctions.read, { id: passRow.id })).resolves.toMatchObject({
      ...passRow,
      count: 0,
      lastRequest: 0,
    })
    await expect(t.query(faultFunctions.read, { id: faultRow.id })).resolves.toMatchObject({
      ...faultRow,
      count: 0,
      lastRequest: 0,
    })
  })
})
