import { internalMutationGeneric } from 'convex/server'
import { v } from 'convex/values'

export const onDelete = internalMutationGeneric({
  args: { doc: v.any(), model: v.string() },
  handler: async (ctx, args) => {
    if (args.doc.id === 'parent_trigger_failure') throw new Error('EXPECTED_TRIGGER_FAILURE')
    await ctx.db.insert('relationshipEvents', {
      event: 'delete',
      model: args.model,
      rowId: String(args.doc.id),
    })
  },
})

export const onUpdate = internalMutationGeneric({
  args: { model: v.string(), newDoc: v.any(), oldDoc: v.any() },
  handler: async (ctx, args) => {
    await ctx.db.insert('relationshipEvents', {
      event: 'update',
      model: args.model,
      rowId: String(args.newDoc.id),
    })
  },
})
