import { signInAs } from '@lupinum/better-convex-nuxt/better-auth/test'
import { describe, expect, it } from 'vitest'

import { api } from './_generated/api'
import { initConvexTest } from './test.setup'

describe('todos', () => {
  // Catches a list or a write that is not limited to the signed-in user.
  it('keeps each user to their own todos', async () => {
    const t = initConvexTest()
    const ann = await signInAs(t, 'ann')
    const bob = await signInAs(t, 'bob')

    const todoId = await ann.mutation(api.todos.create, { text: '  Buy milk  ' })
    expect(await ann.query(api.todos.list, {})).toMatchObject([
      { _id: todoId, ownerId: 'ann', text: 'Buy milk', completed: false },
    ])
    expect(await bob.query(api.todos.list, {})).toEqual([])

    // Another user's todo looks the same as one that does not exist.
    for (const call of [
      bob.mutation(api.todos.toggle, { todoId }),
      bob.mutation(api.todos.remove, { todoId }),
    ]) {
      await expect(call).rejects.toMatchObject({ data: { code: 'TODO_NOT_FOUND' } })
    }

    await ann.mutation(api.todos.toggle, { todoId })
    expect(await ann.query(api.todos.list, {})).toMatchObject([{ completed: true }])
    await ann.mutation(api.todos.remove, { todoId })
    expect(await ann.query(api.todos.list, {})).toEqual([])
  })

  it('refuses anonymous callers', async () => {
    const t = initConvexTest()
    await expect(t.query(api.todos.list, {})).rejects.toMatchObject({
      data: { code: 'UNAUTHENTICATED' },
    })
    await expect(t.mutation(api.todos.create, { text: 'x' })).rejects.toMatchObject({
      data: { code: 'UNAUTHENTICATED' },
    })
  })

  it('rejects empty and too long text', async () => {
    const ann = await signInAs(initConvexTest(), 'ann')
    for (const text of ['   ', 'x'.repeat(201)]) {
      await expect(ann.mutation(api.todos.create, { text })).rejects.toMatchObject({
        data: { code: 'INVALID_TODO_TEXT' },
      })
    }
  })
})
