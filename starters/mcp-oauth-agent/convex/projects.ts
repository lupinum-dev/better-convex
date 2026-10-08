import { fail, oneLine } from '@lupinum/better-convex-functions'
import { paginationOptsValidator, paginationResultValidator } from 'convex/server'
import { v } from 'convex/values'

import { mutation, query } from './functions'
import { role } from './schema'

// Each operation is a web function and, with `tool`, an MCP tool (convex/agents.ts). The library
// checks the caller, the policy and every row before and while the handler runs.

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
  tool: {
    name: 'list_organizations',
    description: 'List your organizations and your role in each. Use an ID with the project tools.',
  },
  handler: async (ctx, { paginationOpts }) => {
    const memberships = await ctx.db
      .query('memberships')
      .withIndex('by_user', (q) => q.eq('userId', ctx.actor.user._id).eq('status', 'active'))
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
  tool: {
    name: 'create_project',
    description: 'Create one project in an organization.',
    args: { name: '1 to 100 characters, one line.' },
  },
  handler: async (ctx, { organizationId, name }) => {
    const clean = projectName(name)
    const id = await ctx.db.insert('projects', {
      organizationId,
      name: clean,
      status: 'active',
      createdBy: ctx.actor.user._id,
    })
    return { id, name: clean }
  },
})

export const rename = mutation({
  action: 'projects.rename',
  args: { projectId: v.id('projects'), name: v.string(), from: v.optional(v.string()) },
  returns: project,
  tool: {
    name: 'rename_project',
    description: 'Rename one project.',
    args: {
      name: '1 to 100 characters, one line.',
      from: 'The current name as you last saw it. If someone renamed it since, nothing changes and you are told.',
    },
  },
  handler: async (ctx, { projectId, name, from }) => {
    const clean = projectName(name)
    const current = await ctx.db.get(projectId)
    if (!current) fail('NOT_FOUND', 'No projects with this ID.')
    // Two people (or agents) renaming at once: the second learns about the first instead of overwriting it.
    if (from !== undefined && current.name !== from) {
      fail(
        'CONFLICT',
        `The project is now called "${current.name}". Check that the new name still fits.`,
      )
    }
    await ctx.db.patch(projectId, { name: clean })
    return { id: projectId, name: clean }
  },
})

export const archive = mutation({
  action: 'projects.archive',
  args: { projectId: v.id('projects') },
  returns: v.object({ id: v.id('projects'), status: v.literal('archived') }),
  tool: { name: 'archive_project', description: 'Archive a project. The app can restore it.' },
  // What the person reads before approving an agent's request.
  plan: async (ctx, { projectId }) => ({
    summary: `Archive the project "${(await ctx.db.get(projectId))?.name ?? 'unknown'}".`,
  }),
  handler: async (ctx, { projectId }) => {
    const found = await ctx.db.get(projectId)
    if (found?.status !== 'active') fail('NOT_FOUND', 'This project is not active.')
    await ctx.db.patch(projectId, { status: 'archived', archivedAt: Date.now() })
    return { id: projectId, status: 'archived' as const }
  },
})
