import { fail, oneLine } from '@lupinum/better-convex-functions'
import { paginationOptsValidator, paginationResultValidator } from 'convex/server'
import { v } from 'convex/values'

import { internal } from './_generated/api'
import { internalAction, internalMutation, job, mutation, query } from './functions'

const status = v.union(
  v.literal('queued'),
  v.literal('running'),
  v.literal('ok'),
  v.literal('failed'),
)

const check = v.object({
  id: v.id('siteChecks'),
  status,
  startedAt: v.number(),
  finishedAt: v.optional(v.number()),
  score: v.optional(v.number()),
  summary: v.optional(v.string()),
})

/**
 * Queue one paid check of a site. The `dispatchChecks` job starts it.
 *
 * Why a queue and not `ctx.scheduler.runAfter(0, internal.sites.runCheck, …)`: when an agent's
 * request is approved, every follow-up it schedules carries the approval, and an internal
 * operation under an approval runs only while `approve` itself runs. The scheduled check would
 * fail with APPROVAL_NOT_FOUND. A job runs as the system, so it can start the check later.
 */
export const triggerCheck = mutation({
  action: 'sites.check',
  args: { siteId: v.id('sites') },
  returns: v.object({ checkId: v.id('siteChecks') }),
  tool: {
    name: 'trigger_site_check',
    description:
      'Start a check of one site. A check costs money, so a person approves it first. Use list_site_checks for the result.',
  },
  approval: async (ctx, { siteId }) =>
    `Run a paid check of the site "${(await ctx.db.get(siteId))?.name ?? 'unknown'}".`,
  handler: async (ctx, { siteId }) => {
    const site = await ctx.db.get(siteId)
    if (!site) fail('NOT_FOUND', 'No site with this ID.')
    for (const busy of ['queued', 'running'] as const) {
      const open = await ctx.db
        .query('siteChecks')
        .withIndex('by_site_status', (q) => q.eq('siteId', siteId).eq('status', busy))
        .first()
      if (open) fail('CONFLICT', 'A check of this site is already waiting or running.')
    }
    const checkId = await ctx.db.insert('siteChecks', {
      organizationId: site.organizationId,
      siteId,
      status: 'queued',
      requestedBy: ctx.actor.user._id,
      startedAt: Date.now(),
    })
    return { checkId }
  },
})

/** The checks of one site, newest first. */
export const listChecks = query({
  action: 'sites.listChecks',
  args: { siteId: v.id('sites'), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(check),
  tool: {
    name: 'list_site_checks',
    description: 'List the checks of one site, newest first, with their status and score.',
  },
  handler: async (ctx, { siteId, paginationOpts }) => {
    const page = await ctx.db
      .query('siteChecks')
      .withIndex('by_site_status', (q) => q.eq('siteId', siteId))
      .order('desc')
      .paginate(paginationOpts)
    return {
      ...page,
      page: page.page.map(({ _id, status, startedAt, finishedAt, score, summary }) => ({
        id: _id,
        status,
        startedAt,
        finishedAt,
        score,
        summary,
      })),
    }
  },
})

/** Starts queued checks. A cron runs it every minute. */
export const dispatchChecks = job({
  name: 'dispatchChecks',
  args: {},
  handler: async (ctx) => {
    const queued = await ctx.db
      .query('siteChecks')
      .withIndex('by_status', (q) => q.eq('status', 'queued'))
      .take(50)
    for (const { _id } of queued) {
      await ctx.db.patch(_id, { status: 'running' })
      await ctx.scheduler.runAfter(0, internal.sites.runCheck, { checkId: _id })
    }
    return { started: queued.length }
  },
})

/** The check itself. A real one would fetch the site; this one makes up a result. */
export const runCheck = internalAction({
  args: { checkId: v.id('siteChecks') },
  returns: v.null(),
  handler: async (ctx, { checkId }) => {
    const score = 50 + (checkId.length % 50)
    await ctx.runMutation(internal.sites.recordResult, {
      checkId,
      score,
      summary: `Fake check: score ${score}.`,
    })
    return null
  },
})

export const recordResult = internalMutation({
  action: 'sites.check',
  args: { checkId: v.id('siteChecks'), score: v.number(), summary: v.string() },
  returns: v.null(),
  handler: async (ctx, { checkId, score, summary }) => {
    const found = await ctx.db.get(checkId)
    if (found?.status !== 'running') fail('NOT_FOUND', 'This check is not running.')
    await ctx.db.patch(checkId, {
      status: score >= 50 ? 'ok' : 'failed',
      finishedAt: Date.now(),
      score,
      summary: oneLine(summary, 500),
    })
    return null
  },
})
