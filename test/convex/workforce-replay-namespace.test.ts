/// <reference types="vite/client" />

import { convexTest } from 'convex-test'
import {
  componentsGeneric,
  createFunctionHandle,
  makeFunctionReference,
  type ApiFromModules,
  type FunctionArgs,
} from 'convex/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../../src/runtime/convex-auth/component/_generated/api'
import type { ComponentApi } from '../../src/runtime/convex-auth/component/_generated/component'
import rootSchema from '../fixtures/auth-relationships-root/convex/schema'
import schema from '../fixtures/workforce-component/convex/betterAuth/schema'
import type * as seed from '../fixtures/workforce-component/convex/betterAuth/seed'

const modules = import.meta.glob('../fixtures/workforce-component/convex/betterAuth/**/*.ts')
const auth = api.adapter
const now = 1_700_000_010_000
const markerId = `bcn-totp-replay:${'a'.repeat(43)}`
const whereId = (id: string) => [{ field: 'id', value: id }]
const ordinary = {
  id: 'ordinary',
  identifier: 'ordinary-hashed-identifier',
  value: 'synthetic-provider-value',
  createdAt: now - 5000,
  updatedAt: now - 5000,
  expiresAt: now + 120_000,
  bcnAssuranceGeneration: null,
}
const marker = { ...ordinary, id: markerId, identifier: markerId, value: 'bcn-totp-replay' }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
})
afterEach(() => vi.useRealTimers())

function init() {
  return convexTest(schema, modules)
}
type Test = ReturnType<typeof init>

function rows(test: Test) {
  return test.query((ctx) => ctx.db.query('verification').take(300))
}

async function seedPair(test: Test) {
  await test.run(async (ctx) => {
    await ctx.db.insert('verification', ordinary)
    await ctx.db.insert('verification', marker)
  })
}

describe('generic verification writes cannot control replay markers', () => {
  it.each(['id', 'identifier'] as const)('rejects a reserved %s on create', async (field) => {
    const test = init()
    await expect(
      test.mutation(auth.create, {
        model: 'verification',
        data: { ...ordinary, [field]: markerId },
      }),
    ).rejects.toThrow('AUTH_WORKFORCE_REPLAY_MARKER_OWNED')
    expect(await rows(test)).toEqual([])
  })

  it.each(['updateOne', 'updateMany', 'incrementOne'] as const)(
    '%s cannot alter a marker or rename either side of the namespace',
    async (operation) => {
      const test = init()
      await seedPair(test)
      const before = await rows(test)
      for (const [id, patch] of [
        [markerId, { value: 'changed' }],
        [markerId, { expiresAt: now - 1 }],
        [markerId, { identifier: 'renamed-away' }],
        ['ordinary', { identifier: `bcn-totp-replay:${'b'.repeat(43)}` }],
      ] as const) {
        const input = { model: 'verification', where: whereId(id) }
        const result =
          operation === 'incrementOne'
            ? test.mutation(auth.incrementOne, { ...input, increment: {}, set: patch })
            : test.mutation(auth[operation], { ...input, update: patch })
        await expect(result).rejects.toThrow('AUTH_WORKFORCE_REPLAY_MARKER_OWNED')
        expect(await rows(test)).toEqual(before)
      }
    },
  )

  it('rolls back an earlier ordinary-row bulk update when a later marker rejects it', async () => {
    const test = init()
    await seedPair(test)
    const before = await rows(test)
    await expect(
      test.mutation(auth.updateMany, {
        model: 'verification',
        where: [],
        update: { value: 'changed' },
      }),
    ).rejects.toThrow('AUTH_WORKFORCE_REPLAY_MARKER_OWNED')
    expect(await rows(test)).toEqual(before)
  })

  it.each(['updateOne', 'updateMany', 'incrementOne'] as const)(
    '%s retains the ordinary verification path',
    async (operation) => {
      const test = init()
      await test.mutation(auth.create, { model: 'verification', data: ordinary })
      const input = { model: 'verification', where: whereId(ordinary.id) }
      if (operation === 'incrementOne') {
        await test.mutation(auth.incrementOne, {
          ...input,
          increment: {},
          set: { value: 'updated-provider-value' },
        })
      } else {
        await test.mutation(auth[operation], {
          ...input,
          update: { value: 'updated-provider-value' },
        })
      }
      expect(await test.query(auth.findOne, input)).toMatchObject({
        value: 'updated-provider-value',
        bcnAssuranceGeneration: null,
      })
    },
  )
})

describe('generic verification deletion respects live replay retention', () => {
  it.each(['deleteOne', 'deleteMany', 'consumeOne'] as const)(
    '%s rejects a live marker and preserves all rows',
    async (operation) => {
      const test = init()
      await seedPair(test)
      const before = await rows(test)
      await expect(
        test.mutation(auth[operation], { model: 'verification', where: whereId(markerId) }),
      ).rejects.toThrow('AUTH_WORKFORCE_REPLAY_MARKER_OWNED')
      expect(await rows(test)).toEqual(before)
    },
  )

  it('does not partially delete ordinary rows when bulk selection also contains a live marker', async () => {
    const test = init()
    await seedPair(test)
    const before = await rows(test)
    await expect(
      test.mutation(auth.deleteMany, { model: 'verification', where: [] }),
    ).rejects.toThrow('AUTH_WORKFORCE_REPLAY_MARKER_OWNED')
    expect(await rows(test)).toEqual(before)
  })

  it.each(['deleteOne', 'deleteMany', 'consumeOne'] as const)(
    '%s still permits an ordinary challenge and an expired marker',
    async (operation) => {
      const test = init()
      await seedPair(test)
      await test.mutation(auth[operation], { model: 'verification', where: whereId('ordinary') })
      vi.setSystemTime(marker.expiresAt)
      await test.mutation(auth[operation], { model: 'verification', where: whereId(markerId) })
      expect(await rows(test)).toEqual([])
    },
  )
})

