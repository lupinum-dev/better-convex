import { signInAs } from '@lupinum/better-convex-nuxt/better-auth/test'
import { describe, expect, it } from 'vitest'

import { api } from './_generated/api'
import { initConvexTest } from './test.setup'

describe('playground resource bounds', () => {
  it('caps task lists and normalizes bounded task titles', async () => {
    const t = initConvexTest()
    const asUser = await signInAs(t, 'user_a')
    await t.run(async (ctx) => {
      for (let index = 0; index < 101; index += 1) {
        await ctx.db.insert('tasks', {
          userId: 'user_a',
          title: `Task ${index}`,
          completed: false,
          createdAt: index,
        })
      }
    })

    expect(await asUser.query(api.tasks.list, {})).toHaveLength(100)
    const taskId = await asUser.mutation(api.tasks.add, { title: '  Bounded  ' })
    expect(await t.run(async (ctx) => await ctx.db.get(taskId))).toMatchObject({
      title: 'Bounded',
    })
    await expect(asUser.mutation(api.tasks.add, { title: 'x'.repeat(121) })).rejects.toThrow(
      'between 1 and 120',
    )
  })

  it('caps post lists, pagination, and create/update text', async () => {
    const t = initConvexTest()
    await t.run(async (ctx) => {
      await ctx.db.insert('users', {
        authId: 'user_a',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      for (let index = 0; index < 101; index += 1) {
        await ctx.db.insert('posts', {
          title: `Post ${index}`,
          content: 'Body',
          status: 'draft',
          ownerId: 'user_a',
          createdAt: index,
          updatedAt: index,
        })
      }
    })
    const asUser = await signInAs(t, 'user_a')

    expect(await asUser.query(api.posts.list, {})).toHaveLength(100)
    await expect(
      asUser.query(api.posts.listPaginated, {
        paginationOpts: { cursor: null, numItems: 51 },
      }),
    ).rejects.toThrow('from 1 to 50')
    await expect(
      asUser.mutation(api.posts.create, { title: 'x'.repeat(121), content: 'Body' }),
    ).rejects.toThrow('between 1 and 120')
    await expect(
      asUser.mutation(api.posts.create, { title: 'Title', content: 'x'.repeat(20_001) }),
    ).rejects.toThrow('between 1 and 20000')

    const postId = await asUser.mutation(api.posts.create, {
      title: '  New post  ',
      content: '  Body  ',
    })
    await expect(asUser.mutation(api.posts.update, { id: postId, title: '   ' })).rejects.toThrow(
      'between 1 and 120',
    )
    expect(await asUser.query(api.posts.get, { id: postId })).toMatchObject({
      title: 'New post',
      content: 'Body',
    })
  })
})
