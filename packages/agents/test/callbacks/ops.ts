import { makeFunctionReference } from 'convex/server'
import { v } from 'convex/values'

import {
  internalAction,
  internalMutation,
  internalQuery,
  job,
  mutation,
  query,
  seen,
  snapshot,
} from './fns'

// Each function records the context its handler gets under its own name in `seen`.

const ref = (name: string) => makeFunctionReference<any>(`ops:${name}`) as never
const orgId = v.id('orgs')
/** A `checked` row to read, so its custom rule runs as this call's actor. */
const checkedId = v.optional(v.string())

async function readChecked(ctx: any, id: string | undefined) {
  if (id !== undefined) await ctx.db.get(ctx.db.normalizeId('checked', id))
}

/** Runs an internal query now, and schedules an internal mutation and an internal action. */
async function reachInternals(ctx: any, input: { orgId: string; checkedId?: string }) {
  await ctx.runQuery(ref('probeInternalQuery'), input)
  await ctx.scheduler.runAfter(0, ref('probeInternalMutation'), input)
  await ctx.scheduler.runAfter(0, ref('probeAction'), input)
}

export const probeQuery = query({
  action: 'probe.read',
  args: { orgId },
  returns: v.null(),
  handler: (ctx) => {
    seen.set('query', snapshot(ctx))
    return null
  },
})

export const probeMutation = mutation({
  action: 'probe.edit',
  args: { orgId },
  returns: v.null(),
  tool: { name: 'probe_edit', description: 'Record what the handler gets.' },
  handler: async (ctx, input) => {
    seen.set('mutation', snapshot(ctx))
    await reachInternals(ctx, input)
    return null
  },
})

/** Public, so a signed-out visitor reaches it. */
export const probePublic = query({
  action: 'probe.public',
  args: {},
  returns: v.null(),
  handler: (ctx) => {
    seen.set('query', snapshot(ctx))
    return null
  },
})

/** Needs a person's approval when an agent calls it. */
export const probeAsk = mutation({
  action: 'probe.ask',
  args: { orgId, checkedId },
  returns: v.null(),
  tool: { name: 'probe_ask', description: 'Record what the summary and the handler get.' },
  approval: (ctx) => {
    seen.set('approval summary', snapshot(ctx))
    return 'Probe.'
  },
  handler: async (ctx, input) => {
    seen.set('mutation', snapshot(ctx))
    await readChecked(ctx, input.checkedId)
    await reachInternals(ctx, input)
    return null
  },
})

/** Its agent rule records what it gets. */
export const probeRule = mutation({
  action: 'probe.rule',
  args: { orgId, note: v.optional(v.string()) },
  returns: v.null(),
  tool: { name: 'probe_rule', description: 'Run the agent rule.' },
  handler: () => null,
})

export const probeInternalQuery = internalQuery({
  action: 'probe.read',
  args: { orgId, checkedId },
  handler: (ctx) => {
    seen.set('internal query', snapshot(ctx))
    return null
  },
})

export const probeInternalMutation = internalMutation({
  action: 'probe.edit',
  args: { orgId, checkedId },
  handler: async (ctx, { checkedId }) => {
    seen.set('internal mutation', snapshot(ctx))
    await readChecked(ctx, checkedId)
    return null
  },
})

export const probeAction = internalAction({
  args: { orgId, checkedId },
  handler: async (ctx) => {
    seen.set('internal action', snapshot(ctx))
    return null
  },
})

export const probeJob = job({
  name: 'probe',
  args: { orgId },
  handler: async (ctx, input) => {
    seen.set('job', snapshot(ctx))
    await ctx.runMutation(ref('probeInternalMutation'), input)
  },
})

const table = v.union(
  v.literal('checked'),
  v.literal('eitherChecked'),
  v.literal('bothChecked'),
  v.literal('publicChecked'),
)

/** Reads a row by an unchecked string: `'read'`, or `'hidden'` when the rules hide it. */
export const readRow = query({
  action: 'probe.read',
  args: { table, id: v.string() },
  returns: v.string(),
  handler: async (ctx, { table, id }) =>
    (await ctx.db.get(ctx.db.normalizeId(table, id)!)) === null ? 'hidden' : 'read',
})

/** Changes a row by an unchecked string. */
export const editRow = mutation({
  action: 'probe.edit',
  args: { table, id: v.string() },
  returns: v.string(),
  handler: async (ctx, { table, id }) => {
    await ctx.db.patch(ctx.db.normalizeId(table, id)!, { edits: 1 })
    return 'edited'
  },
})
