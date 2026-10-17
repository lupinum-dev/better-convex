import { v } from 'convex/values'

import { action, internalAction } from './functions'

/** Work outside the database, started by a job: tells a monitor that the cleanup ran. */
export const ping = internalAction({
  args: { url: v.string() },
  handler: async (_ctx, { url }) => {
    await fetch(url, { method: 'POST' })
    return null
  },
})

/** Work outside the database that a person starts: tells a monitor who looked at an organization. */
export const announce = action({
  action: 'projects.search',
  args: { organizationId: v.id('organizations') },
  returns: v.null(),
  handler: async (ctx, { organizationId }) => {
    await fetch('https://monitor.example/seen', {
      method: 'POST',
      body: JSON.stringify({ organizationId, by: ctx.actor.user._id }),
    })
    return null
  },
})
