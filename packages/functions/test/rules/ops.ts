import {
  internalMutationGeneric,
  internalQueryGeneric,
  makeFunctionReference,
  type FunctionReference,
} from 'convex/server'
import { v } from 'convex/values'

import { internalAction, internalMutation, internalQuery, mutation, query } from './fns'

/** A reference to one of this module's internal functions (no codegen in the fixture). */
const internal = <T extends 'query' | 'mutation' | 'action'>(name: string) =>
  makeFunctionReference(name) as unknown as FunctionReference<T, 'internal'>

// Handlers with the bugs row rules must catch. Each takes IDs as plain strings
// or none at all, so the argument check cannot see the tenant.

/** Forgets the tenant filter. */
export const allProjects = query({
  action: 'projects.read',
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => (await ctx.db.query('projects').collect()).map((p) => p.name),
})

/** Reads one org's projects correctly, through the tenant ID argument. */
export const orgProjects = query({
  action: 'projects.read',
  args: { orgId: v.id('orgs') },
  returns: v.array(v.string()),
  handler: async (ctx, { orgId }) =>
    (
      await ctx.db
        .query('projects')
        .withIndex('by_org', (q) => q.eq('orgId', orgId))
        .collect()
    ).map((p) => p.name),
})

/** Looks a project up by an unchecked string. */
export const projectName = query({
  action: 'projects.read',
  args: { id: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { id }) => {
    const projectId = ctx.db.normalizeId('projects', id)
    return projectId && ((await ctx.db.get(projectId))?.name ?? null)
  },
})

/** Archives by an unchecked string. */
export const archiveByString = mutation({
  action: 'projects.archive',
  args: { id: v.string() },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await ctx.db.patch(ctx.db.normalizeId('projects', id)!, { archived: true })
    return null
  },
})

/** Creates a project in an org named by an unchecked string. */
export const createInOrg = mutation({
  action: 'projects.archive',
  args: { orgId: v.string() },
  returns: v.null(),
  handler: async (ctx, { orgId }) => {
    await ctx.db.insert('projects', {
      orgId: ctx.db.normalizeId('orgs', orgId)!,
      name: 'planted',
      archived: false,
    })
    return null
  },
})

/** Reads every membership: other people's included. */
export const allMemberships = query({
  action: 'projects.read',
  args: {},
  returns: v.number(),
  handler: async (ctx) => (await ctx.db.query('memberships').collect()).length,
})

/** A raw internal query, as an app might write one. */
export const rawRead = internalQueryGeneric({
  args: { id: v.string() },
  handler: async (ctx, { id }) =>
    ((await ctx.db.get(id as never)) as { name?: string } | null)?.name ?? null,
})

/** Calls it, or schedules it. */
export const nested = mutation({
  action: 'projects.read',
  args: { id: v.string(), how: v.union(v.literal('call'), v.literal('schedule')) },
  returns: v.any(),
  handler: async (ctx, { id, how }) => {
    const ref = internal<'query'>('ops:rawRead')
    return how === 'call' ? ctx.runQuery(ref, { id }) : ctx.scheduler.runAfter(0, ref, { id })
  },
})

/** Reads everybody's scheduled functions. */
export const scheduled = query({
  action: 'projects.read',
  args: {},
  returns: v.any(),
  handler: async (ctx) => (await ctx.db.system.query('_scheduled_functions').collect()).length,
})

/** One org and one project; they must belong together. */
export const pair = query({
  action: 'projects.read',
  args: { orgId: v.id('orgs'), projectId: v.id('projects') },
  returns: v.null(),
  handler: async () => null,
})

/** Renames a project, with no check of its own that it is still active. */
export const renameProject = mutation({
  action: 'projects.rename',
  args: { projectId: v.id('projects'), name: v.string() },
  returns: v.null(),
  handler: async (ctx, { projectId, name }) => {
    await ctx.db.patch(projectId, { name })
    return null
  },
})

