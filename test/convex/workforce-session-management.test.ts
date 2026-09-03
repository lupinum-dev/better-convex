/// <reference types="vite/client" />

import { convexTest } from 'convex-test'
import { anyApi, type ApiFromModules } from 'convex/server'
import type { Infer } from 'convex/values'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readAuthSessionAdmission } from '../../src/runtime/convex-auth/workforce/admission'
import { workforceSessionPolicy } from '../../src/runtime/convex-auth/workforce/operations'
import schema, { type tables } from '../fixtures/workforce-component/convex/betterAuth/schema'
import type * as sessionManagement from '../fixtures/workforce-component/convex/betterAuth/sessionManagement'

const api = anyApi as unknown as ApiFromModules<{ sessionManagement: typeof sessionManagement }>
const functions = api.sessionManagement
const modules = import.meta.glob('../fixtures/workforce-component/convex/betterAuth/**/*.ts')
const now = 1_700_000_000_000
const minute = 60_000
const actor = { userId: 'user', sessionId: 'actor' }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
})
afterEach(() => vi.useRealTimers())

function session(id: string, overrides: Partial<Infer<typeof tables.session.validator>> = {}) {
  return {
    id,
    userId: 'user',
    token: `private-test-token-${id}`,
    createdAt: now - 10 * minute,
    updatedAt: now - 10 * minute,
    expiresAt: now + 30 * minute,
    ipAddress: '192.0.2.1',
    userAgent: 'private-test-agent',
    bcnAssuranceGeneration: 3,
    bcnAssuranceMethod: 'password-totp',
    bcnAuthenticatedAt: now - 10 * minute,
    bcnSessionStartedAt: now - 10 * minute,
    ...overrides,
  }
}

async function init() {
  const test = convexTest(schema, modules)
  const ids = await test.run(async (ctx) => {
    const user = await ctx.db.insert('user', {
      id: 'user',
      name: 'User',
      email: 'user@example.test',
      emailVerified: true,
      image: null,
      twoFactorEnabled: true,
      createdAt: now,
      updatedAt: now,
      bcnSecurityGeneration: 3,
    })
    const other = await ctx.db.insert('user', {
      id: 'other',
      name: 'Other',
      email: 'other@example.test',
      emailVerified: true,
      image: null,
      twoFactorEnabled: true,
      createdAt: now,
      updatedAt: now,
      bcnSecurityGeneration: 3,
    })
    return {
      user,
      other,
      actor: await ctx.db.insert('session', session('actor')),
      second: await ctx.db.insert('session', session('second')),
      foreign: await ctx.db.insert('session', session('foreign', { userId: 'other' })),
      challenge: await ctx.db.insert('verification', {
        id: 'primary-challenge',
        identifier: 'private-test-challenge',
        value: 'user',
        expiresAt: now + minute,
        createdAt: now,
        updatedAt: now,
        bcnAssuranceGeneration: 3,
      }),
    }
  })
  return { test, ids }
}

describe('workforce foreground session touch', () => {
  it('extends only idle expiry and needs current full assurance, not a new five-minute ceremony', async () => {
    const { test, ids } = await init()
    const before = await test.run((ctx) => ctx.db.get(ids.actor))
    const result = await test.mutation(functions.touch, { actor })
    expect(result).toEqual({ expiresAt: now + 60 * minute })
    expect(await test.run((ctx) => ctx.db.get(ids.actor))).toEqual({ ...before, ...result })
  })

  it('never extends the twelve-hour absolute boundary', async () => {
    const { test, ids } = await init()
    const start = now - workforceSessionPolicy.absoluteLifetimeMs + minute
    await test.run((ctx) => ctx.db.patch(ids.actor, { bcnSessionStartedAt: start }))
    expect(await test.mutation(functions.touch, { actor })).toEqual({ expiresAt: now + minute })
  })

  it.each([-1, 0, 1])('handles touch at idle expiry offset %s without revival', async (offset) => {
    const { test, ids } = await init()
    await test.run((ctx) => ctx.db.patch(ids.actor, { expiresAt: now + offset }))
    const change = test.mutation(functions.touch, { actor })
    if (offset > 0) await expect(change).resolves.toEqual({ expiresAt: now + 60 * minute })
    else await expect(change).rejects.toThrow('AUTH_WORKFORCE_SESSION_REQUIRED')
  })

  it.each(['password-only', 'totp-enrollment', 'password-recovery', 'none'])(
    'rejects restricted %s actor',
    async (method) => {
      const { test, ids } = await init()
      await test.run((ctx) => ctx.db.patch(ids.actor, { bcnAssuranceMethod: method }))
      await expect(test.mutation(functions.touch, { actor })).rejects.toThrow(
        'AUTH_WORKFORCE_SESSION_REQUIRED',
      )
    },
  )

  it('rejects stale generation, wrong owner, unverified mailbox and absolute expiry', async () => {
    for (const scenario of ['stale', 'owner', 'mailbox', 'absolute']) {
      const { test, ids } = await init()
      await test.run(async (ctx) => {
        if (scenario === 'stale') await ctx.db.patch(ids.user, { bcnSecurityGeneration: 4 })
        if (scenario === 'owner') await ctx.db.patch(ids.actor, { userId: 'other' })
        if (scenario === 'mailbox') await ctx.db.patch(ids.user, { emailVerified: false })
        if (scenario === 'absolute')
          await ctx.db.patch(ids.actor, {
            bcnSessionStartedAt: now - workforceSessionPolicy.absoluteLifetimeMs,
          })
      })
      await expect(test.mutation(functions.touch, { actor })).rejects.toThrow(
        'AUTH_WORKFORCE_SESSION_REQUIRED',
      )
    }
  })
})

