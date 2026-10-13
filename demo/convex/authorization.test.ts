import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'

import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'
import { modules } from './test.setup'

async function storeFileWithContentType(
  t: ReturnType<typeof convexTest>,
  contents: string,
  contentType: string,
) {
  return await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob([contents], { type: contentType }))
    // convex-test 0.0.41 omits Blob.type from its synthetic _storage row.
    await (
      ctx.db as unknown as {
        patch: (id: Id<'_storage'>, value: { contentType: string }) => Promise<void>
      }
    ).patch(storageId, { contentType })
    return storageId
  })
}

async function seedProjectedUser(
  t: ReturnType<typeof convexTest>,
  authId: string,
  displayName = authId,
) {
  await t.run(async (ctx) => {
    await ctx.db.insert('users', {
      authId,
      displayName,
      email: `${authId}@example.test`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  })
}

describe('demo backend authorization', () => {
  it('keeps internal rebuild and scheduled-cleanup functions out of the generated public API', () => {
    type Visibility<Name extends PropertyKey, Module> = Name extends keyof Module
      ? 'exported'
      : 'hidden'

    const visibility: {
      publicRebuild: Visibility<'rebuildUserProjectionBatch', typeof api.auth>
      internalRebuild: Visibility<'rebuildUserProjectionBatch', typeof internal.auth>
      publicCleanupModule: Visibility<'cleanup', typeof api>
      internalCleanup: Visibility<'purgeOldData', typeof internal.cleanup>
    } = {
      publicRebuild: 'hidden',
      internalRebuild: 'exported',
      publicCleanupModule: 'hidden',
      internalCleanup: 'exported',
    }

    expect(visibility).toEqual({
      publicRebuild: 'hidden',
      internalRebuild: 'exported',
      publicCleanupModule: 'hidden',
      internalCleanup: 'exported',
    })
  })

  it('treats signed-out callers, including platform-rejected expired tokens, as anonymous', async () => {
    const t = convexTest(schema, modules)
    const storageId = await storeFileWithContentType(t, 'image', 'image/png')
    const { taskId, feedId, fileId } = await t.run(async (ctx) => {
      const now = Date.now()
      const taskId = await ctx.db.insert('demoTasks', {
        title: 'owner task',
        completed: false,
        userId: 'user_owner',
        createdAt: now,
      })
      const feedId = await ctx.db.insert('feedItems', {
        content: 'owner item',
        type: 'message',
        authorId: 'user_owner',
        createdAt: now,
      })
      const fileId = await ctx.db.insert('files', {
        storageId,
        filename: 'owner.png',
        mimeType: 'image/png',
        size: 5,
        uploadedBy: 'user_owner',
        createdAt: now,
      })
      return { taskId, feedId, fileId }
    })

    // Convex rejects expired/invalid tokens before function execution, so the
    // representable function context is the same missing identity as sign-out.
    expect(await t.query(api.auth.getPermissionContext, {})).toBeNull()
    expect(await t.query(api.auth.getCurrentUser, {})).toBeNull()
    expect(await t.query(api.files.list, {})).toEqual([])
    expect(await t.query(api.tasks.listMine, {})).toEqual([])

    await expect(t.mutation(api.files.generateUploadUrl, {})).rejects.toThrow('Not authenticated')
    await expect(
      t.mutation(api.files.save, { storageId, filename: 'anonymous.png' }),
    ).rejects.toThrow('Not authenticated')
    await expect(t.mutation(api.files.remove, { id: fileId })).rejects.toThrow('Not authenticated')
    await expect(t.mutation(api.messages.add, { content: 'anonymous' })).rejects.toThrow(
      'Not authenticated',
    )
    await expect(t.mutation(api.messages.seed, { count: 1 })).rejects.toThrow('Not authenticated')
    await expect(t.mutation(api.tasks.add, { title: 'anonymous' })).rejects.toThrow(
      'Not authenticated',
    )
    await expect(t.mutation(api.tasks.toggle, { id: taskId })).rejects.toThrow('Not authenticated')
    await expect(t.mutation(api.tasks.remove, { id: taskId })).rejects.toThrow('Not authenticated')
    await expect(t.mutation(api.tasks.clearAll, {})).rejects.toThrow('Not authenticated')
    await expect(
      t.mutation(api.feed.add, { content: 'anonymous', type: 'message' }),
    ).rejects.toThrow('Not authenticated')
    await expect(t.mutation(api.feed.remove, { id: feedId })).rejects.toThrow('Not authenticated')
  })

  it('returns only the caller projection from auth context queries', async () => {
    const t = convexTest(schema, modules)
    await seedProjectedUser(t, 'user_owner', 'Owner')
    await seedProjectedUser(t, 'user_other', 'Other')

    const missingProjection = t.withIdentity({ subject: 'missing_projection' })
    expect(await missingProjection.query(api.auth.getPermissionContext, {})).toBeNull()
    expect(await missingProjection.query(api.auth.getCurrentUser, {})).toBeNull()

    const asOwner = t.withIdentity({ subject: 'user_owner' })
    expect(await asOwner.query(api.auth.getPermissionContext, {})).toMatchObject({
      role: 'member',
      userId: 'user_owner',
      displayName: 'Owner',
    })
    expect(await asOwner.query(api.auth.getCurrentUser, {})).toMatchObject({
      authId: 'user_owner',
      displayName: 'Owner',
    })
  })

  it('allows upload URLs only with identity and binds writes to that identity', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity({ subject: 'user_owner' })

    expect(typeof (await asUser.mutation(api.files.generateUploadUrl, {}))).toBe('string')
    const messageId = await asUser.mutation(api.messages.add, { content: '  owned message  ' })
    const message = await t.run(async (ctx) => await ctx.db.get(messageId))
    expect(message).toMatchObject({ authorId: 'user_owner', content: 'owned message' })
  })

  it('keeps shared signed-in reads explicit and private reads owner-scoped', async () => {
    const t = convexTest(schema, modules)
    const asOwner = t.withIdentity({ subject: 'user_owner' })
    const asOther = t.withIdentity({ subject: 'user_other' })
    await asOwner.mutation(api.tasks.add, { title: 'owner task' })
    await asOwner.mutation(api.feed.add, { content: 'owner feed', type: 'message' })
    await asOwner.mutation(api.messages.add, { content: 'owner message' })

    // tasks.listShared, feed, and messages are an authenticated shared-demo surface,
    // so cross-user denial is intentionally N/A. listMine remains private.
    expect(await asOther.query(api.tasks.listShared, {})).toHaveLength(1)
    expect(await asOther.query(api.feed.list, {})).toHaveLength(1)
    expect(
      (
        await asOther.query(api.messages.listPaginated, {
          paginationOpts: { cursor: null, numItems: 10 },
        })
      ).page,
    ).toHaveLength(1)
    expect(await asOther.query(api.tasks.listMine, {})).toEqual([])
  })

  it('clears only the caller task batch and cannot clear another user tasks', async () => {
    const t = convexTest(schema, modules)
    const asOwner = t.withIdentity({ subject: 'user_owner' })
    const asOther = t.withIdentity({ subject: 'user_other' })
    await asOwner.mutation(api.tasks.add, { title: 'owner task' })
    await asOther.mutation(api.tasks.add, { title: 'other task' })

    expect(await asOther.mutation(api.tasks.clearAll, {})).toEqual({
      deleted: 1,
      hasMore: false,
    })
    expect((await asOwner.query(api.tasks.listMine, {})).map((task) => task.title)).toEqual([
      'owner task',
    ])
  })

  it('does not rely on route middleware for shared demo reads', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const now = Date.now()
      await ctx.db.insert('demoTasks', {
        title: 'private task',
        completed: false,
        userId: 'user_a',
        createdAt: now,
      })
      await ctx.db.insert('feedItems', {
        content: 'private feed item',
        type: 'message',
        authorId: 'user_a',
        createdAt: now,
      })
      await ctx.db.insert('messages', {
        content: 'private message',
        authorId: 'user_a',
        createdAt: now,
      })
    })

    expect(await t.query(api.tasks.listShared, {})).toEqual([])
    expect(await t.query(api.feed.list, {})).toEqual([])
    expect(await t.query(api.feed.listFiltered, {})).toEqual([])
    expect(
      await t.query(api.messages.listPaginated, {
        paginationOpts: { cursor: null, numItems: 10 },
      }),
    ).toEqual({ page: [], isDone: true, continueCursor: '' })
  })

  it('enforces owner checks on task and feed identifiers', async () => {
    const t = convexTest(schema, modules)
    const asOwner = t.withIdentity({ subject: 'user_a' })
    const asOther = t.withIdentity({ subject: 'user_b' })
    const taskId = await asOwner.mutation(api.tasks.add, { title: 'owner task' })
    const feedId = await asOwner.mutation(api.feed.add, {
      content: 'owner feed item',
      type: 'message',
    })

    await expect(asOther.mutation(api.tasks.toggle, { id: taskId })).rejects.toThrow(
      'Not authorized',
    )
    await expect(asOther.mutation(api.tasks.remove, { id: taskId })).rejects.toThrow(
      'Not authorized',
    )
    await expect(asOther.mutation(api.feed.remove, { id: feedId })).rejects.toThrow(
      'Permission denied',
    )
  })

  it('uses canonical storage metadata and permits only the registered owner', async () => {
    const t = convexTest(schema, modules)
    const asOwner = t.withIdentity({ subject: 'user_a' })
    const asOther = t.withIdentity({ subject: 'user_b' })
    const storageId = await storeFileWithContentType(t, 'image', 'image/png')

    const fileId = await asOwner.mutation(api.files.save, {
      storageId,
      filename: 'avatar.png',
    })

    await expect(
      asOther.mutation(api.files.save, { storageId, filename: 'claimed.png' }),
    ).rejects.toThrow('already registered')
    expect(await t.query(api.files.getUrl, { storageId })).toBeNull()
    expect(await asOther.query(api.files.getUrl, { storageId })).toBeNull()
    expect(await asOther.query(api.files.list, {})).toEqual([])
    expect(typeof (await asOwner.query(api.files.getUrl, { storageId }))).toBe('string')
    await expect(asOther.mutation(api.files.remove, { id: fileId })).rejects.toThrow(
      'Not authorized',
    )
  })

  it('rejects disallowed canonical content metadata without deleting the blob', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity({ subject: 'user_a' })
    const storageId = await storeFileWithContentType(t, 'not an image', 'text/html')

    await expect(
      asUser.mutation(api.files.save, { storageId, filename: 'payload.png' }),
    ).rejects.toThrow('Only GIF, JPEG, and PNG images are allowed')
    expect(
      await t.run(async (ctx) => await ctx.db.system.get('_storage', storageId)),
    ).not.toBeNull()
  })

  it('bounds client-controlled collection sizes', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity({ subject: 'user_a' })

    await expect(asUser.query(api.feed.listFiltered, { limit: 101 })).rejects.toThrow(
      'between 1 and 100',
    )
    await expect(asUser.mutation(api.messages.seed, { count: 51 })).rejects.toThrow(
      'between 1 and 50',
    )
  })
})
