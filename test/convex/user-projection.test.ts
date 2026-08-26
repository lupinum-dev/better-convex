/// <reference types="vite/client" />

import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import { describe, expect, it } from 'vitest'

import schema from '../fixtures/user-projection/convex/schema'

const modules = import.meta.glob('../fixtures/user-projection/convex/**/*.ts')
const seed = makeFunctionReference<
  'mutation',
  { appEmails: string[]; authId: string; canonicalEmail: string },
  null
>('projection:seed')
const updateCanonicalAndProjection = makeFunctionReference<
  'mutation',
  { authId: string; email: string },
  null
>('projection:updateCanonicalAndProjection')
const rebuild = makeFunctionReference<
  'mutation',
  { users: Array<{ id: string; email: string }> },
  null
>('projection:rebuild')
const inspect = makeFunctionReference<
  'query',
  { authId: string },
  { appEmails: string[]; canonicalEmail: string }
>('projection:inspect')

describe('user projection transactions', () => {
  it('rolls back the canonical update when duplicate projections are ambiguous', async () => {
    const test = convexTest(schema, modules)
    await test.mutation(seed, {
      appEmails: ['first@example.test', 'second@example.test'],
      authId: 'auth-1',
      canonicalEmail: 'before@example.test',
    })

    await expect(
      test.mutation(updateCanonicalAndProjection, {
        authId: 'auth-1',
        email: 'after@example.test',
      }),
    ).rejects.toMatchObject({ data: { code: 'AUTH_USER_PROJECTION_CONFLICT' } })
    await expect(test.query(inspect, { authId: 'auth-1' })).resolves.toEqual({
      appEmails: ['first@example.test', 'second@example.test'],
      canonicalEmail: 'before@example.test',
    })
  })

  it('rolls back earlier rebuild writes when a later user conflicts', async () => {
    const test = convexTest(schema, modules)
    await test.mutation(seed, {
      appEmails: [],
      authId: 'auth-1',
      canonicalEmail: 'one@example.test',
    })
    await test.mutation(seed, {
      appEmails: ['first@example.test', 'second@example.test'],
      authId: 'auth-2',
      canonicalEmail: 'two@example.test',
    })

    await expect(
      test.mutation(rebuild, {
        users: [
          { id: 'auth-1', email: 'one@example.test' },
          { id: 'auth-2', email: 'new@example.test' },
        ],
      }),
    ).rejects.toMatchObject({ data: { code: 'AUTH_USER_PROJECTION_CONFLICT' } })
    await expect(test.query(inspect, { authId: 'auth-1' })).resolves.toEqual({
      appEmails: [],
      canonicalEmail: 'one@example.test',
    })
    await expect(test.query(inspect, { authId: 'auth-2' })).resolves.toEqual({
      appEmails: ['first@example.test', 'second@example.test'],
      canonicalEmail: 'two@example.test',
    })
  })
})