describe('credential-free session listing', () => {
  it('returns only explicit summary fields and excludes foreign/stale/expired rows', async () => {
    const { test, ids } = await init()
    await test.run(async (ctx) => {
      await ctx.db.patch(ids.second, { bcnAssuranceMethod: 'password-recovery' })
      await ctx.db.insert('session', session('stale', { bcnAssuranceGeneration: 2 }))
      await ctx.db.insert('session', session('expired', { expiresAt: now }))
      await ctx.db.insert(
        'session',
        session('invalid-method', { bcnAssuranceMethod: 'private-test-secret' }),
      )
    })
    const result = await test.query(functions.list, {
      actor,
      paginationOpts: { cursor: null, numItems: 50 },
    })
    expect(result.page.map((row) => row.sessionId).sort()).toEqual(['actor', 'second'])
    for (const row of result.page) {
      expect(Object.keys(row).sort()).toEqual([
        'authenticatedAt',
        'expiresAt',
        'isCurrent',
        'method',
        'sessionId',
        'sessionStartedAt',
      ])
      expect(row.isCurrent).toBe(row.sessionId === actor.sessionId)
    }
    expect(JSON.stringify(result)).not.toContain('private-test')
    expect(JSON.stringify(result)).not.toContain('192.0.2.1')
  })

  it('paginates the indexed result and rejects unbounded page sizes', async () => {
    const { test } = await init()
    const first = await test.query(functions.list, {
      actor,
      paginationOpts: { cursor: null, numItems: 1 },
    })
    expect(first.page).toHaveLength(1)
    expect(first.isDone).toBe(false)
    const second = await test.query(functions.list, {
      actor,
      paginationOpts: { cursor: first.continueCursor, numItems: 1 },
    })
    expect(second.page).toHaveLength(1)
    expect(second.page[0]?.sessionId).not.toBe(first.page[0]?.sessionId)
    for (const numItems of [0, -1, 0.5, 51])
      await expect(
        test.query(functions.list, { actor, paginationOpts: { cursor: null, numItems } }),
      ).rejects.toThrow('AUTH_WORKFORCE_SESSION_PAGE_INVALID')
  })
})

