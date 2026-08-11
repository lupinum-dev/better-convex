import { mutationGeneric } from 'convex/server'
import { v } from 'convex/values'

import { components } from './_generated/api'

const identifier = 'auth-bulk-budget-evidence'

export const seed = mutationGeneric({
  args: { index: v.number() },
  handler: (ctx, args) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      model: 'verification',
      data: {
        id: `${identifier}-${args.index}`,
        identifier,
        value: `before-${args.index}`,
        expiresAt: 4_102_444_800_000,
        createdAt: args.index,
        updatedAt: args.index,
      },
    }),
})

export const measure = mutationGeneric({
  args: {},
  handler: async (ctx) => {
    const updated = await ctx.runMutation(components.betterAuth.adapter.updateMany, {
      model: 'verification',
      where: [{ field: 'identifier', value: identifier }],
      update: { value: 'after' },
    })
    return { metrics: await ctx.meta.getTransactionMetrics(), updated }
  },
})

export const cleanup = mutationGeneric({
  args: {},
  handler: (ctx) =>
    ctx.runMutation(components.betterAuth.adapter.deleteMany, {
      model: 'verification',
      where: [{ field: 'identifier', value: identifier }],
    }),
})
