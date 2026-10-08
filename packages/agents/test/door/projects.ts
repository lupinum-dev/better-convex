import { fail } from '@lupinum/better-convex-functions'
import { paginationOptsValidator, paginationResultValidator } from 'convex/server'
import { ConvexError, v } from 'convex/values'

import { mutation, query } from './fns'

const project = v.object({ id: v.id('projects'), name: v.string() })

export const create = mutation({
  action: 'projects.create',
  args: { orgId: v.id('orgs'), name: v.string() },
  returns: project,
  tool: { name: 'create_project', description: 'Create one project.' },
  handler: async (ctx, { orgId, name }) => {
    const trimmed = name.trim()
    if (!trimmed || trimmed.length > 100) fail('INVALID_INPUT', 'Use 1 to 100 characters.')
    const id = await ctx.db.insert('projects', { orgId, name: trimmed, status: 'active' })
    return { id, name: trimmed }
  },
})

export const archive = mutation({
  action: 'projects.archive',
  args: { projectId: v.id('projects') },
  returns: v.object({ id: v.id('projects'), status: v.literal('archived') }),
  tool: { name: 'archive_project', description: 'Archive a project.' },
  // The same summary as convex/projects.ts.
  plan: async (ctx, { projectId }) => ({
    summary: `Archive the project "${(await ctx.db.get(projectId))?.name ?? 'unknown'}".`,
  }),
  handler: async (ctx, { projectId }) => {
    await ctx.db.patch(projectId, { status: 'archived' })
    return { id: projectId, status: 'archived' as const }
  },
})

/** C4: a write whose result is too large for one response. */
export const report = mutation({
  action: 'projects.create',
  args: { orgId: v.id('orgs'), size: v.number() },
  returns: v.string(),
  tool: { name: 'large_report', description: 'Write a report and return it.' },
  handler: async (ctx, { orgId, size }) => {
    await ctx.db.insert('projects', { orgId, name: 'report', status: 'active' })
    return 'y'.repeat(size)
  },
})

/** E9: a paginated operation, as a web query and as a tool. */
export const page = query({
  action: 'projects.search',
  args: { orgId: v.id('orgs'), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(project),
  tool: { name: 'list_projects', description: 'List projects, one page at a time.' },
  handler: async (ctx, { orgId, paginationOpts }) => {
    const result = await ctx.db
      .query('projects')
      .withIndex('by_org_status', (q) => q.eq('orgId', orgId).eq('status', 'active'))
      .paginate(paginationOpts)
    return { ...result, page: result.page.map(({ _id, name }) => ({ id: _id, name })) }
  },
})

/** A result of quote-heavy text: the response escapes it twice. */
export const quotes = mutation({
  action: 'projects.create',
  args: { orgId: v.id('orgs'), size: v.number() },
  returns: v.string(),
  tool: { name: 'quoted_report', description: 'Write a report and return it.' },
  handler: async (ctx, { orgId, size }) => {
    await ctx.db.insert('projects', { orgId, name: 'report', status: 'active' })
    return '"'.repeat(size)
  },
})

/** A result of ordinary rows, about 79 bytes of text each. */
export const rows = mutation({
  action: 'projects.create',
  args: { orgId: v.id('orgs'), count: v.number() },
  returns: v.array(v.object({ id: v.string(), name: v.string(), status: v.string() })),
  tool: { name: 'rows_report', description: 'Write a report and return rows.' },
  handler: async (ctx, { orgId, count }) => {
    await ctx.db.insert('projects', { orgId, name: 'report', status: 'active' })
    return Array.from({ length: count }, (_, i) => ({
      id: `k57${String(i).padStart(29, '0')}`,
      name: `Project number ${i}`,
      status: 'active',
    }))
  },
})

/** A nullable file argument: a system-table ID in a union. */
export const attach = mutation({
  action: 'projects.create',
  args: { orgId: v.id('orgs'), file: v.union(v.id('_storage'), v.null()) },
  returns: v.string(),
  tool: { name: 'attach_file', description: 'Attach a file, or none.' },
  handler: async (_ctx, { file }) => (file === null ? 'none' : 'file'),
})

/** Convex reports an invalid cursor as this `ConvexError`. */
export const brokenPage = query({
  action: 'projects.search',
  args: { orgId: v.id('orgs'), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(project),
  tool: { name: 'list_broken', description: 'List projects; the cursor is always refused.' },
  handler: async () => {
    throw new ConvexError({ isConvexSystemError: true, paginationError: 'InvalidCursor' })
  },
})
