/**
 * Posts permission tests.
 *
 * Covers the playground's signed-in + ownership authorization model. Better Auth
 * owns identity; these tests seed only the rebuildable user projection needed by
 * getUser()/authorize().
 */

import { signInAs } from '@lupinum/better-convex-nuxt/better-auth/test'
import { describe, expect, it } from 'vitest'

import { api } from './_generated/api'
import { checkPermission } from './permissions.config'
import { initConvexTest } from './test.setup'

type ConvexTest = ReturnType<typeof initConvexTest>

async function seedUser(t: ConvexTest, authId: string) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('users', {
      authId,
      displayName: authId,
      email: `${authId}@example.test`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  })
}

async function seedPost(t: ConvexTest, ownerId: string) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('posts', {
      title: 'Seeded',
      content: 'Seeded content',
      status: 'draft',
      ownerId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  })
}

async function expectConvexErrorCode(promise: Promise<unknown>, code: string) {
  await promise.then(
    () => {
      throw new Error(`Expected ConvexError code ${code}`)
    },
    (error: unknown) => {
      const data = (error as { data?: unknown }).data
      const hasDataCode =
        typeof data === 'object' &&
        data !== null &&
        'code' in data &&
        (data as { code?: unknown }).code === code
      const message = error instanceof Error ? error.message : String(error)
      const hasMessageCode = message.includes(`"code":"${code}"`)
      expect(hasDataCode || hasMessageCode).toBe(true)
    },
  )
}

describe('posts unauthenticated access', () => {
  it('returns empty list results for signed-out callers', async () => {
    const t = initConvexTest()
    await seedPost(t, 'user_owner')

    const posts = await t.query(api.posts.list, {})

    expect(posts).toEqual([])
  })

  it('returns an empty paginated result for signed-out callers', async () => {
    const t = initConvexTest()
    await seedPost(t, 'user_owner')

    const page = await t.query(api.posts.listPaginated, {
      paginationOpts: { numItems: 10, cursor: null },
    })

    expect(page).toEqual({ page: [], isDone: true, continueCursor: '' })
  })

  it('returns null from get for signed-out callers', async () => {
    const t = initConvexTest()
    const postId = await seedPost(t, 'user_owner')

    const post = await t.query(api.posts.get, { id: postId })

    expect(post).toBeNull()
  })

  it('throws structured UNAUTHENTICATED errors for protected mutations', async () => {
    const t = initConvexTest()
    const postId = await seedPost(t, 'user_owner')

    await expectConvexErrorCode(
      t.mutation(api.posts.create, { title: 'Draft', content: 'Body' }),
      'UNAUTHENTICATED',
    )
    await expectConvexErrorCode(
      t.mutation(api.posts.update, { id: postId, title: 'Nope' }),
      'UNAUTHENTICATED',
    )
    await expectConvexErrorCode(t.mutation(api.posts.publish, { id: postId }), 'UNAUTHENTICATED')
    await expectConvexErrorCode(t.mutation(api.posts.remove, { id: postId }), 'UNAUTHENTICATED')
  })

  it('treats an identity without a synced user projection as unauthenticated', async () => {
    const t = initConvexTest()

    await expectConvexErrorCode(
      (await signInAs(t, 'missing_projection'))

        .mutation(api.posts.create, { title: 'Draft', content: 'Body' }),
      'UNAUTHENTICATED',
    )
  })
})

