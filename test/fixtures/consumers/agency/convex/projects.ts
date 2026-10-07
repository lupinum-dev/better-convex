import { fail } from '@lupinum/better-convex-functions'
import { v } from 'convex/values'

import { mutation, query } from './functions'

const project = v.object({ id: v.id('projects'), name: v.string(), url: v.string() })

export const list = query({
  action: 'projects.list',
  args: { clientId: v.id('clients') },
  returns: v.array(project),
  tool: { name: 'list_projects', description: "List a client's sites." },
  handler: async (ctx, { clientId }) => {
    const projects = await ctx.db
      .query('projects')
      .withIndex('by_client', (q) => q.eq('clientId', clientId))
      .take(200)
    return projects.map(({ _id, name, url }) => ({ id: _id, name, url }))
  },
})

export const create = mutation({
  action: 'projects.create',
  args: { clientId: v.id('clients'), name: v.string(), url: v.string() },
  returns: v.id('projects'),
  handler: async (ctx, { clientId, name, url }) => {
    if (!URL.canParse(url) || !/^https?:$/.test(new URL(url).protocol))
      fail('INVALID_INPUT', 'url: use an http or https address.')
    return ctx.db.insert('projects', { clientId, name: name.trim(), url })
  },
})
