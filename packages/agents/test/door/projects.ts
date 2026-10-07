import { fail } from '@lupinum/better-convex-functions'
import { paginationOptsValidator, paginationResultValidator } from 'convex/server'
import { v } from 'convex/values'

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
  approval: async (ctx, { projectId }) =>
    `Archive the project "${(await ctx.db.get(projectId))?.name ?? 'unknown'}".`,
  handler: async (ctx, { projectId }) => {
    await ctx.db.patch(projectId, { status: 'archived' })
    return { id: projectId, status: 'archived' as const }
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
