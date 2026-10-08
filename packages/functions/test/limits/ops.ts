import { auditTrail } from '@lupinum/better-convex-functions'
import { makeFunctionReference, paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'

import { internalAction, internalMutation, job, mutation, query } from './fns'

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

/** Limited per tenant, internal: the report of one org, reached from another org's report. */
export const reportInternal = internalMutation({
  action: 'reports.generate',
  args: { orgId: v.id('orgs') },
  returns: v.null(),
  handler: async () => null,
})

/**
 * A report with no tenant (its token comes from the person's bucket) that runs the report of one
 * org: the nested call has another bucket and must pay into it.
 */
export const reportFor = mutation({
  action: 'reports.generate',
  args: { orgId: v.string() },
  returns: v.null(),
  handler: async (ctx, { orgId }) => {
    await ctx.runMutation(ref('ops:reportInternal'), { orgId } as never)
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

// The doors table (../doors.test.ts): `projects.guard` is owner-only, limited (2 a minute) and
// audited. Every entry path below ends in the same internal mutation, `guardInternal`.
const guardArgs = {
  projectId: v.id('projects'),
  name: v.string(),
  /** A row of another place, written by the handler: the row rules must refuse it. */
  elsewhere: v.optional(v.string()),
  /** Skip the project write: then no row rule stands behind the policy. */
  quiet: v.optional(v.boolean()),
}

/** Door 1: the public mutation. */
export const guard = mutation({
  action: 'projects.guard',
  args: guardArgs,
  returns: v.null(),
  handler: async (ctx, { projectId, name, elsewhere, quiet }) => {
    if (!quiet) await ctx.db.patch(projectId, { name })
    // A write the row rules do not guard: only the policy stops it.
    const project = await ctx.db.get(projectId)
    await ctx.db.insert('locks', { orgId: project!.orgId, name, locked: true })
    if (elsewhere) await ctx.db.patch(elsewhere as typeof projectId, { name })
    return null
  },
})

/** The internal mutation every other door reaches. */
export const guardInternal = internalMutation({
  action: 'projects.guard',
  args: guardArgs,
  returns: v.null(),
  handler: async (ctx, { projectId, name, elsewhere, quiet }) => {
    if (!quiet) await ctx.db.patch(projectId, { name })
    // A write the row rules do not guard: only the policy stops it.
    const project = await ctx.db.get(projectId)
    await ctx.db.insert('locks', { orgId: project!.orgId, name, locked: true })
    if (elsewhere) await ctx.db.patch(elsewhere as typeof projectId, { name })
    return null
  },
})

/** Door 2: an internal action runs the internal mutation. */
export const guardViaAction = internalAction({
  args: guardArgs,
  handler: async (ctx, args) => {
    await ctx.runMutation(ref('ops:guardInternal'), args as never)
  },
})

/** A viewer may call the outer operations below: only `projects.guard` is out of their reach. */
export const scheduleGuard = mutation({
  action: 'projects.read',
  args: guardArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.scheduler.runAfter(0, ref('ops:guardInternal'), args as never)
    return null
  },
})

export const scheduleGuardViaAction = mutation({
  action: 'projects.read',
  args: guardArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.scheduler.runAfter(0, ref('ops:guardViaAction'), args as never)
    return null
  },
})

/** Door 4: nested under an unaudited, unlimited outer call. */
export const guardUnderPlain = mutation({
  action: 'projects.read',
  args: guardArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.runMutation(ref('ops:guardInternal'), args as never)
    return null
  },
})

/** Door 5: nested under an audited, unlimited outer call. */
export const guardUnderAudited = mutation({
  action: 'projects.peek',
  args: guardArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.runMutation(ref('ops:guardInternal'), args as never)
    return null
  },
})

/** Door 6: nested under an outer call of the same limited, audited action. */
export const guardUnderSame = mutation({
  action: 'projects.guard',
  args: guardArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.runMutation(ref('ops:guardInternal'), args as never)
    return null
  },
})

/** A job that runs the internal mutation as the system. */
export const guardJob = job({
  name: 'guardJob',
  args: guardArgs,
  handler: async (ctx, args) => {
    await ctx.runMutation(ref('ops:guardInternal'), args as never)
  },
})
