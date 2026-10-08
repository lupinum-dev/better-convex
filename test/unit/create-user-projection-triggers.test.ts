import { inspect } from 'node:util'

import { httpRouter } from 'convex/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createAuthComponent } from '../../src/runtime/convex-auth/create-auth-component'
import { createUserProjectionTriggers } from '../../src/runtime/convex-auth/user-projection'

describe('createUserProjectionTriggers', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

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

  /** A scripted `db`: each projection lookup (`take`/`collect`) returns the next listed result. */
  function projectionDb(...lookups: unknown[][]) {
    const insert = vi.fn(async () => 'new-id')
    const patch = vi.fn(async () => undefined)
    const remove = vi.fn(async () => undefined)
    const lookup = vi.fn()
    for (const result of lookups) lookup.mockResolvedValueOnce(result)
    const withIndex = vi.fn(() => ({ collect: lookup, take: lookup }))
    const query = vi.fn(() => ({ withIndex }))
    return {
      ctx: { db: { insert, patch, delete: remove, query } },
      insert,
      lookup,
      patch,
      query,
      remove,
      withIndex,
    }
  }

  const createAuthIdDoc = ({ user, now }: { user: TestAuthUser; now: number }) => ({
    authId: user.id,
    email: user.email,
    createdAt: now,
    updatedAt: now,
  })

  const patchChangedEmail = ({
    user,
    previousUser,
    now,
  }: {
    user: TestAuthUser
    previousUser: TestAuthUser
    now: number
  }) => (user.email === previousUser.email ? null : { email: user.email, updatedAt: now })

  const rebuildChangedEmail = ({
    user,
    existing,
    now,
  }: {
    user: TestAuthUser
    existing: TestProjectionUser
    now: number
  }) => (user.email === existing.email ? null : { email: user.email, updatedAt: now })

  it('inserts, patches, and deletes synced user records', async () => {
    const { ctx, insert, patch, query, remove, withIndex } = projectionDb(
      [],
      [{ _id: 'user-1' }],
      [{ _id: 'user-1' }],
    )
    const triggers = createUserProjectionTriggers<TestAuthUser, TestProjectionUser>({
      table: 'users',
      index: 'by_auth_id',
      createDoc: createAuthIdDoc,
      patchDoc: patchChangedEmail,
      rebuildDoc: rebuildChangedEmail,
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
    expect(withIndex).toHaveBeenCalledWith('by_auth_id', expect.any(Function))
    expect(patch).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ email: 'b@example.com' }),
    )

    await triggers.user.onDelete(ctx, { id: 'auth-1' })
    expect(remove).toHaveBeenCalledWith('user-1')
  })

  // Catches: account deletion leaving the person's app data behind, or erasing after the row is gone.
  it('runs the erase hook for each projection row before deleting it, and only when configured', async () => {
    const { ctx, remove } = projectionDb(
      [{ _id: 'user-1', authId: 'auth-1' }],
      [{ _id: 'user-1', authId: 'auth-1' }],
    )
    const options = { table: 'userProfiles', index: 'by_auth_id', createDoc: createAuthIdDoc }
    const erase = vi.fn(async (_args: { existing: TestProjectionUser }) => {})
    await createUserProjectionTriggers<TestAuthUser, TestProjectionUser>({
      ...options,
      erase,
    }).user.onDelete(ctx, { id: 'auth-1' })
    expect(erase).toHaveBeenCalledOnce()
    expect(erase).toHaveBeenCalledWith(
      expect.objectContaining({
        user: { id: 'auth-1' },
        existing: { _id: 'user-1', authId: 'auth-1' },
      }),
    )
    expect(remove).toHaveBeenCalledWith('user-1')
    expect(erase.mock.invocationCallOrder[0]!).toBeLessThan(remove.mock.invocationCallOrder[0]!)

    erase.mockClear()
    await createUserProjectionTriggers<TestAuthUser, TestProjectionUser>(options).user.onDelete(
      ctx,
      { id: 'auth-1' },
    )
    expect(erase).not.toHaveBeenCalled()
    expect(remove).toHaveBeenCalledTimes(2)
  })

  it('rebuilds user projections from Better Auth users', async () => {
    const { ctx, insert, patch, query, withIndex } = projectionDb(
      [],
      [{ _id: 'user-2', authId: 'auth-2', email: 'old@example.com' }],
      [{ _id: 'user-3', authId: 'auth-3', email: 'c@example.com' }],
    )
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
      rebuildDoc: rebuildChangedEmail,
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
    const { ctx, insert, patch, query } = projectionDb(
      [],
      [{ _id: 'user-1', authId: 'auth-1', email: 'a@example.com' }],
    )
    const triggers = createUserProjectionTriggers<TestAuthUser, TestProjectionUser>({
      table: 'users',
      index: 'by_auth_id',
      createDoc: createAuthIdDoc,
    })

    await triggers.user.onCreate(ctx, { id: 'auth-1', email: 'a@example.com' })
    await triggers.user.onCreate(ctx, { id: 'auth-1', email: 'a@example.com' })

    expect(insert).toHaveBeenCalledTimes(1)
    expect(patch).not.toHaveBeenCalled()
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('rejects ambiguous projections before callbacks or writes and deletes all rows on user deletion', async () => {
    const privateSentinels = [
      'private-auth-id-sentinel',
      'private-first-row-sentinel',
      'private-second-row-sentinel',
    ]
    const duplicates = [
      { _id: 'user-1', authId: privateSentinels[0], email: privateSentinels[1] },
      { _id: 'user-2', authId: privateSentinels[0], email: privateSentinels[2] },
    ]
    const { ctx, insert, lookup, patch, remove } = projectionDb(
      duplicates,
      duplicates,
      duplicates,
      duplicates,
    )
    const createDoc = vi.fn(({ user }: { user: TestAuthUser }) => ({
      authId: user.id,
      email: user.email,
    }))
    const patchDoc = vi.fn(({ user }: { user: TestAuthUser }) => ({ email: user.email }))
    const rebuildDoc = vi.fn(({ user }: { user: TestAuthUser }) => ({ email: user.email }))
    const triggers = createUserProjectionTriggers<TestAuthUser, TestProjectionUser>({
      table: 'users',
      index: 'by_auth_id',
      createDoc,
      patchDoc,
      rebuildDoc,
    })

    const conflict = { data: { code: 'AUTH_USER_PROJECTION_CONFLICT' } }
    const failure = await triggers.user
      .onCreate(ctx, { id: privateSentinels[0]!, email: 'canonical@example.com' })
      .catch((error: unknown) => error)
    expect(failure).toMatchObject(conflict)
    expect(Object.keys((failure as { data: object }).data)).toEqual(['code'])
    const renderedFailure = [String(failure), inspect(failure), JSON.stringify(failure)].join('\n')
    for (const sentinel of privateSentinels) expect(renderedFailure).not.toContain(sentinel)
    await expect(
      triggers.user.onUpdate(
        ctx,
        { id: 'auth-1', email: 'canonical@example.com' },
        { id: 'auth-1', email: 'stale@example.com' },
      ),
    ).rejects.toMatchObject(conflict)
    await expect(
      triggers.user.rebuild(ctx, [{ id: 'auth-1', email: 'canonical@example.com' }]),
    ).rejects.toMatchObject(conflict)
    expect(createDoc).not.toHaveBeenCalled()
    expect(patchDoc).not.toHaveBeenCalled()
    expect(rebuildDoc).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
    expect(patch).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()

    await triggers.user.onDelete(ctx, { id: 'auth-1' })
    expect(remove.mock.calls).toEqual([['user-1'], ['user-2']])
    expect(lookup.mock.calls.slice(0, 3)).toEqual([[2], [2], [2]])
    expect(lookup.mock.calls[3]).toEqual([])
  })

  it('keeps projection conflicts private at the registered auth HTTP boundary', async () => {
    vi.stubEnv('SITE_URL', 'https://app.example.test')
    const privateSentinels = [
      'private-auth-id-sentinel',
      'private-table-sentinel',
      'private-index-sentinel',
      'private-row-sentinel',
      'private-callback-sentinel',
    ]
    const projectionCtx = {
      db: {
        insert: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            collect: vi.fn(),
            take: vi.fn(async () => [
              { _id: 'user-1', private: privateSentinels[3] },
              { _id: 'user-2', private: privateSentinels[3] },
            ]),
          })),
        })),
      },
    }
    const createDoc = vi.fn(() => ({ private: privateSentinels[4] }))
    const projection = createUserProjectionTriggers<TestAuthUser, TestProjectionUser>({
      table: privateSentinels[1]!,
      index: privateSentinels[2]!,
      createDoc,
    })
    const component = createAuthComponent({ adapter: {} } as never)
    const http = httpRouter()
    component.registerRoutes(http, async () => {
      await projection.user.onCreate(projectionCtx, {
        id: privateSentinels[0]!,
        email: 'private-email-sentinel',
      })
      throw new Error('Projection conflict did not abort auth creation')
    })
    const route = http.lookup('/api/auth/get-session', 'GET')
    if (!route) throw new Error('Auth route was not registered')
    const handler = route[0] as (typeof route)[0] & {
      _handler: (ctx: unknown, request: Request) => Promise<Response>
    }
    const logSpies = [
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
    ]

    const response = await handler._handler(
      { meta: { getRequestMetadata: vi.fn(async () => ({ ip: '198.51.100.10' })) } },
      new Request('https://deployment.convex.site/api/auth/get-session'),
    )
    const publicSurface = JSON.stringify({
      body: await response.json(),
      headers: [...response.headers],
      logs: logSpies.flatMap((spy) => spy.mock.calls),
    })

    expect(response.status).toBe(500)
    expect(publicSurface).toContain('AUTH_CONFIG_INVALID')
    for (const sentinel of [...privateSentinels, 'private-email-sentinel']) {
      expect(publicSurface).not.toContain(sentinel)
    }
    expect(createDoc).not.toHaveBeenCalled()
  })

  it('creates from the current update snapshot when onUpdate arrives before onCreate', async () => {
    const { ctx, insert, patch } = projectionDb([], [{ _id: 'user-1', authId: 'auth-1' }])
    const triggers = createUserProjectionTriggers<TestAuthUser, TestProjectionUser>({
      table: 'users',
      index: 'by_auth_id',
      createDoc: createAuthIdDoc,
      patchDoc: patchChangedEmail,
    })

    await triggers.user.onUpdate(
      ctx,
      { id: 'auth-1', email: 'updated@example.com' },
      { id: 'auth-1', email: 'original@example.com' },
    )
    expect(patch).not.toHaveBeenCalled()
    expect(insert).toHaveBeenCalledTimes(1)
    expect(insert).toHaveBeenCalledWith(
      'users',
      expect.objectContaining({ authId: 'auth-1', email: 'updated@example.com' }),
    )

    await triggers.user.onCreate(ctx, { id: 'auth-1', email: 'original@example.com' })
    expect(insert).toHaveBeenCalledTimes(1)
    expect(patch).not.toHaveBeenCalled()
  })

  it('does not overwrite existing projection rows during rebuild without an explicit rebuild patch', async () => {
    const { ctx, insert, patch } = projectionDb([{ _id: 'user-1', authId: 'auth-1' }])
    const triggers = createUserProjectionTriggers<TestAuthUser, TestProjectionUser>({
      table: 'users',
      index: 'by_auth_id',
      createDoc: createAuthIdDoc,
    })

    await expect(
      triggers.user.rebuild(ctx, [{ id: 'auth-1', email: 'changed@example.com' }]),
    ).resolves.toEqual({ inserted: 0, patched: 0, skipped: 1 })
    expect(insert).not.toHaveBeenCalled()
    expect(patch).not.toHaveBeenCalled()
  })

  it('owns the indexed auth id even when projection callbacks omit or misstate it', async () => {
    const existing = [{ _id: 'user-1', authUserId: 'auth-1' }]
    const { ctx, insert, patch } = projectionDb([], existing, existing)
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

  it.each([
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
  ])('rejects the invalid Convex projection key %j', (authIdField) => {
    expect(() =>
      createUserProjectionTriggers<TestAuthUser, TestProjectionUser>({
        table: 'users',
        index: 'by_auth_id',
        authIdField,
        createDoc: () => ({}),
      }),
    ).toThrow('[better-convex-nuxt] authIdField must be a valid top-level Convex application field')
  })
})
