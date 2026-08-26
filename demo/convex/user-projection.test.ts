import { describe, expect, it } from 'vitest'

import { components, internal } from './_generated/api'
import { initConvexTest } from './test.setup'

async function createAuthUser(
  t: ReturnType<typeof initConvexTest>,
  fields: { name: string; email: string; image?: string },
) {
  return (await t.run(async (ctx) => {
    const now = Date.now()
    return await ctx.runMutation(components.betterAuth.adapter.create, {
      model: 'user',
      data: {
        id: `user_${fields.email}`,
        ...fields,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      },
    })
  })) as { id: string }
}

describe('demo user projection', () => {
  it('rebuilds missing and stale rows', async () => {
    const t = initConvexTest()
    const staleAuthUser = await createAuthUser(t, {
      name: 'Canonical Ada',
      email: 'ada@example.com',
      image: 'https://example.com/ada.png',
    })
    const missingAuthUser = await createAuthUser(t, {
      name: 'Grace',
      email: 'grace@example.com',
    })

    await t.run(async (ctx) => {
      await ctx.db.insert('users', {
        authId: staleAuthUser.id,
        displayName: 'Stale Ada',
        email: 'stale@example.com',
        avatarUrl: 'https://example.com/stale.png',
        createdAt: 1,
        updatedAt: 1,
      })
    })

    const result = await t.mutation(internal.auth.rebuildUserProjectionBatch, { cursor: null })
    expect(result).toMatchObject({ inserted: 1, patched: 1, skipped: 0, isDone: true })

    const users = await t.run(async (ctx) => await ctx.db.query('users').collect())
    expect(users).toHaveLength(2)
    expect(users.filter((user) => user.authId === staleAuthUser.id)).toEqual([
      expect.objectContaining({
        displayName: 'Canonical Ada',
        email: 'ada@example.com',
        avatarUrl: 'https://example.com/ada.png',
      }),
    ])
    expect(users.filter((user) => user.authId === missingAuthUser.id)).toEqual([
      expect.objectContaining({ displayName: 'Grace', email: 'grace@example.com' }),
    ])
  })

  it('fails closed and rolls back the rebuild batch when projections conflict', async () => {
    const t = initConvexTest()
    const missingAuthUser = await createAuthUser(t, {
      name: 'Grace',
      email: 'grace@example.com',
    })
    const conflictingAuthUser = await createAuthUser(t, {
      name: 'Canonical Ada',
      email: 'ada@example.com',
    })

    await t.run(async (ctx) => {
      for (const email of ['ada+first@example.com', 'ada+second@example.com']) {
        await ctx.db.insert('users', {
          authId: conflictingAuthUser.id,
          displayName: 'Application-owned Ada',
          email,
          createdAt: 1,
          updatedAt: 1,
        })
      }
    })

    const before = await t.run(async (ctx) => await ctx.db.query('users').collect())
    await expect(
      t.mutation(internal.auth.rebuildUserProjectionBatch, { cursor: null }),
    ).rejects.toMatchObject({ data: { code: 'AUTH_USER_PROJECTION_CONFLICT' } })

    expect(await t.run(async (ctx) => await ctx.db.query('users').collect())).toEqual(before)
    expect(before.some((user) => user.authId === missingAuthUser.id)).toBe(false)
  })

  it('removes every copied PII row when the auth user is deleted', async () => {
    const t = initConvexTest()
    await t.run(async (ctx) => {
      for (const email of ['ada@example.com', 'ada+duplicate@example.com']) {
        await ctx.db.insert('users', {
          authId: 'auth-user-delete',
          displayName: 'Ada',
          email,
          createdAt: 1,
          updatedAt: 1,
        })
      }
    })

    await t.mutation(internal.auth.onDelete, {
      model: 'user',
      doc: { id: 'auth-user-delete' },
    })

    expect(await t.run(async (ctx) => await ctx.db.query('users').collect())).toEqual([])
  })
})