describe('posts ownership authorization', () => {
  it('creates posts owned by the signed-in user', async () => {
    const t = initConvexTest()
    await seedUser(t, 'user_owner')

    const postId = await (
      await signInAs(t, 'user_owner')
    )

      .mutation(api.posts.create, { title: 'Draft', content: 'Body' })

    const post = await t.run(async (ctx) => await ctx.db.get(postId))
    expect(post).toMatchObject({
      title: 'Draft',
      content: 'Body',
      status: 'draft',
      ownerId: 'user_owner',
    })
  })

  it('lists and gets only posts owned by the caller', async () => {
    const t = initConvexTest()
    await seedUser(t, 'user_owner')
    await seedUser(t, 'user_other')
    const ownerPostId = await seedPost(t, 'user_owner')
    await seedPost(t, 'user_other')

    const asOwner = await signInAs(t, 'user_owner')
    const asOther = await signInAs(t, 'user_other')

    const ownerList = await asOwner.query(api.posts.list, {})
    expect(ownerList.map((post) => post.ownerId)).toEqual(['user_owner'])
    expect(await asOwner.query(api.posts.get, { id: ownerPostId })).not.toBeNull()
    expect(await asOther.query(api.posts.get, { id: ownerPostId })).toBeNull()
  })

  it('paginates only posts owned by the caller', async () => {
    const t = initConvexTest()
    await seedUser(t, 'user_owner')
    await seedUser(t, 'user_other')
    await seedPost(t, 'user_owner')
    await seedPost(t, 'user_owner')
    await seedPost(t, 'user_other')

    const page = await (
      await signInAs(t, 'user_owner')
    ).query(api.posts.listPaginated, {
      paginationOpts: { numItems: 10, cursor: null },
    })

    expect(page.page).toHaveLength(2)
    expect(page.page.every((post) => post.ownerId === 'user_owner')).toBe(true)
  })

  it('allows the owner to update, publish, and remove a post', async () => {
    const t = initConvexTest()
    await seedUser(t, 'user_owner')
    const asOwner = await signInAs(t, 'user_owner')
    const postId = await asOwner.mutation(api.posts.create, { title: 'Draft', content: 'Body' })

    await asOwner.mutation(api.posts.update, { id: postId, title: 'Updated' })
    await asOwner.mutation(api.posts.publish, { id: postId })
    const published = await asOwner.query(api.posts.get, { id: postId })
    expect(published).toMatchObject({ title: 'Updated', status: 'published' })
    expect(published?.publishedAt).toEqual(expect.any(Number))

    await asOwner.mutation(api.posts.remove, { id: postId })
    expect(await asOwner.query(api.posts.get, { id: postId })).toBeNull()
  })

  it('rejects non-owner update, publish, and remove without changing the post', async () => {
    const t = initConvexTest()
    await seedUser(t, 'user_owner')
    await seedUser(t, 'user_other')
    const postId = await seedPost(t, 'user_owner')
    const asOther = await signInAs(t, 'user_other')

    await expectConvexErrorCode(
      asOther.mutation(api.posts.update, { id: postId, title: 'Stolen' }),
      'FORBIDDEN',
    )
    await expectConvexErrorCode(asOther.mutation(api.posts.publish, { id: postId }), 'FORBIDDEN')
    await expectConvexErrorCode(asOther.mutation(api.posts.remove, { id: postId }), 'FORBIDDEN')

    const post = await t.run(async (ctx) => await ctx.db.get(postId))
    expect(post).toMatchObject({ title: 'Seeded', status: 'draft', ownerId: 'user_owner' })
  })

  it('throws NOT_FOUND before ownership checks for missing posts', async () => {
    const t = initConvexTest()
    await seedUser(t, 'user_owner')
    const missingId = await seedPost(t, 'user_owner')
    await t.run(async (ctx) => {
      await ctx.db.delete(missingId)
    })
    const asOwner = await signInAs(t, 'user_owner')

    await expectConvexErrorCode(
      asOwner.mutation(api.posts.update, { id: missingId, title: 'Missing' }),
      'NOT_FOUND',
    )
    await expectConvexErrorCode(asOwner.mutation(api.posts.publish, { id: missingId }), 'NOT_FOUND')
    await expectConvexErrorCode(asOwner.mutation(api.posts.remove, { id: missingId }), 'NOT_FOUND')
  })
})

describe('checkPermission', () => {
  it('denies every permission without signed-in context', () => {
    expect(checkPermission(null, 'post.create')).toBe(false)
    expect(checkPermission(null, 'post.update', { ownerId: 'user_1' })).toBe(false)
  })

  it('grants signed-in permissions without a resource', () => {
    expect(checkPermission({ role: 'member', userId: 'user_1' }, 'post.create')).toBe(true)
    expect(checkPermission({ role: 'member', userId: 'user_1' }, 'post.read')).toBe(true)
  })

  it('grants ownership permissions only to the resource owner', () => {
    const ctx = { role: 'member', userId: 'user_1' }

    expect(checkPermission(ctx, 'post.update', { ownerId: 'user_1' })).toBe(true)
    expect(checkPermission(ctx, 'post.delete', { ownerId: 'user_2' })).toBe(false)
    expect(checkPermission(ctx, 'post.publish')).toBe(false)
  })

  it('denies unknown or malformed permissions', () => {
    const ctx = { role: 'member', userId: 'user_1' }

    expect(checkPermission(ctx, 'post.archive' as never)).toBe(false)
    expect(checkPermission(ctx, 'post' as never)).toBe(false)
    expect(checkPermission(ctx, '.create' as never)).toBe(false)
  })
})
