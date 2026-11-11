import { fail } from '@lupinum/better-convex-functions'
import { makeFunctionReference } from 'convex/server'
import { ConvexError, v } from 'convex/values'

import { action, internalAction, internalMutation, job, mutation, query } from './fns'

const ref = (name: string) => makeFunctionReference<'mutation'>(name) as never

export const read = query({
  action: 'projects.read',
  args: { projectId: v.id('projects') },
  returns: v.string(),
  handler: async (ctx, { projectId }) => (await ctx.db.get(projectId))!.name,
})

/** Renames and adds the project to the event. */
export const rename = mutation({
  action: 'projects.rename',
  args: { projectId: v.id('projects'), name: v.string() },
  returns: v.null(),
  handler: async (ctx, { projectId, name }) => {
    ctx.log.set({ project: { id: projectId } })
    if (name.length < 3)
      fail('INVALID_INPUT', `The name ${name} is too short.`, {
        why: 'Names appear in lists.',
        fix: 'Use 3 or more characters.',
      })
    await ctx.db.patch(projectId, { name })
    return null
  },
})

/** Fails with an app code that is not one of the library's. */
export const lock = mutation({
  action: 'projects.rename',
  args: { projectId: v.id('projects') },
  returns: v.null(),
  handler: async () => {
    throw new ConvexError({ code: 'PROJECT_LOCKED', message: 'Locked by Ann Example.' })
  },
})

/** Crashes after a write. */
export const crash = mutation({
  action: 'projects.rename',
  args: { projectId: v.id('projects') },
  returns: v.null(),
  handler: async (ctx, { projectId }) => {
    await ctx.db.patch(projectId, { name: 'never kept' })
    throw new Error('internal detail')
  },
})

export const report = action({
  action: 'reports.make',
  args: { orgId: v.id('orgs') },
  returns: v.null(),
  handler: async (ctx, { orgId }) => {
    ctx.log.set({ org: orgId })
    return null
  },
})

export const sweep = job({
  name: 'sweep',
  args: {},
  handler: async (ctx) => {
    ctx.log.set({ swept: 0 })
  },
})

export const fetchSite = internalAction({
  args: {},
  handler: async () => null,
})

/** Renames through an internal mutation in its own transaction, then fails when asked to. */
export const renameVia = mutation({
  action: 'projects.rename',
  args: { projectId: v.id('projects'), name: v.string(), thenFail: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { projectId, name, thenFail }) => {
    await ctx.runMutation(ref('ops:renameInner'), { projectId, name } as never)
    if (thenFail) fail('INVALID_INPUT', 'Stopped after the inner rename.')
    return null
  },
})

export const renameInner = internalMutation({
  action: 'projects.rename',
  args: { projectId: v.id('projects'), name: v.string() },
  handler: async (ctx, { projectId, name }) => {
    await ctx.db.patch(projectId, { name })
  },
})
