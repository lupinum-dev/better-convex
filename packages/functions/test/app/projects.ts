import { fail, oneLine } from '@lupinum/better-convex-functions'
import { paginationOptsValidator, paginationResultValidator } from 'convex/server'
import { v } from 'convex/values'

import { job, mutation, query } from './functions'
import { role } from './schema'

const project = v.object({ id: v.id('projects'), name: v.string() })

/** A name a person can read: one line, no invisible characters, 1 to 100 characters. */
function projectName(name: string) {
  const clean = oneLine(name, 101)
  if (!clean || clean.length > 100) fail('INVALID_INPUT', 'name: use 1 to 100 visible characters.')
  return clean
}

export const organizations = query({
  action: 'organizations.list',
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(
    v.object({ id: v.id('organizations'), name: v.string(), role }),
  ),
  handler: async (ctx, { paginationOpts }) => {
    const memberships = await ctx.db
      .query('memberships')
      .withIndex('by_user', (q) => q.eq('userId', ctx.actor.user._id))
      .paginate(paginationOpts)
    return {
      ...memberships,
      page: await Promise.all(
        memberships.page.map(async ({ organizationId, role }) => ({
          id: organizationId,
          name: (await ctx.db.get(organizationId))?.name ?? '',
          role,
        })),
      ),
    }
  },
})

export const search = query({
  action: 'projects.search',
  args: {
    organizationId: v.id('organizations'),
    text: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(project),
  tool: {
    name: 'search_projects',
    description:
      'Find active projects in an organization by name, newest first when there is no text.',
    args: { text: 'Words from the project name. Leave it out to list all.' },
  },
  handler: async (ctx, { organizationId, text, paginationOpts }) => {
    const rows = text?.trim()
      ? await ctx.db
          .query('projects')
          .withSearchIndex('search_name', (q) =>
            q.search('name', text).eq('organizationId', organizationId).eq('status', 'active'),
          )
          .paginate(paginationOpts)
      : await ctx.db
          .query('projects')
          .withIndex('by_org_status', (q) =>
            q.eq('organizationId', organizationId).eq('status', 'active'),
          )
          .order('desc')
          .paginate(paginationOpts)
    return { ...rows, page: rows.page.map(({ _id, name }) => ({ id: _id, name })) }
  },
})

export const create = mutation({
  action: 'projects.create',
  args: { organizationId: v.id('organizations'), name: v.string() },
  returns: project,
  handler: async (ctx, { organizationId, name }) => {
    const clean = projectName(name)
    const id = await ctx.db.insert('projects', { organizationId, name: clean, status: 'active' })
    return { id, name: clean }
  },
})

export const rename = mutation({
  action: 'projects.rename',
  args: { projectId: v.id('projects'), name: v.string() },
  returns: project,
  handler: async (ctx, { projectId, name }) => {
    const clean = projectName(name)
    await ctx.db.patch(projectId, { name: clean })
    return { id: projectId, name: clean }
  },
})

export const archive = mutation({
  action: 'projects.archive',
  args: { projectId: v.id('projects') },
  returns: v.object({ id: v.id('projects'), status: v.literal('archived') }),
  tool: { name: 'archive_project', description: 'Archive a project. The app can restore it.' },
  approval: async (ctx, { projectId }) =>
    `Archive the project "${(await ctx.db.get(projectId))?.name ?? 'unknown'}".`,
  // The library finds the project's organization through the `projects` row rule.
  handler: async (ctx, { projectId }) => {
    const found = await ctx.db.get(projectId)
    if (found?.status !== 'active') fail('NOT_FOUND', 'This project is not active.')
    await ctx.db.patch(projectId, { status: 'archived', archivedAt: Date.now() })
    return { id: projectId, status: 'archived' as const }
  },
})

const thirtyDays = 30 * 86_400_000

/** Deletes projects archived more than 30 days ago. Runs as the system. */
export const cleanup = job({
  name: 'cleanup',
  args: {},
  handler: async (ctx) => {
    const old = await ctx.db
      .query('projects')
      .withIndex('by_status_archived', (q) =>
        q.eq('status', 'archived').lt('archivedAt', Date.now() - thirtyDays),
      )
      .take(200)
    for (const { _id } of old) await ctx.db.delete(_id)
    return { deleted: old.length }
  },
})