/** A table-qualified get naming the wrong table. */
export const wrongTable = query({
  action: 'projects.read',
  args: { id: v.string() },
  returns: v.any(),
  handler: async (ctx, { id }) => ctx.db.get('notes', id as never),
})

/** Forgets the tenant filter on one read path at a time; the foreign project comes first. */
export const readVia = query({
  action: 'projects.read',
  args: {
    how: v.union(
      ...(['take', 'first', 'paginate', 'search', 'forAwait', 'next'] as const).map((how) =>
        v.literal(how),
      ),
    ),
  },
  returns: v.any(),
  handler: async (ctx, { how }) => {
    const all = ctx.db.query('projects').order('desc')
    if (how === 'take') return (await all.take(10)).length
    if (how === 'first') return (await all.first())?.name
    if (how === 'paginate') return (await all.paginate({ numItems: 10, cursor: null })).page.length
    if (how === 'search')
      return (
        await ctx.db
          .query('projects')
          .withSearchIndex('search_name', (q) => q.search('name', 'secret'))
          .collect()
      ).length
    if (how === 'next')
      return ((await (all as any).next()) as { value?: { name: string } }).value?.name
    let n = 0
    for await (const _ of all) n++
    return n
  },
})

/** unique() over several rows; returns the error message. */
export const uniqueMessage = query({
  action: 'projects.read',
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    try {
      await ctx.db.query('projects').unique()
      return 'no error'
    } catch (error) {
      return (error as Error).message
    }
  },
})

/** Creates a new org from an action that is not allowed to. */
export const plantOrg = mutation({
  action: 'projects.read',
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await ctx.db.insert('orgs', { name: 'planted' })
    return null
  },
})

/** Demotes the caller, then archives in the same mutation. */
export const demoteThenArchive = mutation({
  action: 'projects.archive',
  args: { projectId: v.id('projects'), membershipId: v.id('memberships') },
  returns: v.null(),
  handler: async (ctx, { projectId, membershipId }) => {
    await ctx.db.patch(membershipId, { role: 'viewer' })
    await ctx.db.patch(projectId, { archived: true })
    return null
  },
})

/** Reads through a query method the library does not know (yet). */
export const unknownMethod = query({
  action: 'projects.read',
  args: { orgId: v.id('orgs') },
  returns: v.any(),
  handler: async (ctx, { orgId }) =>
    (ctx.db.query('projects').withIndex('by_org', (q) => q.eq('orgId', orgId)) as any).count(),
})

/** Published pages of an org: anyone may read them, signed in or not. */
export const publishedPages = query({
  action: 'pages.read',
  args: { orgId: v.id('orgs') },
  returns: v.array(v.string()),
  handler: async (ctx, { orgId }) =>
    (
      await ctx.db
        .query('pages')
        .withIndex('by_org', (q) => q.eq('orgId', orgId))
        .filter((q) => q.eq(q.field('published'), true))
        .collect()
    ).map((page) => page.title),
})

/** Every page of an org, drafts included: drafts are for members. */
export const allPages = query({
  action: 'pages.read',
  args: { orgId: v.id('orgs') },
  returns: v.array(v.string()),
  handler: async (ctx, { orgId }) =>
    (
      await ctx.db
        .query('pages')
        .withIndex('by_org', (q) => q.eq('orgId', orgId))
        .collect()
    ).map((page) => page.title),
})

export const editPage = mutation({
  action: 'pages.edit',
  args: { pageId: v.id('pages'), title: v.string() },
  returns: v.null(),
  handler: async (ctx, { pageId, title }) => {
    await ctx.db.patch(pageId, { title })
    return null
  },
})

/** An internal operation: archives as whoever the caller acts for. */
export const archiveFor = internalMutation({
  action: 'projects.archive',
  args: { projectId: v.id('projects') },
  returns: v.null(),
  handler: async (ctx, { projectId }) => {
    await ctx.db.patch(projectId, { archived: true })
    return null
  },
})

