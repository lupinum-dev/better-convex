import { convexTest } from 'convex-test'
import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import { describe, expect, it } from 'vitest'

import { tables } from '../../src/runtime/convex-auth/component/schema'
import { migrateBeta3UserGeneration } from '../../src/runtime/convex-auth/session-generation'

const modules = import.meta.glob('../fixtures/workforce-root/convex/**/*.ts')
const schema = defineSchema(
  {
    ...tables,
    accountLink: defineTable({ authUserId: v.string(), passwordHash: v.string() }),
    workspaceMember: defineTable({ authUserId: v.string(), role: v.string() }),
  },
  { schemaValidation: false },
)

const now = 1_700_000_000_000
const legacyUser = {
  id: 'historical-user-id',
  name: 'Existing User',
  email: 'existing@example.test',
  emailVerified: true,
  image: null,
  createdAt: now,
  updatedAt: now,
}
const legacySession = {
  id: 'historical-session-id',
  expiresAt: now + 60_000,
  token: 'existing-session-token',
  createdAt: now,
  updatedAt: now,
  ipAddress: null,
  userAgent: null,
  userId: legacyUser.id,
}

describe('beta.3 user-generation cutover', () => {
  it('requires legacy sessions to be deleted before changing users', async () => {
    const test = convexTest(schema, modules)
    const userId = await test.run(async (ctx) => {
      const id = await ctx.db.insert('user', legacyUser as never)
      await ctx.db.insert('session', legacySession as never)
      return id
    })

    await expect(test.run((ctx) => migrateBeta3UserGeneration(ctx, 'forward'))).rejects.toThrow(
      'AUTH_BETA3_CUTOVER_SESSIONS_REMAIN',
    )
    await expect(test.run((ctx) => ctx.db.get(userId))).resolves.not.toHaveProperty(
      'bcnSecurityGeneration',
    )
  })

  it('preserves user identity, account links, and application references', async () => {
    const test = convexTest(schema, modules)
    const ids = await test.run(async (ctx) => ({
      account: await ctx.db.insert('accountLink', {
        authUserId: legacyUser.id,
        passwordHash: 'unchanged',
      }),
      member: await ctx.db.insert('workspaceMember', {
        authUserId: legacyUser.id,
        role: 'owner',
      }),
      user: await ctx.db.insert('user', legacyUser as never),
    }))

    await expect(test.run((ctx) => migrateBeta3UserGeneration(ctx, 'forward'))).resolves.toEqual({
      patched: 1,
      scanned: 1,
    })
    await expect(test.run((ctx) => migrateBeta3UserGeneration(ctx, 'forward'))).resolves.toEqual({
      patched: 0,
      scanned: 1,
    })

    const state = await test.run(async (ctx) => ({
      account: await ctx.db.get(ids.account),
      member: await ctx.db.get(ids.member),
      user: await ctx.db.get(ids.user),
    }))
    expect(state.user).toMatchObject({
      _id: ids.user,
      id: legacyUser.id,
      bcnSecurityGeneration: 0,
    })
    expect(state.account).toMatchObject({
      _id: ids.account,
      authUserId: legacyUser.id,
      passwordHash: 'unchanged',
    })
    expect(state.member).toMatchObject({
      _id: ids.member,
      authUserId: legacyUser.id,
      role: 'owner',
    })
  })

  it('rolls back only generation zero while sessions remain absent', async () => {
    const test = convexTest(schema, modules)
    const userId = await test.run((ctx) =>
      ctx.db.insert('user', { ...legacyUser, bcnSecurityGeneration: 0 } as never),
    )

    await expect(test.run((ctx) => migrateBeta3UserGeneration(ctx, 'rollback'))).resolves.toEqual({
      patched: 1,
      scanned: 1,
    })
    await expect(test.run((ctx) => migrateBeta3UserGeneration(ctx, 'rollback'))).resolves.toEqual({
      patched: 0,
      scanned: 1,
    })
    await expect(test.run((ctx) => ctx.db.get(userId))).resolves.not.toHaveProperty(
      'bcnSecurityGeneration',
    )
  })

  it('fails closed after a generation advance without partial writes', async () => {
    const test = convexTest(schema, modules)
    const ids = await test.run(async (ctx) => ({
      advanced: await ctx.db.insert('user', {
        ...legacyUser,
        bcnSecurityGeneration: 1,
      } as never),
      legacy: await ctx.db.insert('user', {
        ...legacyUser,
        email: 'second@example.test',
        id: 'second-user-id',
      } as never),
    }))

    await expect(test.run((ctx) => migrateBeta3UserGeneration(ctx, 'forward'))).rejects.toThrow(
      'AUTH_BETA3_CUTOVER_GENERATION_INVALID',
    )
    await expect(test.run((ctx) => ctx.db.get(ids.legacy))).resolves.not.toHaveProperty(
      'bcnSecurityGeneration',
    )
    await expect(test.run((ctx) => ctx.db.get(ids.advanced))).resolves.toHaveProperty(
      'bcnSecurityGeneration',
      1,
    )
  })

  it('rejects more than 128 users without changing any row', async () => {
    const test = convexTest(schema, modules)
    const first = await test.run(async (ctx) => {
      const firstId = await ctx.db.insert('user', {
        ...legacyUser,
        email: 'existing-0@example.test',
        id: 'user-000',
      } as never)
      for (let index = 1; index < 129; index += 1) {
        await ctx.db.insert('user', {
          ...legacyUser,
          email: `existing-${index}@example.test`,
          id: `user-${String(index).padStart(3, '0')}`,
        } as never)
      }
      return firstId
    })

    await expect(test.run((ctx) => migrateBeta3UserGeneration(ctx, 'forward'))).rejects.toThrow(
      'AUTH_BETA3_CUTOVER_USER_LIMIT',
    )
    await expect(test.run((ctx) => ctx.db.get(first))).resolves.not.toHaveProperty(
      'bcnSecurityGeneration',
    )
  })
})
