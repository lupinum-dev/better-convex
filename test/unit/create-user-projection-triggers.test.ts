import { describe, expect, it, vi } from 'vitest'

import { createUserProjectionTriggers } from '../../src/runtime/convex-auth/user-projection'

describe('createUserProjectionTriggers', () => {
  type TestAuthUser = {
    id: string
    email?: string | null
  }

  type TestProjectionUser = {
    _id: string
    authId?: string
    authUserId?: string
    email?: string | null
  }

  it('inserts, patches, and deletes synced user records', async () => {
    const insert = vi.fn(async () => 'new-id')
    const patch = vi.fn(async () => undefined)
    const remove = vi.fn(async () => undefined)
    const collect = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ _id: 'user-1' }])
      .mockResolvedValueOnce([{ _id: 'user-1' }])
    const withIndex = vi.fn(() => ({ collect }))
    const query = vi.fn(() => ({ withIndex }))

    const ctx = {
      db: {
        insert,
        patch,
        delete: remove,
        query,
      },
    }

    const triggers = createUserProjectionTriggers<TestAuthUser, TestProjectionUser>({
      table: 'users',
      index: 'by_auth_id',
      createDoc: ({ user, now }) => ({
        authId: user.id,
        email: user.email,
        createdAt: now,
        updatedAt: now,
      }),
      patchDoc: ({ user, previousUser, now }) => {
        if (user.email === previousUser.email) return null
        return { email: user.email, updatedAt: now }
      },
      rebuildDoc: ({ user, existing, now }) => {
        if (user.email === existing.email) return null
        return { email: user.email, updatedAt: now }
      },
    })

    await triggers.user.onCreate(ctx, { id: 'auth-1', email: 'a@example.com' })
    expect(insert).toHaveBeenCalledWith(
      'users',
      expect.objectContaining({ authId: 'auth-1', email: 'a@example.com' }),
    )

    await triggers.user.onUpdate(
      ctx,
      { id: 'auth-1', email: 'b@example.com' },
      { id: 'auth-1', email: 'a@example.com' },
    )
    expect(query).toHaveBeenCalledWith('users')
    expect(withIndex).toHaveBeenCalled()
    expect(patch).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ email: 'b@example.com' }),
    )

    await triggers.user.onDelete(ctx, { id: 'auth-1' })
    expect(remove).toHaveBeenCalledWith('user-1')
  })

  it('rebuilds user projections from Better Auth users', async () => {
    const insert = vi.fn(async () => 'new-id')
    const patch = vi.fn(async () => undefined)
    const collect = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ _id: 'user-2', authId: 'auth-2', email: 'old@example.com' }])
      .mockResolvedValueOnce([{ _id: 'user-3', authId: 'auth-3', email: 'c@example.com' }])
    const withIndex = vi.fn(() => ({ collect }))
    const query = vi.fn(() => ({ withIndex }))

    const ctx = {
      db: {
        insert,
        patch,
        delete: vi.fn(),
        query,
      },
    }

    const triggers = createUserProjectionTriggers<TestAuthUser, TestProjectionUser>({
      table: 'userProfiles',
      index: 'by_auth_user_id',
      authIdField: 'authUserId',
      createDoc: ({ user, now }) => ({
        authUserId: user.id,
        email: user.email,
        createdAt: now,
        updatedAt: now,
      }),
      rebuildDoc: ({ user, existing, now }) => {
        if (user.email === existing.email) return null
        return { email: user.email, updatedAt: now }
      },
    })

    const result = await triggers.user.rebuild(ctx, [
      { id: 'auth-1', email: 'a@example.com' },
      { id: 'auth-2', email: 'b@example.com' },
      { id: 'auth-3', email: 'c@example.com' },
    ])

    expect(result).toEqual({ inserted: 1, patched: 1, skipped: 1 })
    expect(insert).toHaveBeenCalledWith(
      'userProfiles',
      expect.objectContaining({ authUserId: 'auth-1', email: 'a@example.com' }),
    )
    expect(patch).toHaveBeenCalledWith(
      'user-2',
      expect.objectContaining({ email: 'b@example.com' }),
    )
    expect(query).toHaveBeenCalledTimes(3)
    expect(withIndex).toHaveBeenCalledWith('by_auth_user_id', expect.any(Function))
  })

  it('does not insert duplicate projection rows for repeated create events', async () => {
    const insert = vi.fn(async () => 'new-id')
    const patch = vi.fn(async () => undefined)
    const collect = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ _id: 'user-1', authId: 'auth-1', email: 'a@example.com' }])
    const withIndex = vi.fn(() => ({ collect }))
    const query = vi.fn(() => ({ withIndex }))

    const ctx = {
      db: {
        insert,
        patch,
        delete: vi.fn(),
        query,
      },
    }

    const triggers = createUserProjectionTriggers<TestAuthUser, TestProjectionUser>({
      table: 'users',
      index: 'by_auth_id',
      createDoc: ({ user, now }) => ({
        authId: user.id,
        email: user.email,
        createdAt: now,
        updatedAt: now,
      }),
    })

    await triggers.user.onCreate(ctx, { id: 'auth-1', email: 'a@example.com' })
    await triggers.user.onCreate(ctx, { id: 'auth-1', email: 'a@example.com' })

    expect(insert).toHaveBeenCalledTimes(1)
    expect(patch).not.toHaveBeenCalled()
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('collapses duplicate projections and deletes every copy with the auth user', async () => {
    const insert = vi.fn(async () => 'new-id')
    const patch = vi.fn(async () => undefined)
    const remove = vi.fn(async () => undefined)
    const duplicates = [
      { _id: 'user-1', authId: 'auth-1', email: 'stale@example.com' },
      { _id: 'user-2', authId: 'auth-1', email: 'copied@example.com' },
    ]
    const collect = vi
      .fn()
      .mockResolvedValueOnce(duplicates)
      .mockResolvedValueOnce(duplicates)
      .mockResolvedValueOnce(duplicates)
    const withIndex = vi.fn(() => ({ collect }))
    const ctx = {
      db: {
        insert,
        patch,
        delete: remove,
        query: vi.fn(() => ({ withIndex })),
      },
    }

    const triggers = createUserProjectionTriggers<TestAuthUser, TestProjectionUser>({
      table: 'users',
      index: 'by_auth_id',
      createDoc: ({ user }) => ({ authId: user.id, email: user.email }),
      patchDoc: ({ user }) => ({ email: user.email }),
      rebuildDoc: ({ user }) => ({ email: user.email }),
    })

    await triggers.user.onCreate(ctx, { id: 'auth-1', email: 'canonical@example.com' })
    expect(remove).toHaveBeenCalledWith('user-2')
    expect(insert).not.toHaveBeenCalled()

    remove.mockClear()
    await triggers.user.rebuild(ctx, [{ id: 'auth-1', email: 'canonical@example.com' }])
    expect(remove).toHaveBeenCalledWith('user-2')
    expect(patch).toHaveBeenCalledWith('user-1', {
      authId: 'auth-1',
      email: 'canonical@example.com',
    })

    remove.mockClear()
    await triggers.user.onDelete(ctx, { id: 'auth-1' })
    expect(remove.mock.calls).toEqual([['user-1'], ['user-2']])
  })

  it('no-ops onUpdate arriving before onCreate for the same user', async () => {
    // Documents the current, intentional behavior (see the onUpdate JSDoc):
    // out-of-order delivery (onUpdate before onCreate) finds no existing
    // projection row and silently drops the update rather than queuing or
    // retrying it. The row is later created by onCreate, but from that
    // event's own payload, not the dropped update's fields.
    const insert = vi.fn(async () => 'new-id')
    const patch = vi.fn(async () => undefined)
    const collect = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([])
    const withIndex = vi.fn(() => ({ collect }))
    const query = vi.fn(() => ({ withIndex }))

    const ctx = {
      db: {
        insert,
        patch,
        delete: vi.fn(),
        query,
      },
    }

    const triggers = createUserProjectionTriggers<TestAuthUser, TestProjectionUser>({
      table: 'users',
      index: 'by_auth_id',
      createDoc: ({ user, now }) => ({
        authId: user.id,
        email: user.email,
        createdAt: now,
        updatedAt: now,
      }),
      patchDoc: ({ user, previousUser, now }) => {
        if (user.email === previousUser.email) return null
        return { email: user.email, updatedAt: now }
      },
    })

    // onUpdate arrives first — no projection row exists yet.
    await triggers.user.onUpdate(
      ctx,
      { id: 'auth-1', email: 'updated@example.com' },
      { id: 'auth-1', email: 'original@example.com' },
    )
    expect(patch).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()

    // onCreate arrives afterward, using its own (not the dropped update's) payload.
    await triggers.user.onCreate(ctx, { id: 'auth-1', email: 'original@example.com' })
    expect(insert).toHaveBeenCalledTimes(1)
    expect(insert).toHaveBeenCalledWith(
      'users',
      expect.objectContaining({ authId: 'auth-1', email: 'original@example.com' }),
    )
    // The dropped update's 'updated@example.com' never lands anywhere.
    expect(patch).not.toHaveBeenCalled()
  })

  it('does not overwrite existing projection rows during rebuild without an explicit rebuild patch', async () => {
    const insert = vi.fn(async () => 'new-id')
    const patch = vi.fn(async () => undefined)
    const collect = vi.fn().mockResolvedValueOnce([{ _id: 'user-1', authId: 'auth-1' }])
    const withIndex = vi.fn(() => ({ collect }))
    const query = vi.fn(() => ({ withIndex }))

    const ctx = {
      db: {
        insert,
        patch,
        delete: vi.fn(),
        query,
      },
    }

    const triggers = createUserProjectionTriggers<TestAuthUser, TestProjectionUser>({
      table: 'userProfiles',
      index: 'by_auth_user_id',
      createDoc: ({ user, now }) => ({
        authUserId: user.id,
        email: user.email,
        createdAt: now,
        updatedAt: now,
      }),
    })

    await expect(
      triggers.user.rebuild(ctx, [{ id: 'auth-1', email: 'changed@example.com' }]),
    ).resolves.toEqual({ inserted: 0, patched: 0, skipped: 1 })
    expect(insert).not.toHaveBeenCalled()
    expect(patch).not.toHaveBeenCalled()
  })

  it('owns the indexed auth id even when projection callbacks omit or misstate it', async () => {
    const insert = vi.fn(async () => 'new-id')
    const patch = vi.fn(async () => undefined)
    const collect = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ _id: 'user-1', authUserId: 'auth-1' }])
      .mockResolvedValueOnce([{ _id: 'user-1', authUserId: 'auth-1' }])
    const withIndex = vi.fn(() => ({ collect }))
    const ctx = {
      db: {
        insert,
        patch,
        delete: vi.fn(),
        query: vi.fn(() => ({ withIndex })),
      },
    }

    const triggers = createUserProjectionTriggers<TestAuthUser, TestProjectionUser>({
      table: 'userProfiles',
      index: 'by_auth_user_id',
      authIdField: 'authUserId',
      createDoc: ({ user }) => ({
        authUserId: 'caller-controlled-create-id',
        email: user.email,
      }),
      patchDoc: () => ({ authUserId: 'caller-controlled-update-id' }),
      rebuildDoc: () => ({ authUserId: 'caller-controlled-rebuild-id' }),
    })

    await triggers.user.onCreate(ctx, { id: 'auth-1', email: 'a@example.com' })
    await triggers.user.onUpdate(
      ctx,
      { id: 'auth-1', email: 'b@example.com' },
      { id: 'auth-1', email: 'a@example.com' },
    )
    await triggers.user.rebuild(ctx, [{ id: 'auth-1', email: 'b@example.com' }])

    expect(insert).toHaveBeenCalledWith('userProfiles', {
      authUserId: 'auth-1',
      email: 'a@example.com',
    })
    expect(patch.mock.calls).toEqual([
      ['user-1', { authUserId: 'auth-1' }],
      ['user-1', { authUserId: 'auth-1' }],
    ])
  })

  it('rejects invalid Convex top-level application fields as projection keys', () => {
    for (const authIdField of [
      '',
      '_id',
      '_creationTime',
      '_authId',
      '$authId',
      '__proto__',
      'prototype',
      'constructor',
      'nested.authId',
      'auth\u0000Id',
      'authéId',
      'a'.repeat(1025),
    ]) {
      expect(() =>
        createUserProjectionTriggers<TestAuthUser, TestProjectionUser>({
          table: 'users',
          index: 'by_auth_id',
          authIdField,
          createDoc: () => ({}),
        }),
      ).toThrow(
        '[better-convex-nuxt] authIdField must be a valid top-level Convex application field',
      )
    }
  })
})