describe('canonical bounded verification expiry cleanup', () => {
  const expiryWhere = (value: number) => [{ field: 'expiresAt', operator: 'lt', value }] as const

  it('deletes at most 128 expired ordinary and marker rows per call despite a future cutoff', async () => {
    const test = init()
    await test.run(async (ctx) => {
      for (let index = 0; index < 260; index++) {
        const id = index % 2 === 0 ? `bcn-totp-replay:expired-${index}` : `ordinary-${index}`
        await ctx.db.insert('verification', {
          ...ordinary,
          id,
          identifier: id,
          value: index % 2 === 0 ? 'bcn-totp-replay' : ordinary.value,
          expiresAt: now - 1,
        })
      }
      await ctx.db.insert('verification', marker)
      await ctx.db.insert('verification', { ...ordinary, expiresAt: now })
    })
    const counts = []
    for (let batch = 0; batch < 4; batch++) {
      counts.push(
        await test.mutation(auth.deleteMany, {
          model: 'verification',
          where: [...expiryWhere(now + 500_000)],
        }),
      )
    }
    expect(counts).toEqual([128, 128, 4, 0])
    expect((await rows(test)).map((row) => row.id)).toEqual([markerId, 'ordinary'])
  })

  it('honors a past requested cutoff including its strict less-than boundary', async () => {
    const test = init()
    await test.run(async (ctx) => {
      for (const [id, expiresAt] of [
        ['older', now - 2000],
        ['at-cutoff', now - 1000],
        ['recent', now - 1],
      ] as const) {
        await ctx.db.insert('verification', { ...ordinary, id, identifier: id, expiresAt })
      }
      await ctx.db.insert('verification', marker)
    })
    expect(
      await test.mutation(auth.deleteMany, {
        model: 'verification',
        where: [...expiryWhere(now - 1000)],
      }),
    ).toBe(1)
    expect((await rows(test)).map((row) => row.id)).toEqual(['at-cutoff', 'recent', markerId])
  })

  it('rolls back marker cleanup and earlier trigger side effects when a later delete trigger rejects', async () => {
    const test = convexTest(
      rootSchema,
      import.meta.glob('../fixtures/auth-relationships-root/convex/**/*.ts'),
    )
    test.registerComponent('workforceAuth', schema, modules)
    const components = componentsGeneric() as unknown as {
      workforceAuth: ComponentApi<'workforceAuth'> & ApiFromModules<{ seed: typeof seed }>
    }
    const component = components.workforceAuth
    for (const data of [
      { ...marker, expiresAt: now - 2 },
      {
        ...ordinary,
        id: 'parent_trigger_failure',
        identifier: 'ordinary-trigger-failure',
        expiresAt: now - 1,
      },
    ]) {
      await test.mutation(component.seed.verification, { data })
    }
    await expect(
      test.mutation(async (ctx) =>
        ctx.runMutation(component.adapter.deleteMany, {
          model: 'verification',
          where: [...expiryWhere(now)],
          onDeleteModels: ['verification'],
          onDeleteHandle: String(
            await createFunctionHandle(
              makeFunctionReference<'mutation'>('relationshipTriggers:onDelete'),
            ),
          ),
        }),
      ),
    ).rejects.toThrow('EXPECTED_TRIGGER_FAILURE')
    for (const id of [markerId, 'parent_trigger_failure']) {
      expect(
        await test.query(component.adapter.findOne, {
          model: 'verification',
          where: whereId(id),
        }),
      ).toMatchObject({ id })
    }
    expect(await test.query((ctx) => ctx.db.query('relationshipEvents').take(2))).toEqual([])
  })

  const unsupportedCleanupShapes = [
    [{ field: 'expiresAt', operator: 'lte', value: now + 500_000 }],
    [{ field: 'expiresAt', operator: 'lt', value: now + 500_000, connector: 'OR' }],
    [{ field: 'expiresAt', operator: 'lt', value: now + 500_000, mode: 'insensitive' }],
    [
      { field: 'expiresAt', operator: 'lt', value: now + 500_000 },
      { field: 'id', operator: 'eq', value: markerId },
    ],
  ] satisfies FunctionArgs<typeof auth.deleteMany>['where'][]

  it.each(unsupportedCleanupShapes)(
    'does not use canonical-cleanup authority for a different predicate shape %j',
    async (...where) => {
      const test = init()
      await seedPair(test)
      const before = await rows(test)
      await expect(
        test.mutation(auth.deleteMany, { model: 'verification', where }),
      ).rejects.toThrow()
      expect(await rows(test)).toEqual(before)
    },
  )
})
