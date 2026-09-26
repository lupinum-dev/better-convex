import { signInAs } from '@lupinum/better-convex-nuxt/better-auth/test'
import { describe, expect, it } from 'vitest'

import { api } from './_generated/api'
import { initConvexTest } from './test.setup'

describe('playground public-operation authorization matrix', () => {
  it('models signed-out and platform-rejected expired tokens as a missing identity', async () => {
    const t = initConvexTest()
    const taskId = await t.run(async (ctx) => {
      return await ctx.db.insert('tasks', {
        userId: 'user_owner',
        title: 'owner task',
        completed: false,
        createdAt: Date.now(),
      })
    })

    // Invalid or expired Convex JWTs are rejected before a function runs. The
    // function-level state available to convex-test is therefore no identity.
    expect(await t.query(api.auth.getPermissionContext, {})).toBeNull()
    expect(await t.query(api.users.getCurrentUser, {})).toBeNull()
    expect(await t.query(api.tasks.list, {})).toEqual([])
    await expect(t.mutation(api.tasks.add, { title: 'anonymous' })).rejects.toThrow(
      'Authentication required',
    )
    await expect(t.mutation(api.tasks.toggle, { id: taskId })).rejects.toThrow(
      'Authentication required',
    )
    await expect(t.mutation(api.tasks.remove, { id: taskId })).rejects.toThrow(
      'Authentication required',
    )
  })

  it('denies a token whose Better Auth session is not live', async () => {
    const t = initConvexTest()
    await signInAs(t, 'user_owner')

    for (const identity of [
      { subject: 'user_owner' },
      { subject: 'user_owner', sid: 'user_owner-session' },
      { subject: 'user_owner', sid: 'user_owner-session', token_use: 'oauth-access' },
      { subject: 'user_owner', sid: 'revoked-session', token_use: 'convex-session' },
    ]) {
      const caller = t.withIdentity(identity)
      expect(await caller.query(api.auth.getPermissionContext, {})).toBeNull()
      expect(await caller.query(api.tasks.list, {})).toEqual([])
      await expect(caller.mutation(api.tasks.add, { title: 'stale' })).rejects.toThrow(
        'Authentication required',
      )
    }
  })

  it('returns the caller identity and projection without leaking another user', async () => {
    const t = initConvexTest()
    await t.run(async (ctx) => {
      const now = Date.now()
      await ctx.db.insert('users', {
        authId: 'user_owner',
        displayName: 'Owner',
        email: 'owner@example.test',
        createdAt: now,
        updatedAt: now,
      })
      await ctx.db.insert('users', {
        authId: 'user_other',
        displayName: 'Other',
        email: 'other@example.test',
        createdAt: now,
        updatedAt: now,
      })
    })

    const asOwner = await signInAs(t, 'user_owner')
    expect(await asOwner.query(api.auth.getPermissionContext, {})).toEqual({
      role: 'member',
      userId: 'user_owner',
    })
    expect(await asOwner.query(api.users.getCurrentUser, {})).toMatchObject({
      authId: 'user_owner',
      displayName: 'Owner',
    })
    expect(
      await (await signInAs(t, 'missing_projection')).query(api.users.getCurrentUser, {}),
    ).toBeNull()
  })

  it('isolates task reads and rejects cross-user object mutation', async () => {
    const t = initConvexTest()
    const asOwner = await signInAs(t, 'user_owner')
    const asOther = await signInAs(t, 'user_other')
    const ownerTaskId = await asOwner.mutation(api.tasks.add, { title: 'owner task' })
    await asOther.mutation(api.tasks.add, { title: 'other task' })

    expect((await asOwner.query(api.tasks.list, {})).map((task) => task.title)).toEqual([
      'owner task',
    ])
    expect((await asOther.query(api.tasks.list, {})).map((task) => task.title)).toEqual([
      'other task',
    ])
    await expect(asOther.mutation(api.tasks.toggle, { id: ownerTaskId })).rejects.toThrow(
      'Not authorized',
    )
    await expect(asOther.mutation(api.tasks.remove, { id: ownerTaskId })).rejects.toThrow(
      'Not authorized',
    )
    expect(await t.run(async (ctx) => await ctx.db.get(ownerTaskId))).toMatchObject({
      userId: 'user_owner',
      completed: false,
    })
  })

  it('keeps notes intentionally anonymous while bounding public pagination and payloads', async () => {
    const t = initConvexTest()

    // Notes deliberately have no owner field in this public playground, so
    // cross-user authorization is N/A. Anonymous behavior is the contract.
    const firstId = await t.mutation(api.notes.add, { title: 'First', content: 'Public' })
    await t.mutation(api.notes.add, { title: 'Second', content: 'Public' })

    const ascending = await t.query(api.notes.listPaginatedAsc, {
      paginationOpts: { cursor: null, numItems: 2 },
    })
    expect(ascending.page.map((note) => note.title)).toEqual(['First', 'Second'])
    expect((await t.query(api.notes.listDelayed, {})).map((note) => note.title)).toEqual([
      'Second',
      'First',
    ])
    await expect(
      t.query(api.notes.listPaginatedAsc, {
        paginationOpts: { cursor: null, numItems: 51 },
      }),
    ).rejects.toThrow('Page size must be an integer from 1 to 50')
    await expect(t.query(api.notes.search, { query: 'x'.repeat(101) })).rejects.toThrow(
      'Search query must be 100 characters or less',
    )

    await t.mutation(api.notes.remove, { id: firstId })
    expect(await t.query(api.notes.get, { id: firstId })).toBeNull()
  })

  it('keeps test probes intentionally anonymous and bounds echoed action input', async () => {
    const t = initConvexTest()

    // These probes intentionally exercise anonymous query/mutation/action
    // transport behavior; no user-owned object exists for cross-user denial.
    expect(await t.query(api.testing.healthCheck, {})).toMatchObject({ ok: true })
    await expect(t.query(api.testing.alwaysFails, {})).rejects.toThrow(
      'Intentional test error for E2E testing',
    )
    await expect(t.mutation(api.testing.alwaysFailsMutation, {})).rejects.toThrow(
      'Intentional mutation error for E2E testing',
    )
    await expect(t.action(api.testing.alwaysFailsAction, {})).rejects.toThrow(
      'Intentional action error for E2E testing',
    )
    expect(await t.action(api.testing.echo, { message: '  bounded echo  ' })).toMatchObject({
      echoed: 'bounded echo',
    })
    await expect(t.action(api.testing.echo, { message: '   ' })).rejects.toThrow(
      'Message must be between 1 and 5000 characters',
    )
    await expect(t.action(api.testing.echo, { message: 'x'.repeat(5_001) })).rejects.toThrow(
      'Message must be between 1 and 5000 characters',
    )
  })
})
