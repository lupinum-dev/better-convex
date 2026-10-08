import { auditTrail } from '@lupinum/better-convex-functions'
import { paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'

import { internalAction, mutation, query, takeActionToken } from './fns'

export { takeActionToken }

/** Limited: 3 a minute per user. */
export const rename = mutation({
  action: 'projects.rename',
  args: { projectId: v.id('projects'), name: v.string() },
  returns: v.null(),
  handler: async (ctx, { projectId, name }) => {
    await ctx.db.patch(projectId, { name })
    return null
  },
})

/** Limited like `rename`, but the call fails after it took its token. */
export const renameThenFail = mutation({
  action: 'projects.rename',
  args: { projectId: v.id('projects') },
  returns: v.null(),
  handler: async (ctx, { projectId }) => {
    await ctx.db.patch(projectId, { name: 'never kept' })
    throw new Error('boom')
  },
})

/** Limited: 2 an hour per tenant. */
export const report = mutation({
  action: 'reports.generate',
  args: { orgId: v.id('orgs') },
  returns: v.null(),
  handler: async () => null,
})

/** Public and limited: 2 a minute for everyone. */
export const contact = mutation({
  action: 'contact.send',
  args: {},
  returns: v.null(),
  handler: async () => null,
})

/** Public, limited per user; a visitor has none. */
export const feedback = mutation({
  action: 'feedback.send',
  args: {},
  returns: v.null(),
  handler: async () => null,
})

/** An action with a limit of 1 a minute. */
export const sync = internalAction({
  action: 'sync.run',
  args: {},
  handler: async () => null,
})

/** Audited: archives every project of an org. */
export const archiveAll = mutation({
  action: 'projects.archive',
  args: { orgId: v.id('orgs') },
  returns: v.number(),
  handler: async (ctx, { orgId }) => {
    const projects = await ctx.db
      .query('projects')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    for (const project of projects) await ctx.db.patch(project._id, { archived: true })
    return projects.length
  },
})

/** Audited, but fails after writing. */
export const touchThenFail = mutation({
  action: 'projects.touch',
  args: { projectId: v.id('projects') },
  returns: v.null(),
  handler: async (ctx, { projectId }) => {
    await ctx.db.patch(projectId, { archived: true })
    throw new Error('boom')
  },
})

/** Audited; reads the tenant's log through the library helper. */
export const trail = query({
  action: 'audit.read',
  args: { orgId: v.id('orgs'), paginationOpts: paginationOptsValidator },
  returns: v.any(),
  handler: async (ctx, { orgId, paginationOpts }) =>
    await auditTrail(ctx, { tenantId: orgId, paginationOpts }),
})

/** Not audited: writes a row and nothing is logged. */
export const addNote = mutation({
  action: 'notes.add',
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const me = ctx.actor.user._id
    await ctx.db.insert('notes', { userId: me, text: 'hi' })
    return null
  },
})

/** Audited: inserts one project, patches one, replaces another and deletes a fourth. */
export const reshape = mutation({
  action: 'projects.archive',
  args: {
    patchId: v.id('projects'),
    replaceId: v.id('projects'),
    deleteId: v.id('projects'),
  },
  returns: v.id('projects'),
  handler: async (ctx, { patchId, replaceId, deleteId }) => {
    await ctx.db.patch(patchId, { name: 'patched' })
    const project = await ctx.db.get(replaceId)
    const created = await ctx.db.insert('projects', {
      orgId: project!.orgId,
      name: 'new',
      archived: false,
    })
    await ctx.db.replace(replaceId, { orgId: project!.orgId, name: 'replaced', archived: false })
    await ctx.db.delete(deleteId)
    return created
  },
})
