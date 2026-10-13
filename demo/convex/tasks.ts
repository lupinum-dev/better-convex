/**
 * Tasks Functions - Optimistic updates demo
 *
 * Demonstrates optimistic updates with useConvexMutation.
 */

import { v } from 'convex/values'

import { mutation, query } from './_generated/server'

/**
 * List the latest tasks of ALL signed-in users, newest first.
 * Shared on purpose for this demo. For private data, copy `listMine` instead.
 */
export const listShared = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      return []
    }
    const tasks = await ctx.db.query('demoTasks').order('desc').take(100)

    return tasks
  },
})

/**
 * List only the current user's tasks (personal/private)
 */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      return []
    }

    const tasks = await ctx.db
      .query('demoTasks')
      .withIndex('by_user', (q) => q.eq('userId', identity.subject))
      .order('desc')
      .take(100)

    return tasks
  },
})

/**
 * Add a new task
 */
export const add = mutation({
  args: {
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error('Not authenticated')
    }
    const title = args.title.trim()
    if (!title || title.length > 120) {
      throw new Error('Task title must be between 1 and 120 characters')
    }

    const taskId = await ctx.db.insert('demoTasks', {
      title,
      completed: false,
      userId: identity.subject,
      createdAt: Date.now(),
    })

    return taskId
  },
})

/**
 * Toggle task completion (only own tasks)
 */
export const toggle = mutation({
  args: {
    id: v.id('demoTasks'),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error('Not authenticated')
    }

    const task = await ctx.db.get(args.id)
    if (!task) {
      throw new Error('Task not found')
    }

    if (task.userId !== identity.subject) {
      throw new Error('Not authorized')
    }

    await ctx.db.patch(args.id, {
      completed: !task.completed,
    })
  },
})

/**
 * Remove a task (only own tasks)
 */
export const remove = mutation({
  args: {
    id: v.id('demoTasks'),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error('Not authenticated')
    }

    const task = await ctx.db.get(args.id)
    if (!task) {
      throw new Error('Task not found')
    }

    if (task.userId !== identity.subject) {
      throw new Error('Not authorized')
    }

    await ctx.db.delete(args.id)
  },
})

/**
 * Clear one bounded batch of the current user's tasks.
 */
export const clearAll = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error('Not authenticated')
    }

    const tasks = await ctx.db
      .query('demoTasks')
      .withIndex('by_user', (q) => q.eq('userId', identity.subject))
      .take(100)

    for (const task of tasks) {
      await ctx.db.delete(task._id)
    }

    return { deleted: tasks.length, hasMore: tasks.length === 100 }
  },
})