describe('atomic owned-session revocation', () => {
  it('revokes exactly one owned target without invalidating other sessions', async () => {
    const { test, ids } = await init()
    expect(await test.mutation(functions.revoke, { actor, targetSessionId: 'second' })).toBeNull()
    expect(await test.run((ctx) => ctx.db.get(ids.second))).toBeNull()
    expect(await test.run((ctx) => ctx.db.get(ids.actor))).not.toBeNull()
    expect((await test.run((ctx) => ctx.db.get(ids.user)))?.bcnSecurityGeneration).toBe(3)
  })

  it('makes missing and foreign targets indistinguishable without deleting foreign data', async () => {
    const { test, ids } = await init()
    const before = await test.run((ctx) => ctx.db.get(ids.foreign))
    for (const targetSessionId of ['foreign', 'missing'])
      expect(await test.mutation(functions.revoke, { actor, targetSessionId })).toBeNull()
    expect(await test.run((ctx) => ctx.db.get(ids.foreign))).toEqual(before)
  })

  it('requires a live actor again inside each management mutation/query', async () => {
    const { test, ids } = await init()
    await test.run((ctx) => ctx.db.delete(ids.actor))
    await expect(
      test.mutation(functions.revoke, { actor, targetSessionId: 'second' }),
    ).rejects.toThrow('AUTH_WORKFORCE_SESSION_REQUIRED')
    await expect(test.mutation(functions.revokeAll, { actor })).rejects.toThrow(
      'AUTH_WORKFORCE_SESSION_REQUIRED',
    )
    await expect(
      test.query(functions.list, { actor, paginationOpts: { cursor: null, numItems: 10 } }),
    ).rejects.toThrow('AUTH_WORKFORCE_SESSION_REQUIRED')
    expect(await test.run((ctx) => ctx.db.get(ids.second))).not.toBeNull()
  })

  it('invalidates all old proofs/challenges, deletes actor only, and permits later fresh proof', async () => {
    const { test, ids } = await init()
    await test.mutation(functions.revokeAll, { actor })
    expect(await test.run((ctx) => ctx.db.get(ids.actor))).toBeNull()
    const user = await test.run((ctx) => ctx.db.get(ids.user))
    expect(user?.bcnSecurityGeneration).toBe(4)
    expect((await test.run((ctx) => ctx.db.get(ids.challenge)))?.bcnAssuranceGeneration).toBe(3)
    expect(
      await test.run((ctx) =>
        readAuthSessionAdmission(ctx, { userId: 'user', sessionId: 'second' }, true),
      ),
    ).toBeNull()
    expect(await test.run((ctx) => ctx.db.get(ids.foreign))).not.toBeNull()
    await test.run((ctx) =>
      ctx.db.insert('session', session('later', { bcnAssuranceGeneration: 4 })),
    )
    expect(
      await test.run((ctx) =>
        readAuthSessionAdmission(ctx, { userId: 'user', sessionId: 'later' }, true),
      ),
    ).not.toBeNull()
  })

  it('rolls back both generation and actor deletion if the containing mutation fails', async () => {
    const { test, ids } = await init()
    await expect(test.mutation(functions.revokeAllThenFail, { actor })).rejects.toThrow(
      'TEST_SESSION_REVOKE_ROLLBACK',
    )
    expect((await test.run((ctx) => ctx.db.get(ids.user)))?.bcnSecurityGeneration).toBe(3)
    expect(await test.run((ctx) => ctx.db.get(ids.actor))).not.toBeNull()
  })

  it('cannot resurrect a self-revoked session when touch competes', async () => {
    const { test, ids } = await init()
    await Promise.allSettled([
      test.mutation(functions.touch, { actor }),
      test.mutation(functions.revoke, { actor, targetSessionId: actor.sessionId }),
    ])
    expect(await test.run((ctx) => ctx.db.get(ids.actor))).toBeNull()
  })
})

describe('canonical expiry-chain decision', () => {
  it('returns the touched deadline instead of deleting at the old deadline', async () => {
    const { test, ids } = await init()
    await test.mutation(functions.touch, { actor })
    vi.setSystemTime(now + 30 * minute)
    expect(await test.mutation(functions.expire, { storageId: ids.actor })).toBe(now + 60 * minute)
    expect(await test.run((ctx) => ctx.db.get(ids.actor))).not.toBeNull()
    vi.setSystemTime(now + 60 * minute)
    expect(await test.mutation(functions.expire, { storageId: ids.actor })).toBeNull()
    expect(await test.run((ctx) => ctx.db.get(ids.actor))).toBeNull()
  })

  it('cannot delete a replacement logical session through an old storage ID', async () => {
    const { test, ids } = await init()
    const replacement = await test.run(async (ctx) => {
      await ctx.db.delete(ids.actor)
      return ctx.db.insert('session', session('actor'))
    })
    expect(await test.mutation(functions.expire, { storageId: ids.actor })).toBeNull()
    expect(await test.run((ctx) => ctx.db.get(replacement))).not.toBeNull()
  })

  it('enforces the absolute cap and removes malformed deadlines', async () => {
    for (const startedAt of [0, now - workforceSessionPolicy.absoluteLifetimeMs]) {
      const { test, ids } = await init()
      await test.run((ctx) =>
        ctx.db.patch(ids.actor, { bcnSessionStartedAt: startedAt, expiresAt: now + minute }),
      )
      expect(await test.mutation(functions.expire, { storageId: ids.actor })).toBeNull()
      expect(await test.run((ctx) => ctx.db.get(ids.actor))).toBeNull()
    }
  })
})