/** Reads a project's name as the caller, for an internal action. */
export const nameFor = internalQuery({
  action: 'projects.read',
  args: { projectId: v.id('projects') },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { projectId }) => (await ctx.db.get(projectId))?.name ?? null,
})

/** Work outside the database: reads and writes only through internal operations. */
export const checkAndArchive = internalAction({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    const name = await ctx.runQuery(
      makeFunctionReference<'query'>('ops:nameFor') as never,
      { projectId } as never,
    )
    if (name)
      await ctx.runMutation(
        makeFunctionReference<'mutation'>('ops:archiveFor') as never,
        { projectId } as never,
      )
    return null
  },
})

/** Archives now, or in an hour, or after an outside check, through internal operations. */
export const archiveVia = mutation({
  action: 'projects.archive',
  args: {
    projectId: v.id('projects'),
    how: v.union(v.literal('now'), v.literal('later'), v.literal('action')),
  },
  returns: v.null(),
  handler: async (ctx, { projectId, how }) => {
    const archive = makeFunctionReference<'mutation'>('ops:archiveFor') as never
    if (how === 'now') await ctx.runMutation(archive, { projectId } as never)
    else if (how === 'later')
      await ctx.scheduler.runAfter(60 * 60_000, archive, { projectId } as never)
    else
      await ctx.scheduler.runAfter(
        0,
        makeFunctionReference<'action'>('ops:checkAndArchive') as never,
        { projectId } as never,
      )
    return null
  },
})

/** Takes many IDs at once. */
export const many = query({
  action: 'projects.read',
  args: { ids: v.array(v.id('projects')) },
  returns: v.number(),
  handler: async (_ctx, { ids }) => ids.length,
})

/** A raw internal query without argument validators: Convex accepts any arguments for it. */
export const rawAnyArgs = internalQueryGeneric({
  handler: async (ctx) =>
    (await ctx.db.query('projects').collect()).map((p: { name: string }) => p.name),
})

/** Reaches for the raw function above. */
export const nestedAnyArgs = query({
  action: 'projects.read',
  args: {},
  returns: v.any(),
  handler: async (ctx) => ctx.runQuery(internal<'query'>('ops:rawAnyArgs')),
})

/** Demotes the caller in an internal operation. */
export const demoteSelf = internalMutation({
  action: 'projects.archive',
  args: { membershipId: v.id('memberships') },
  handler: async (ctx, { membershipId }) => {
    await ctx.db.patch(membershipId, { role: 'viewer' })
    return null
  },
})

/** Demotes the caller through a nested mutation, then archives: the role must be looked up again. */
export const demoteNestedThenArchive = mutation({
  action: 'projects.archive',
  args: { projectId: v.id('projects'), membershipId: v.id('memberships') },
  returns: v.null(),
  handler: async (ctx, { projectId, membershipId }) => {
    await ctx.runMutation(
      makeFunctionReference<'mutation'>('ops:demoteSelf') as never,
      { membershipId } as never,
    )
    await ctx.db.patch(projectId, { archived: true })
    return null
  },
})

/** A raw internal mutation that writes another tenant's row. */
export const rawWrite = internalMutationGeneric({
  // No validators: it runs whatever arguments it gets.
  handler: async (ctx, args: { input?: { id?: string } }) => {
    await ctx.db.patch(args.input!.id as never, { archived: true } as never)
    return null
  },
})

/** Reaches for the raw write and swallows the error. */
export const swallowRaw = mutation({
  action: 'projects.read',
  args: { id: v.string() },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await ctx.runMutation(internal<'mutation'>('ops:rawWrite'), { id }).catch(() => null)
    return null
  },
})

/** An internal action that reaches the raw write and hides the failure. */
export const rawFromAction = internalAction({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await ctx.runMutation(internal<'mutation'>('ops:rawWrite'), { id }).catch(() => null)
    return null
  },
})

export const scheduleRawAction = mutation({
  action: 'projects.read',
  args: { id: v.string() },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await ctx.scheduler.runAfter(0, internal<'action'>('ops:rawFromAction'), { id })
    return null
  },
})
