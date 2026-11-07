import { ConvexError, v } from 'convex/values'

import type { Id } from './_generated/dataModel'
import { mutation, query, type MutationCtx } from './_generated/server'
import { auth } from './auth'

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await auth.requireUser(ctx)
    return await ctx.db
      .query('todos')
      .withIndex('by_owner', (q) => q.eq('ownerId', user.id))
      .order('desc')
      .take(50)
  },
})

export const create = mutation({
  args: { text: v.string() },
  handler: async (ctx, args) => {
    const user = await auth.requireUser(ctx)
    const text = args.text.trim()
    if (!text || text.length > 200) {
      throw new ConvexError({
        code: 'INVALID_TODO_TEXT',
        message: 'Todo text must contain 1 to 200 characters',
      })
    }
    return await ctx.db.insert('todos', { ownerId: user.id, text, completed: false })
  },
})

async function requireOwnTodo(ctx: MutationCtx, todoId: Id<'todos'>) {
  const user = await auth.requireUser(ctx)
  const todo = await ctx.db.get(todoId)
  // The same error for a missing todo and for a todo of another user.
  if (!todo || todo.ownerId !== user.id) {
    throw new ConvexError({ code: 'TODO_NOT_FOUND', message: 'Todo not found' })
  }
  return todo
}

export const toggle = mutation({
  args: { todoId: v.id('todos') },
  handler: async (ctx, args) => {
    const todo = await requireOwnTodo(ctx, args.todoId)
    await ctx.db.patch(todo._id, { completed: !todo.completed })
  },
})

export const remove = mutation({
  args: { todoId: v.id('todos') },
  handler: async (ctx, args) => {
    const todo = await requireOwnTodo(ctx, args.todoId)
    await ctx.db.delete(todo._id)
  },
})
