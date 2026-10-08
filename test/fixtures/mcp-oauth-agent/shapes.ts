// Test-only functions for test/integration/convex-shapes.integration.test.ts. The suite copies
// this file into a temporary starter copy as `convex/shapes.ts`; it is never part of the starter.
// Every export is internal, so only the deployment operator (`convex run`) can call it.
//
// The functions here provoke what only the real backend produces, and report it as data: the
// shape of Convex's own errors, and what the library makes of them.
import { defineTools } from '@lupinum/better-convex-agents'
import { finish, toolFailure } from '@lupinum/better-convex-agents/internal'
import { makeFunctionReference } from 'convex/server'
import { v } from 'convex/values'

import { internal } from './_generated/api'
import { internalAction, internalMutation } from './_generated/server'
import { fns } from './functions'

/** An organization the fixture user owns, with two projects, and two running in-app agent runs. */
export const setup = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const user = await ctx.db
      .query('users')
      .withIndex('by_email', (q) => q.eq('email', email))
      .unique()
    if (!user?.active) throw new Error('SHAPES_USER_NOT_FOUND')
    const organizationId = await ctx.db.insert('organizations', { name: 'Shapes' })
    await ctx.db.insert('memberships', {
      organizationId,
      userId: user._id,
      role: 'owner',
      status: 'active',
    })
    const [projectId] = await Promise.all(
      ['Roadmap', 'Backlog'].map((name) =>
        ctx.db.insert('projects', {
          organizationId,
          name,
          status: 'active',
          createdBy: user._id,
        }),
      ),
    )
    const grantId = await ctx.db.insert('agentGrants', {
      authId: user.authId,
      userId: user._id,
      agent: 'shapes',
      scopes: ['mcp:read', 'mcp:write'],
      expiresAt: Date.now() + 86_400_000,
    })
    const [runId, otherRunId] = await Promise.all(
      ['Check what the backend does', 'Be ended'].map((task) =>
        ctx.db.insert('agentRuns', {
          grantId,
          userId: user._id,
          agent: 'shapes',
          step: 'shapes:step',
          task,
          status: 'running',
          turn: 1,
          steps: 1,
          stepAt: Date.now(),
        }),
      ),
    )
    return { organizationId, projectId, runId, otherRunId, userId: user._id }
  },
})

/**
 * One tool call the way the MCP door makes it (a nested run of the tool's internal function),
 * and its failure the way the door reports it to a host.
 */
export const callTool = internalAction({
  args: {
    kind: v.union(v.literal('query'), v.literal('mutation')),
    path: v.string(),
    call: v.any(),
  },
  handler: async (ctx, { kind, path, call }) => {
    try {
      const output =
        kind === 'query'
          ? await ctx.runQuery(makeFunctionReference<'query'>(path) as never, call)
          : await ctx.runMutation(makeFunctionReference<'mutation'>(path) as never, call)
      return { output }
    } catch (error) {
      return { failure: toolFailure(error) }
    }
  },
})

export const storeFile = internalAction({
  args: {},
  handler: async (ctx) => await ctx.storage.store(new Blob(['shapes'])),
})

/** A nullable file argument, the common `v.union(v.id('_storage'), v.null())`, through an operation. */
export const withFile = fns.internalQuery({
  action: 'projects.search',
  args: { file: v.union(v.id('_storage'), v.null()) },
  returns: v.string(),
  handler: async () => 'ok',
})

/** What Convex throws for a cursor that parses but belongs to another query. */
export const cursorShapes = internalMutation({
  args: {},
  handler: async (ctx) => {
    const page = await ctx.db.query('projects').paginate({ numItems: 1, cursor: null })
    try {
      await ctx.db.query('memberships').paginate({ numItems: 1, cursor: page.continueCursor })
      return null
    } catch (error) {
      const e = error as { name?: string; message?: string; data?: unknown }
      return { name: e.name, data: e.data }
    }
  },
})

/** Convex's refusal of a document over 1 MiB, as the backend words it. */
export const insertTooLarge = internalMutation({
  args: { organizationId: v.id('organizations'), createdBy: v.id('users') },
  handler: async (ctx, { organizationId, createdBy }) => {
    try {
      await ctx.db.insert('projects', {
        organizationId,
        name: 'x'.repeat(1_100_000),
        status: 'active',
        createdBy,
      })
      return null
    } catch (error) {
      const e = error as { name?: string; message?: string; data?: unknown }
      return { name: e.name, message: e.message, data: e.data }
    }
  },
})

/** An approval whose plan weighs `size` characters. */
const archiveSized = fns.mutation({
  action: 'projects.archive',
  args: { projectId: v.id('projects'), size: v.number() },
  returns: v.string(),
  tool: { name: 'archive_sized', description: 'Archive a project, with a plan of a given size.' },
  plan: async (_ctx, { projectId, size }) => ({
    summary: 'Archive',
    rows: [projectId],
    contents: 'x'.repeat(size),
  }),
  handler: async () => 'archived',
})

export const tools = defineTools(fns, { sized: { archiveSized } }, { functions: internal.shapes })
export const { archive_sized, check_approval, housekeeping } = tools.functions

/** Ends a run the way the in-app agent runtime does, and reports what happened to its open request. */
export const endRun = internalMutation({
  args: { runId: v.id('agentRuns'), approvalId: v.id('approvals') },
  handler: async (ctx, { runId, approvalId }) => {
    const before = (await ctx.db.get(approvalId))?.status
    await finish(ctx.db as never, (await ctx.db.get(runId))!, { status: 'done', answer: 'Done' })
    return { before, after: (await ctx.db.get(approvalId))?.status }
  },
})
