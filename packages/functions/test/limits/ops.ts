import { auditTrail } from '@lupinum/better-convex-functions'
import { makeFunctionReference, paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'

import { internalMutation, job, mutation, query } from './fns'

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

/** Audited internal mutation: renames a project as whoever its caller passes. */
export const bump = internalMutation({
  action: 'projects.touch',
  args: { projectId: v.id('projects') },
  returns: v.null(),
  handler: async (ctx, { projectId }) => {
    await ctx.db.patch(projectId, { name: 'bumped' })
    return null
  },
})

/** Audited public mutation that runs `bump` in its own transaction: one audit row for both. */
export const archiveNested = mutation({
  action: 'projects.nest',
  args: { first: v.id('projects'), second: v.id('projects') },
  returns: v.null(),
  handler: async (ctx, { first, second }) => {
    await ctx.db.patch(first, { archived: true })
    await ctx.runMutation(
      makeFunctionReference<'mutation'>('ops:bump') as never,
      {
        projectId: second,
      } as never,
    )
    return null
  },
})

/** A job that runs `bump` as the system. */
export const sweep = job({
  name: 'sweep',
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    await ctx.runMutation(
      makeFunctionReference<'mutation'>('ops:bump') as never,
      {
        projectId,
      } as never,
    )
  },
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

const ref = (name: string) => makeFunctionReference<'mutation'>(name) as never

/** Limited internal mutation: 1 a minute per user, whoever reaches it. */
export const task = internalMutation({
  action: 'tasks.run',
  args: { projectId: v.id('projects'), name: v.string() },
  returns: v.null(),
  handler: async (ctx, { projectId, name }) => {
    await ctx.db.patch(projectId, { name })
    return null
  },
})

/** Unlimited, unaudited public mutation that runs the limited `task` in its own transaction. */
export const runTask = mutation({
  action: 'notes.add',
  args: { projectId: v.id('projects'), name: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.runMutation(ref('ops:task'), args as never)
    return null
  },
})

/** Unlimited public mutation that schedules the limited `task`. */
export const scheduleTask = mutation({
  action: 'notes.add',
  args: { projectId: v.id('projects'), name: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.scheduler.runAfter(0, ref('ops:task'), args as never)
    return null
  },
})

/** The same limited action as `task`, public: it runs `task`, which must not take a second token. */
export const taskOuter = mutation({
  action: 'tasks.run',
  args: { projectId: v.id('projects'), name: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.runMutation(ref('ops:task'), args as never)
    return null
  },
})

/** Unaudited public mutation that runs the audited `bump`: `bump` writes its own row. */
export const runBump = mutation({
  action: 'notes.add',
  args: { projectId: v.id('projects') },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.runMutation(ref('ops:bump'), args as never)
    return null
  },
})
