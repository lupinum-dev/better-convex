import { v } from 'convex/values'

import { internalAction } from './functions'

/** Work outside the database, started by a job: tells a monitor that the cleanup ran. */
export const ping = internalAction({
  args: { url: v.string() },
  handler: async (_ctx, { url }) => {
    await fetch(url, { method: 'POST' })
    return null
  },
})
