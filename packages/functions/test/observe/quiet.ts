import { v } from 'convex/values'

import { build } from './fns'

/** The same app without `observe`. */
const quiet = build(false)

export const rename = quiet.mutation({
  action: 'projects.rename',
  args: { projectId: v.id('projects'), name: v.string() },
  returns: v.null(),
  handler: async (ctx, { projectId, name }) => {
    ctx.log.set({ project: { id: projectId } })
    await ctx.db.patch(projectId, { name })
    return null
  },
})
