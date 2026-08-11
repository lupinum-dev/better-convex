import { ConvexError, v } from 'convex/values'

import { mutation, query } from './_generated/server'

const todoValidator = v.object({
  _id: v.id('todos'),
  _creationTime: v.number(),
  text: v.string(),
  completed: v.boolean(),
})

export const list = query({
  args: {},
  returns: v.array(todoValidator),
  handler: async (ctx) => {
    return await ctx.db.query('todos').order('desc').take(50)
  },
})

export const create = mutation({
  args: {
    text: v.string(),
  },
  returns: v.id('todos'),
  handler: async (ctx, args) => {
    const text = args.text.trim()
    if (!text || text.length > 200) {
      throw new ConvexError('Todo text must be between 1 and 200 characters')
    }

    return await ctx.db.insert('todos', {
      text,
      completed: false,
    })
  },
})

export const toggle = mutation({
  args: {
    id: v.id('todos'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const todo = await ctx.db.get(args.id)
    if (!todo) {
      throw new ConvexError('Todo not found')
    }

    await ctx.db.patch(args.id, {
      completed: !todo.completed,
    })
    return null
  },
})

export const remove = mutation({
  args: {
    id: v.id('todos'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const todo = await ctx.db.get(args.id)
    if (!todo) {
      throw new ConvexError('Todo not found')
    }

    await ctx.db.delete(args.id)
    return null
  },
})
