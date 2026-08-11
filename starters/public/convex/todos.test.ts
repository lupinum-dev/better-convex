import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'

import { api } from './_generated/api'
import schema from './schema'
import { modules } from './test.setup'

describe('public todos', () => {
  it('rejects empty text', async () => {
    const t = convexTest(schema, modules)

    await expect(t.mutation(api.todos.create, { text: '   ' })).rejects.toThrow(
      'Todo text must be between 1 and 200 characters',
    )
    await expect(t.mutation(api.todos.create, { text: 'x'.repeat(201) })).rejects.toThrow(
      'Todo text must be between 1 and 200 characters',
    )
  })

  it('keeps shared todo writes anonymous by design and validates object existence', async () => {
    const t = convexTest(schema, modules)

    // This starter intentionally has no users or owners. Cross-user denial is
    // N/A; anonymous callers share one bounded public todo collection.
    const todoId = await t.mutation(api.todos.create, { text: '  public todo  ' })
    await t.mutation(api.todos.toggle, { id: todoId })
    expect(await t.query(api.todos.list, {})).toMatchObject([
      { _id: todoId, text: 'public todo', completed: true },
    ])

    await t.mutation(api.todos.remove, { id: todoId })
    expect(await t.query(api.todos.list, {})).toEqual([])
    await expect(t.mutation(api.todos.toggle, { id: todoId })).rejects.toThrow('Todo not found')
    await expect(t.mutation(api.todos.remove, { id: todoId })).rejects.toThrow('Todo not found')
  })

  it('lists newest todos first', async () => {
    const t = convexTest(schema, modules)

    await t.run(async (ctx) => {
      await ctx.db.insert('todos', {
        text: 'first',
        completed: false,
      })
      await ctx.db.insert('todos', {
        text: 'second',
        completed: false,
      })
    })

    const todos = await t.query(api.todos.list, {})

    expect(todos.map((todo) => todo.text)).toEqual(['second', 'first'])
  })

  it('has no auth or organization backend files', async () => {
    const files = Object.keys(modules)

    expect(files.some((file) => file.includes('/auth.'))).toBe(false)
    expect(files.some((file) => file.includes('/organizations.'))).toBe(false)
    expect(files.some((file) => file.includes('/memberships.'))).toBe(false)
  })
})
