import { v } from 'convex/values'

import { query, mutation } from './_generated/server'
import { auth } from './auth'

// Get all tasks for the current user
export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await auth.getUser(ctx)
    if (!user) {
      return []
    }

    const userId = user.id

    const tasks = await ctx.db
      .query('tasks')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .order('desc')
      .take(100)

    return tasks
  },
})

// Add a new task
export const add = mutation({
  args: { title: v.string() },
  handler: async (ctx, args) => {
    const user = await auth.requireUser(ctx)

    const userId = user.id
    const title = args.title.trim()
    if (!title || title.length > 120) {
      throw new Error('Task title must be between 1 and 120 characters')
    }

    const taskId = await ctx.db.insert('tasks', {
      userId,
      title,
      completed: false,
      createdAt: Date.now(),
    })

    return taskId
  },
})

// Toggle task completion
export const toggle = mutation({
  args: { id: v.id('tasks') },
  handler: async (ctx, args) => {
    const user = await auth.requireUser(ctx)

    const task = await ctx.db.get(args.id)
    if (!task) {
      throw new Error('Task not found')
    }

    // Ensure user owns the task
    if (task.userId !== user.id) {
      throw new Error('Not authorized')
    }

    await ctx.db.patch(args.id, {
      completed: !task.completed,
    })
  },
})

// Delete a task
export const remove = mutation({
  args: { id: v.id('tasks') },
  handler: async (ctx, args) => {
    const user = await auth.requireUser(ctx)

    const task = await ctx.db.get(args.id)
    if (!task) {
      throw new Error('Task not found')
    }

    // Ensure user owns the task
    if (task.userId !== user.id) {
      throw new Error('Not authorized')
    }

    await ctx.db.delete(args.id)
  },
})
