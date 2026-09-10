import { convexTest } from 'convex-test'
import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { tables } from '../../src/runtime/convex-auth/component/schema'
import {
  migrateSessionGenerationPage,
  sessionGenerationMatches,
} from '../../src/runtime/convex-auth/session-generation'
import { readAuthSessionAdmission } from '../../src/runtime/convex-auth/workforce/admission'

const modules = import.meta.glob('../fixtures/workforce-root/convex/**/*.ts')

const schema = defineSchema(
  {
    ...tables,
    workspaceMember: defineTable({ authUserId: v.string(), role: v.string() }).index(
      'by_auth_user_id',
      ['authUserId'],
    ),
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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
})
afterEach(() => vi.useRealTimers())

describe('beta.3 session-generation migration', () => {
  it('backfills and rolls back without changing identities, sessions, or app references', async () => {
    const test = convexTest(schema, modules)
    const ids = await test.run(async (ctx) => ({
      member: await ctx.db.insert('workspaceMember', {
        authUserId: legacyUser.id,
        role: 'owner',
      }),
      session: await ctx.db.insert('session', legacySession as never),
      user: await ctx.db.insert('user', legacyUser as never),
    }))

    await expect(
      test.run((ctx) => migrateSessionGenerationPage(ctx, 'user', 'preflight', null)),
    ).resolves.toEqual({ done: true, nextAfter: null, pending: 1, patched: 0, scanned: 1 })
    await expect(
      test.run((ctx) => migrateSessionGenerationPage(ctx, 'session', 'preflight', null)),
    ).resolves.toEqual({ done: true, nextAfter: null, pending: 1, patched: 0, scanned: 1 })

    await expect(
      test.run((ctx) => migrateSessionGenerationPage(ctx, 'session', 'forward', null)),
    ).rejects.toThrow('AUTH_SESSION_GENERATION_MIGRATION_USER_NOT_READY')

    await expect(
      test.run((ctx) => migrateSessionGenerationPage(ctx, 'user', 'forward', null)),
    ).resolves.toEqual({ done: true, nextAfter: null, pending: 0, patched: 1, scanned: 1 })
    await expect(
      test.run((ctx) => migrateSessionGenerationPage(ctx, 'session', 'preflight', null)),
    ).resolves.toEqual({ done: true, nextAfter: null, pending: 1, patched: 0, scanned: 1 })
    await expect(
      test.run((ctx) => migrateSessionGenerationPage(ctx, 'session', 'forward', null)),
    ).resolves.toEqual({ done: true, nextAfter: null, pending: 0, patched: 1, scanned: 1 })

    await expect(
      test.run((ctx) => migrateSessionGenerationPage(ctx, 'user', 'preflight', null)),
    ).resolves.toMatchObject({ pending: 0, patched: 0 })
    await expect(
      test.run((ctx) => migrateSessionGenerationPage(ctx, 'session', 'preflight', null)),
    ).resolves.toMatchObject({ pending: 0, patched: 0 })

    const migrated = await test.run(async (ctx) => ({
      member: await ctx.db.get(ids.member),
      session: await ctx.db.get(ids.session),
      user: await ctx.db.get(ids.user),
    }))
    expect(migrated.user).toMatchObject({
      _id: ids.user,
      id: legacyUser.id,
      bcnSecurityGeneration: 0,
    })
    expect(migrated.session).toMatchObject({
      _id: ids.session,
      id: legacySession.id,
      token: legacySession.token,
      userId: legacyUser.id,
      bcnAssuranceGeneration: 0,
    })
    expect(migrated.member).toEqual({
      _creationTime: expect.any(Number),
      _id: ids.member,
      authUserId: legacyUser.id,
      role: 'owner',
    })
    expect(sessionGenerationMatches(migrated.user!, migrated.session!)).toBe(true)
    await expect(
      test.run((ctx) =>
        readAuthSessionAdmission(
          ctx,
          { sessionId: legacySession.id, userId: legacyUser.id },
          false,
        ),
      ),
    ).resolves.toMatchObject({
      session: { _id: ids.session, id: legacySession.id, token: legacySession.token },
      user: { _id: ids.user, id: legacyUser.id },
    })

    await expect(
      test.run((ctx) => migrateSessionGenerationPage(ctx, 'user', 'rollback', null)),
    ).rejects.toThrow('AUTH_SESSION_GENERATION_MIGRATION_ROLLBACK_ORDER')
    await expect(
      test.run((ctx) => migrateSessionGenerationPage(ctx, 'session', 'rollback', null)),
    ).resolves.toMatchObject({ patched: 1 })
    await expect(
      test.run((ctx) => migrateSessionGenerationPage(ctx, 'user', 'rollback', null)),
    ).resolves.toMatchObject({ patched: 1 })

    const rolledBack = await test.run(async (ctx) => ({
      member: await ctx.db.get(ids.member),
      session: await ctx.db.get(ids.session),
      user: await ctx.db.get(ids.user),
    }))
    expect(rolledBack.user).toEqual({
      _creationTime: expect.any(Number),
      _id: ids.user,
      ...legacyUser,
    })
    expect(rolledBack.session).toEqual({
      _creationTime: expect.any(Number),
      _id: ids.session,
      ...legacySession,
    })
    expect(rolledBack.member).toEqual(migrated.member)
  })

  it('refuses rollback after either generation advances', async () => {
    const test = convexTest(schema, modules)
    await test.run(async (ctx) => {
      await ctx.db.insert('user', { ...legacyUser, bcnSecurityGeneration: 1 } as never)
      await ctx.db.insert('session', { ...legacySession, bcnAssuranceGeneration: 1 } as never)
    })

    await expect(
      test.run((ctx) => migrateSessionGenerationPage(ctx, 'session', 'rollback', null)),
    ).rejects.toThrow('AUTH_SESSION_GENERATION_MIGRATION_ROLLBACK_UNSAFE')
    await expect(
      test.run((ctx) => migrateSessionGenerationPage(ctx, 'user', 'rollback', null)),
    ).rejects.toThrow('AUTH_SESSION_GENERATION_MIGRATION_ROLLBACK_UNSAFE')
  })

  it('refuses a user rollback that cannot prove all sessions were rolled back', async () => {
    const test = convexTest(schema, modules)
    await test.run(async (ctx) => {
      await ctx.db.insert('user', { ...legacyUser, bcnSecurityGeneration: 0 } as never)
      for (let index = 0; index < 129; index += 1) {
        await ctx.db.insert('session', {
          ...legacySession,
          bcnAssuranceGeneration: undefined,
          id: `session-${String(index).padStart(3, '0')}`,
        } as never)
      }
    })

    await expect(
      test.run((ctx) => migrateSessionGenerationPage(ctx, 'user', 'rollback', null)),
    ).rejects.toThrow('AUTH_SESSION_GENERATION_MIGRATION_ROLLBACK_ORDER')
  })

  it('resumes mixed rollback pages and tolerates a lost page response', async () => {
    const test = convexTest(schema, modules)
    await test.run(async (ctx) => {
      for (let index = 0; index < 17; index += 1) {
        await ctx.db.insert('user', {
          ...legacyUser,
          bcnSecurityGeneration: index % 2 === 0 ? 0 : undefined,
          email: `existing-${index}@example.test`,
          id: `user-${String(index).padStart(3, '0')}`,
        } as never)
      }
    })

    const first = await test.run((ctx) =>
      migrateSessionGenerationPage(ctx, 'user', 'rollback', null),
    )
    expect(first).toEqual({
      done: false,
      nextAfter: 'user-015',
      pending: 0,
      patched: 8,
      scanned: 16,
    })

    await expect(
      test.run((ctx) => migrateSessionGenerationPage(ctx, 'user', 'rollback', null)),
    ).resolves.toEqual({
      done: false,
      nextAfter: 'user-015',
      pending: 0,
      patched: 0,
      scanned: 16,
    })
    await expect(
      test.run((ctx) => migrateSessionGenerationPage(ctx, 'user', 'rollback', first.nextAfter)),
    ).resolves.toEqual({ done: true, nextAfter: null, pending: 0, patched: 1, scanned: 1 })
  })

  it('retries mixed session rollback pages from the beginning', async () => {
    const test = convexTest(schema, modules)
    await test.run(async (ctx) => {
      await ctx.db.insert('user', { ...legacyUser, bcnSecurityGeneration: 0 } as never)
      await ctx.db.insert('user', {
        ...legacyUser,
        bcnSecurityGeneration: 0,
        email: 'second@example.test',
        id: 'second-user-id',
      } as never)
      for (let index = 0; index < 129; index += 1) {
        await ctx.db.insert('session', {
          ...legacySession,
          bcnAssuranceGeneration: index % 2 === 0 ? 0 : undefined,
          id: `session-${String(index).padStart(3, '0')}`,
          token: `token-${index}`,
          userId: index < 65 ? legacyUser.id : 'second-user-id',
        } as never)
      }
    })

    const first = await test.run((ctx) =>
      migrateSessionGenerationPage(ctx, 'session', 'rollback', null),
    )
    expect(first).toMatchObject({ done: false, patched: 64, scanned: 128 })
    await expect(
      test.run((ctx) => migrateSessionGenerationPage(ctx, 'session', 'rollback', null)),
    ).resolves.toMatchObject({ done: false, patched: 0, scanned: 128 })
    await expect(
      test.run((ctx) => migrateSessionGenerationPage(ctx, 'session', 'rollback', first.nextAfter)),
    ).resolves.toMatchObject({ done: true, patched: 1, scanned: 1 })
    await expect(
      test.run((ctx) => migrateSessionGenerationPage(ctx, 'user', 'rollback', null)),
    ).resolves.toMatchObject({ done: true, patched: 2 })
  })

  it('fails closed for orphaned sessions, duplicate logical IDs, and mismatched generations', async () => {
    const orphaned = convexTest(schema, modules)
    await orphaned.run((ctx) => ctx.db.insert('session', legacySession as never))
    await expect(
      orphaned.run((ctx) => migrateSessionGenerationPage(ctx, 'session', 'preflight', null)),
    ).rejects.toThrow('AUTH_SESSION_GENERATION_MIGRATION_USER_INVALID')

    const duplicated = convexTest(schema, modules)
    await duplicated.run(async (ctx) => {
      await ctx.db.insert('user', legacyUser as never)
      await ctx.db.insert('user', legacyUser as never)
    })
    await expect(
      duplicated.run((ctx) => migrateSessionGenerationPage(ctx, 'user', 'preflight', null)),
    ).rejects.toThrow('AUTH_SESSION_GENERATION_MIGRATION_LOGICAL_ID_INVALID')

    const mismatched = convexTest(schema, modules)
    await mismatched.run(async (ctx) => {
      await ctx.db.insert('user', { ...legacyUser, bcnSecurityGeneration: 0 } as never)
      await ctx.db.insert('session', { ...legacySession, bcnAssuranceGeneration: 1 } as never)
    })
    await expect(
      mismatched.run((ctx) => migrateSessionGenerationPage(ctx, 'session', 'preflight', null)),
    ).rejects.toThrow('AUTH_SESSION_GENERATION_MIGRATION_GENERATION_INVALID')
  })

  it('uses bounded, resumable pages without returning row contents', async () => {
    const test = convexTest(schema, modules)
    await test.run(async (ctx) => {
      for (let index = 0; index < 129; index += 1) {
        await ctx.db.insert('user', {
          ...legacyUser,
          email: `existing-${index}@example.test`,
          id: `user-${String(index).padStart(3, '0')}`,
        } as never)
      }
    })

    const first = await test.run((ctx) =>
      migrateSessionGenerationPage(ctx, 'user', 'forward', null),
    )
    expect(first).toEqual({
      done: false,
      nextAfter: 'user-127',
      pending: 0,
      patched: 128,
      scanned: 128,
    })
    await expect(
      test.run((ctx) => migrateSessionGenerationPage(ctx, 'user', 'forward', first.nextAfter)),
    ).resolves.toEqual({ done: true, nextAfter: null, pending: 0, patched: 1, scanned: 1 })
  })
})
