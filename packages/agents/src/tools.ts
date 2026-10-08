import {
  fail,
  oneLine,
  type Actor,
  type ErrorCode,
  type Policy,
  type TenantRef,
} from '@lupinum/better-convex-functions'
import {
  actorRecord,
  agentCallerValidator,
  approversFor,
  callKey,
  checkInput,
  failureOf,
  fingerprint,
  frozen,
  guarded,
  idsIn,
  inertMarkdown,
  jsonOf,
  internalsOf,
  OPERATION,
  planOf,
  scopesFor,
  storable,
  toJsonSchema,
  toolNamePattern,
  unsendable,
  type AgentCaller,
  type LibraryDataModel,
  type Operation,
  type Plan,
  type ToolSpec,
  readOnly,
} from '@lupinum/better-convex-functions/internal'
import {
  internalMutationGeneric,
  internalQueryGeneric,
  makeFunctionReference,
  mutationGeneric,
  queryGeneric,
  type FunctionReference,
  type GenericMutationCtx,
  type GenericQueryCtx,
} from 'convex/server'
import { getConvexSize, v, type GenericId, type Value } from 'convex/values'

import type { McpPrincipal } from './access'
import { cancelRequests, finish, shownStatus, stallAfter, wake } from './runs'

type Ctx = GenericQueryCtx<any>
type MCtx = GenericMutationCtx<any>
type Lib = GenericMutationCtx<LibraryDataModel>['db']
type ToolOp = Operation & { tool: ToolSpec<string, any> }
type Agent = Extract<Actor<{ _id: string }>, { kind: 'agent' }>

/** The internals of `defineFunctions(...)` the tools need. */
interface Internals {
  person(ctx: Ctx): Promise<Extract<Actor<{ _id: string }>, { kind: 'person' }>>
  agent(ctx: Ctx, caller: AgentCaller, options?: { approved?: boolean }): Promise<Agent>
  authorize(
    ctx: Ctx,
    op: Pick<Operation, 'action' | 'args'>,
    actor: Actor<{ _id: string }>,
    input: Record<string, unknown>,
  ): Promise<{
    decision: 'allow' | 'approve'
    tenant: TenantRef | undefined
    rows: Map<string, Record<string, unknown> | null>
    settle: <T>(value: T) => T
    mayWrite(table: string, row: Record<string, unknown>): Promise<boolean>
    ctx: any
  }>
  lib(ctx: { db: unknown }): Lib
  tenants: {
    refOf(db: unknown, value: unknown): TenantRef | undefined
    rowTenant(db: unknown, table: string, row: Record<string, unknown>): TenantRef | undefined
    tenantFieldsOf: Map<string, readonly string[]>
    tableOf(db: unknown, id: string): string | undefined
  }
  roleOf(ctx: Ctx, user: { _id: string }, tenant: TenantRef): Promise<string | null>
}

/** One tool as a door publishes it. */
export interface CatalogEntry {
  name: string
  description: string
  kind: 'query' | 'mutation'
  /** The tool's internal function. */
  ref: FunctionReference<'query' | 'mutation', 'internal'>
  inputSchema: Record<string, unknown>
  /** `'always'`, `'never'`, or `'maybe'` when the agent rule reads the input. */
  approval: 'always' | 'never' | 'maybe'
  /** Grant scopes that unlock this tool; empty for built-in tools every agent has. */
  scopes: string[]
}

const approvalTtl = 30 * 60_000
const stale =
  'Nothing was done: this changed after the agent asked (it may already be done). The agent can ask again if it is still needed.'
/** Write tool calls per agent connection per minute (B1). */
const agentWritesPerMinute = 60
/** Open approval requests per agent; past it the agent is told to wait (B2). */
const openApprovals = 20
/** Rows one request may cover; each is fingerprinted for the stale check. */
const maxSeen = 500
/** A result too large to keep for replay. */
const truncated = v.object({ truncated: v.literal(true), bytes: v.number() })
const reserved = new Set(['check_approval', 'housekeeping'])
/**
 * Days kept, then deleted by housekeeping: the activity log is the audit record (a year), a
 * decided request is covered by its activity row, and a finished run's messages were working
 * memory.
 */
const retention = { activity: 365, approvals: 90, runs: 30 }
const day = 86_400_000

/** What a tool returns while a person decides. */
const needsApproval = v.object({
  status: v.literal('needs_approval'),
  approvalId: v.string(),
  summary: v.string(),
  url: v.string(),
})

/** Turns any failure into what an agent may see: a coded failure, a known platform error, or nothing internal. */
export function toolFailure(error: unknown): { code: string; message: string } {
  const coded = failureOf(error)
  if (coded) return coded
  const message = error instanceof Error ? error.message : String(error)
  if (/OptimisticConcurrencyControl|changed while this mutation was being run/i.test(message)) {
    return {
      code: 'CONFLICT',
      message: 'Someone changed the same data at the same moment. Try again.',
    }
  }
  // Convex: "Could not find function for 'x:y'"; convex-test: "... but there is no such export".
  if (/Could not find (?:public )?function|there is no such export/i.test(message)) {
    console.error(
      'tool failed: its function does not exist. `defineTools(..., { functions })` must be internal.<the module that calls defineTools>, ' +
        'and that module must export every tool function.',
      error,
    )
  } else console.error('tool failed', error)
  return { code: 'FAILED', message: 'The tool failed. Try again later.' }
}

/** The tools a grant unlocks: the built-in tools, and each tool one of its scopes names. */
export function grantedTools(catalog: readonly CatalogEntry[], principal: McpPrincipal) {
  return catalog.filter(
    (entry) =>
      entry.scopes.length === 0 || entry.scopes.some((scope) => principal.scopes.includes(scope)),
  )
}

/** What a tool call returns: the object the MCP door puts in `structuredContent`. */
export type ToolSuccess =
  | { status: 'done'; result: unknown }
  | { status: 'needs_approval'; approvalId: string; summary: string; url: string }

/** What runs a tool's internal function: an action's `ctx`, or a convex-test client. */
export interface ToolRunner {
  runQuery(ref: FunctionReference<'query', 'internal'>, args: object): Promise<any>
  runMutation(ref: FunctionReference<'mutation', 'internal'>, args: object): Promise<any>
}

/**
 * One tool call as an MCP host sends it: `args` are the host's arguments, `request_id`
 * included. The MCP door and `callTool` both use it, so a test calls a tool exactly as a host
 * does. It rejects with the tool's own error; the door turns that into a result with
 * `toolFailure`.
 */
export async function toolCall(
  entry: CatalogEntry,
  args: Record<string, unknown> | undefined,
  principal: McpPrincipal,
  run: ToolRunner,
): Promise<ToolSuccess> {
  const { request_id: rawRequestId, ...input } = args ?? {}
  // Models send numbers for "IDs" they make up; the same number must still deduplicate.
  const requestId = typeof rawRequestId === 'number' ? String(rawRequestId) : rawRequestId
  const invalid = unsendable(input)
  if (invalid) fail(invalid.code, invalid.message)
  const call = {
    caller: { door: 'mcp' as const, principal },
    input,
    ...(typeof requestId === 'string' ? { requestId } : {}),
  }
  return entry.kind === 'mutation'
    ? await run.runMutation(entry.ref as FunctionReference<'mutation', 'internal'>, call)
    : await run.runQuery(entry.ref as FunctionReference<'query', 'internal'>, call)
}

/**
 * Collects the operations that have a `tool` field from app modules. Returns
 * one internal function per tool (export them under the tool's name), the
 * catalog the doors publish, the approval functions, the activity feed and
 * housekeeping for a cron.
 *
 * Change tools additively: a new argument is optional, an old one keeps its
 * meaning. MCP hosts cache the tool list until they reconnect, and this door
 * is stateless, so it cannot tell them it changed (G11). A breaking change
 * gets a new tool name, and the old one stays until no host uses it.
 *
 * Non-generic on purpose: it receives `internal.<its own module>`, which
 * TypeScript resolves without a type loop only for a plain signature.
 */
export function defineTools(
  /** The object `defineFunctions` returned. */
  fns: { policy: Policy },
  modules: Record<string, Record<string, unknown>>,
  options: {
    /** `internal.<module>` of the module that calls this and exports the tool functions. */
    functions: Record<string, FunctionReference<'query' | 'mutation', 'internal'>>
  },
) {
  const { policy } = fns
  const { person, agent, authorize, lib, tenants, roleOf } = internalsOf(fns) as Internals
  const ownRef = (name: string) => options.functions[name] as FunctionReference<any, 'internal'>

  const operations = new Map<string, ToolOp>()
  for (const module of Object.values(modules)) {
    for (const value of Object.values(module)) {
      const op = (value as { [OPERATION]?: Operation } | null)?.[OPERATION]
      if (!op?.tool) continue
      const { name } = op.tool
      if (reserved.has(name))
        throw new Error(`${name} is a built-in tool. Give this tool another name.`)
      if (!toolNamePattern.test(name)) {
        throw new Error(
          `Tool name "${name}": use 1 to 64 letters, digits, "_" or "-". Some hosts reject anything else.`,
        )
      }
      // Every tool: the dispatch takes request_id out of each call (release review).
      if ('request_id' in op.args) {
        throw new Error(
          `${name}: the argument name request_id is reserved for retry keys. Rename the argument.`,
        )
      }
      if (operations.has(name)) throw new Error(`Two operations use the tool name ${name}.`)
      if (isPaged(op) && ('cursor' in op.args || 'limit' in op.args)) {
        throw new Error(
          `${name}: a paginated tool gets cursor and limit from the library. Rename those arguments.`,
        )
      }
      // Throws for arguments JSON cannot carry, before any agent meets them.
      toJsonSchema(jsonOf(v.object(toolArgs(op))), name)
      operations.set(name, op as ToolOp)
    }
  }

  /** Checks a model's input against the operation's validators: one clear message, `null` for optional fields allowed. */
  function inputOf(ctx: Ctx, op: Pick<Operation, 'args'>, raw: unknown): Record<string, unknown> {
    const checked = checkInput(
      jsonOf(v.object(op.args)),
      raw ?? {},
      (table, value) => ctx.db.normalizeId(table, value) !== null,
    )
    if (!checked.ok) fail('INVALID_INPUT', checked.message)
    return checked.value as Record<string, unknown>
  }

  /** Fixed one-minute windows; a refused call does not count (its transaction rolls back). */
  async function rateLimit(ctx: MCtx, key: string, perMinute: number) {
    const window = Math.floor(Date.now() / 60_000)
    const row = await lib(ctx)
      .query('rateLimits')
      .withIndex('by_key', (q) => q.eq('key', key).eq('window', window))
      .unique()
    if ((row?.count ?? 0) >= perMinute) {
      const wait = Math.ceil(((window + 1) * 60_000 - Date.now()) / 1000)
      fail(
        'RATE_LIMITED',
        `This connection made ${perMinute} changes in the last minute. Try again in ${wait} seconds.`,
      )
    }
    if (row) await lib(ctx).patch(row._id, { count: row.count + 1 })
    else await lib(ctx).insert('rateLimits', { key, window, count: 1 })
  }

  function approvalUrl(approvalId: string) {
    const site = process.env.SITE_URL
    // A relative link means nothing to an MCP host: fail loudly where the developer sees it.
    if (!site)
      throw new Error(
        'Set the SITE_URL environment variable on the Convex deployment: approval links need it.',
      )
    return `${site.replace(/\/$/, '')}/approvals/${approvalId}`
  }

  /** Runs an operation for an agent and records it. Shared by tool calls and approvals. */
  async function runForAgent(
    ctx: MCtx,
    checked: any,
    settle: <T>(value: T) => T,
    op: ToolOp,
    input: Record<string, unknown>,
    plan: Plan,
    extra: {
      tenant?: TenantRef
      requestId?: string
      approvalId?: GenericId<'approvals'>
      decidedBy?: string
    },
  ) {
    const result = settle(await op.handler(checked, input, plan))
    await lib(ctx).insert('activity', {
      actor: actorRecord(checked.actor),
      action: op.action,
      tool: op.tool.name,
      tenantId: extra.tenant?.id,
      status: extra.approvalId ? 'approved' : 'done',
      result: storable(result),
      requestId: extra.requestId,
      call: extra.requestId === undefined ? undefined : callKey(op.tool.name, input),
      approvalId: extra.approvalId,
      decidedBy: extra.decidedBy,
    })
    return result
  }

  function toolFunction(op: ToolOp) {
    const args = { caller: agentCallerValidator, input: v.any(), requestId: v.optional(v.string()) }
    if (op.kind === 'query') {
      const paged = isPaged(op)
      return guarded(
        internalQueryGeneric({
          args,
          returns: v.object({ status: v.literal('done'), result: paged ? pageResult : op.returns }),
          handler: async (
            ctx: Ctx,
            { caller, input: raw }: { caller: AgentCaller; input: unknown },
          ) => {
            const actor = await agent(ctx, caller)
            const checkedInput = inputOf(ctx, { args: toolArgs(op) }, raw)
            const input = paged ? fromCursor(checkedInput) : checkedInput
            const { ctx: checked, settle } = await authorize(ctx, op, actor, input)
            const hasCursor =
              paged && (input.paginationOpts as { cursor: string | null }).cursor !== null
            const result = await Promise.resolve(op.handler(checked, input)).catch(
              (error: unknown) => {
                // A cursor the model made up fails inside Convex without a `ConvexError`; say which field is wrong.
                if (hasCursor && (error as { data?: unknown } | null)?.data === undefined)
                  fail(
                    'INVALID_INPUT',
                    'cursor: pass the `next` value from the last result exactly, or leave it out for the first page.',
                  )
                throw error
              },
            )
            return {
              status: 'done' as const,
              result: settle(paged ? toCursor(result as PageOf) : result),
            }
          },
        }),
      )
    }
    return guarded(
      internalMutationGeneric({
        args: {
          ...args,
          approval: v.optional(v.object({ id: v.id('approvals'), decidedBy: v.string() })),
          /** Set by `approve` after STALE: ask a person again, never run the work. */
          renew: v.optional(v.literal(true)),
        },
        // A replayed result may be the marker `storable` left when the result was too large to keep.
        returns: v.union(
          v.object({ status: v.literal('done'), result: v.union(op.returns, truncated) }),
          needsApproval,
        ),
        handler: async (
          ctx: MCtx,
          {
            caller,
            input: raw,
            requestId,
            approval,
            renew,
          }: {
            caller: AgentCaller
            input: unknown
            requestId?: string
            approval?: { id: GenericId<'approvals'>; decidedBy: string }
            renew?: true
          },
        ) => {
          // A renewal is the person's doing, after the agent's turn: like approved work, it needs
          // the live grant, not a running turn (release review 5).
          const actor = await agent(ctx, caller, { approved: approval !== undefined || renew })
          const input = inputOf(ctx, op, raw)
          /**
           * What a person decides on: the plan, and a fingerprint of each row it lists or the
           * input names. Each must be readable to the agent: a row it may not read is missing, as
           * in the handler, so the request never reaches a person.
           */
          const planned = async ({
            ctx: checked,
            settle,
          }: Awaited<ReturnType<Internals['authorize']>>) => {
            const plan = frozen(settle(await planOf(op, checked, input)))
            const ids = new Map<string, string>()
            for (const { table, id } of idsIn(jsonOf(v.object(op.args)), input))
              if (ctx.db.normalizeId(table, id) !== null) ids.set(id, table)
            for (const id of plan.rows ?? []) {
              const table = tenants.tableOf(ctx.db, id)
              if (table === undefined)
                throw new Error(
                  `The plan of ${op.action} lists ${id}, which is no ID of an app table.`,
                )
              ids.set(id, table)
            }
            if (ids.size > maxSeen) {
              fail(
                'TOO_LARGE',
                `One request may cover at most ${maxSeen} rows, so a person can check them. Ask for fewer at once.`,
              )
            }
            const rows: { table: string; id: string; row: Record<string, unknown> }[] = []
            for (const [id, table] of ids) {
              const row = (await checked.db.get(id)) as Record<string, unknown> | null
              if (row === null) fail('NOT_FOUND', `No ${table} with this ID.`)
              rows.push({ table, id, row })
            }
            // Fingerprints of the stored rows, read again: app code may have changed the objects
            // it was handed (release reviews 3 and 4).
            const seen = await Promise.all(
              rows.map(async ({ id }) => ({
                id,
                hash: await fingerprint(await ctx.db.get(id as GenericId<string>)),
              })),
            )
            return { plan, seen, rows }
          }
          const requester = actorRecord(actor)
          if (approval) {
            // Called by `approve` as a sub-transaction, which marked the request as executing: a failure rolls back only this.
            const row = await lib(ctx).get(approval.id)
            if (
              row?.status !== 'executing' ||
              row.requester.key !== requester.key ||
              row.action !== op.action
            ) {
              fail('APPROVAL_NOT_FOUND', 'This approval does not match the request.')
            }
            // The work runs on the plan the person approved, as it was. A row it lists or the
            // input names that changed or went away makes it STALE, before authorizing could call
            // a deleted row NOT_FOUND (release review 2).
            if (row.plan === undefined) fail('STALE', stale)
            for (const { id, hash } of row.seen ?? []) {
              const now = await ctx.db.get(id as GenericId<string>)
              if (now === null || (await fingerprint(now)) !== hash) fail('STALE', stale)
            }
            // Internal operations this work runs see the approval: their own `approve` rules pass,
            // and they too change only the plan's rows.
            const {
              ctx: checked,
              tenant,
              settle,
            } = await authorize(ctx, op, { ...actor, approvalId: approval.id }, input)
            const result = await runForAgent(ctx, checked, settle, op, input, frozen(row.plan), {
              tenant,
              requestId: row.requestId,
              approvalId: approval.id,
              decidedBy: approval.decidedBy,
            })
            return { status: 'done' as const, result }
          }
          if (!renew) await rateLimit(ctx, `writes:${requester.key}`, agentWritesPerMinute)
          const authorized = await authorize(ctx, op, actor, input)
          const { decision, tenant, settle, mayWrite, ctx: checked } = authorized
          // A renewal only asks: work that needs no person now runs when the agent calls again,
          // never from a person's click on another request (release review 5).
          if (renew && decision !== 'approve') fail('STALE', stale)
          const call = callKey(op.tool.name, input)
          if (requestId !== undefined) {
            // A retry key names one call. It replays that call's outcome, through
            // an approval too, and never stands in for a different call.
            const earlier = await lib(ctx)
              .query('activity')
              .withIndex('by_actor_request', (q) =>
                q.eq('actor.key', requester.key).eq('requestId', requestId),
              )
              .first()
            if (earlier) {
              if (earlier.call !== call)
                fail(
                  'REQUEST_ID_REUSED',
                  'This request_id was used for a different call. Send a new one.',
                )
              if (earlier.status === 'declined')
                fail('APPROVAL_DECLINED', 'A person declined this request.')
              if (earlier.status === 'failed') {
                // Stored by `approve` from a coded failure: its code is an ErrorCode.
                const reason = earlier.result as { code: ErrorCode; message: string }
                fail(reason.code, reason.message)
              }
              return { status: 'done' as const, result: earlier.result }
            }
            // A key that names a request still waiting names that call, also for a call that would
            // run at once (sequence fuzz, 2026-10-07). This check guards every request with the
            // key, so they all name one call and the first one tells which.
            const asked = await lib(ctx)
              .query('approvals')
              .withIndex('by_requester_request', (q) =>
                q.eq('requester.key', requester.key).eq('requestId', requestId),
              )
              .first()
            if (asked && callKey(asked.tool, asked.input) !== call)
              fail(
                'REQUEST_ID_REUSED',
                'This request_id was used for a different call. Send a new one.',
              )
          }
          if (decision === 'approve') {
            const open = await lib(ctx)
              .query('approvals')
              .withIndex('by_requester_status', (q) =>
                q
                  .eq('requester.key', requester.key)
                  .eq('status', 'pending')
                  .gt('expiresAt', Date.now()),
              )
              .take(openApprovals + 1)
            // The same call from the same run (or the same MCP connection) waits on one request.
            // Another run asks again: a request resumes only the run that made it.
            const same = open.find(
              (row) =>
                callKey(row.tool, row.input) === call &&
                (caller.door !== 'app' ||
                  (row.caller.door === 'app' && row.caller.runId === caller.runId)),
            )
            if (same)
              return {
                status: 'needs_approval' as const,
                approvalId: same._id,
                summary: inertMarkdown(same.summary),
                url: approvalUrl(same._id),
              }
            // A person said no: the same call from this connection waits until that request would have expired.
            const callHash = await fingerprint(call)
            const declined = await lib(ctx)
              .query('approvals')
              .withIndex('by_requester_call', (q) =>
                q
                  .eq('requester.key', requester.key)
                  .eq('callHash', callHash)
                  .eq('status', 'declined')
                  .gt('expiresAt', Date.now()),
              )
              .first()
            if (declined) fail('APPROVAL_DECLINED', 'A person declined this request.')
            if (open.length >= openApprovals) {
              fail(
                'RATE_LIMITED',
                `${openApprovals} requests already wait for a person. Wait until they are decided.`,
              )
            }
            const { plan, seen, rows } = await planned(authorized)
            const summary = oneLine(plan.summary)
            const expiresAt = Date.now() + approvalTtl
            const approvalId = await lib(ctx).insert('approvals', {
              action: op.action,
              tool: op.tool.name,
              input: input as Value,
              summary,
              requester,
              caller,
              tenantId: tenant?.id,
              requestId,
              callHash,
              plan: plan as unknown as Value,
              seen,
              status: 'pending',
              expiresAt,
            })
            if (approversFor(policy, op.action).sharedRows) {
              for (const tenantId of await partiesOf(ctx, tenant, rows, mayWrite)) {
                await lib(ctx).insert('approvalParties', { approvalId, tenantId, expiresAt })
              }
            }
            return {
              status: 'needs_approval' as const,
              approvalId,
              summary: inertMarkdown(summary),
              url: approvalUrl(approvalId),
            }
          }
          return {
            status: 'done' as const,
            result: await runForAgent(
              ctx,
              checked,
              settle,
              op,
              input,
              frozen(settle(await planOf(op, checked, input))),
              { tenant, requestId },
            ),
          }
        },
      }),
    )
  }

  const checkApprovalArgs = { approvalId: v.string() }
  /** Built-in tool: an agent asks what became of its request. */
  const check_approval = guarded(
    internalQueryGeneric({
      args: { caller: agentCallerValidator, input: v.any(), requestId: v.optional(v.string()) },
      handler: async (
        ctx: Ctx,
        { caller, input: raw }: { caller: AgentCaller; input: unknown },
      ) => {
        const actor = await agent(ctx, caller)
        const input = inputOf(ctx, { args: checkApprovalArgs }, raw) as { approvalId: string }
        const id = lib(ctx).normalizeId('approvals', input.approvalId)
        const row = id && (await lib(ctx).get(id))
        if (!row || row.requester.key !== actorRecord(actor).key) {
          fail('APPROVAL_NOT_FOUND', 'No request with this ID was made by this connection.')
        }
        const status = requestStatus(row)
        return {
          status: 'done' as const,
          result: {
            status,
            summary: inertMarkdown(row.summary),
            result: row.result ?? null,
            error: row.error ?? null,
          },
        }
      },
    }),
  )

  const toolFunctions = Object.fromEntries(
    [...operations].map(([name, op]) => [name, toolFunction(op)]),
  )

  /** The tool list a door publishes. Input schemas come from the same Convex validators. */
  const catalog: CatalogEntry[] = [
    ...[...operations.values()].map((op) => {
      const rule = (policy.agents as Record<string, unknown> | undefined)?.[op.action]
      return {
        name: op.tool.name,
        description: op.tool.description,
        kind: op.kind,
        ref: options.functions[op.tool.name]!,
        inputSchema: describe(toJsonSchema(jsonOf(v.object(toolArgs(op)))), {
          ...pageHelp(op),
          ...op.tool.args,
        }),
        approval:
          typeof rule === 'function'
            ? ('maybe' as const)
            : rule === 'approve'
              ? ('always' as const)
              : ('never' as const),
        scopes: scopesFor(policy, op.action),
      }
    }),
    {
      name: 'check_approval',
      description:
        'Check whether a person approved or declined a request you made, and get its result.',
      kind: 'query' as const,
      ref: options.functions.check_approval!,
      inputSchema: describe(toJsonSchema(jsonOf(v.object(checkApprovalArgs))), {
        approvalId: 'The approvalId a tool returned.',
      }),
      approval: 'never' as const,
      scopes: [],
    },
  ]

  /**
   * The other parties of a request (`sharedRows`): the tenants besides the
   * call's own that every row the input names, and the call may change,
   * belongs to. A row of a table whose rule requires a tenant belongs to that
   * one tenant; a row of another table (`anyOf`, `custom`) to every tenant it
   * names in a field. Rows the call only reads give no say (a buyer's agent
   * reading a seller's listing), and neither does the call's own tenant row.
   * No such rows, or rows with nothing in common, give none.
   */
  async function partiesOf(
    ctx: Ctx,
    tenant: TenantRef | undefined,
    rows: { table: string; id: string; row: Record<string, unknown> }[],
    mayWrite: (table: string, row: Record<string, unknown>) => Promise<boolean>,
  ) {
    let common: Set<string> | undefined
    for (const { table, id, row } of rows) {
      if (id === tenant?.id || !(await mayWrite(table, row))) continue
      const owners = new Set(
        tenants.tenantFieldsOf.has(table)
          ? [tenants.rowTenant(ctx.db, table, row)?.id ?? []].flat()
          : Object.values(row).flatMap((value) => tenants.refOf(ctx.db, value)?.id ?? []),
      )
      common = new Set([...(common ?? owners)].filter((tenantId) => owners.has(tenantId)))
    }
    return [...(common ?? [])].filter((tenantId) => tenantId !== tenant?.id)
  }

  /**
   * May this person decide this request? The person the agent acts for, or an
   * approver role in its tenant, or, with `sharedRows`, in one of its parties
   * (`partiesOf`).
   */
  async function mayDecide(
    ctx: Ctx,
    actor: { user: { _id: string } },
    row: LibraryDataModel['approvals']['document'],
  ) {
    if (row.requester.userId === actor.user._id) return true
    const approvers = approversFor(policy, row.action)
    if (approvers.roles.length === 0) return false
    const approverIn = async (tenantId: string) => {
      const tenant = tenants.refOf(ctx.db, tenantId)
      const role = tenant ? await roleOf(readOnly(ctx), actor.user, tenant) : null
      return role !== null && approvers.roles.includes(role)
    }
    if (row.tenantId !== undefined && (await approverIn(row.tenantId))) return true
    if (!approvers.sharedRows) return false
    const parties = await lib(ctx)
      .query('approvalParties')
      .withIndex('by_approval', (q) => q.eq('approvalId', row._id))
      .collect()
    for (const party of parties) if (await approverIn(party.tenantId)) return true
    return false
  }

  async function decidable(ctx: MCtx, approvalId: string) {
    const actor = await person(ctx)
    const id = lib(ctx).normalizeId('approvals', approvalId)
    const row = id && (await lib(ctx).get(id))
    if (!row || row.status !== 'pending' || !(await mayDecide(ctx, actor, row))) {
      fail('APPROVAL_NOT_FOUND', 'No open request with this ID is yours to decide.')
    }
    if (row.expiresAt <= Date.now())
      fail('APPROVAL_EXPIRED', 'This request expired. Ask the agent again.')
    return { actor, row }
  }

  async function record(
    ctx: MCtx,
    row: LibraryDataModel['approvals']['document'],
    status: 'declined' | 'failed',
    decidedBy: string,
    result?: Value,
  ) {
    await lib(ctx).insert('activity', {
      actor: row.requester,
      action: row.action,
      tool: row.tool,
      tenantId: row.tenantId,
      ...(row.requestId === undefined
        ? {}
        : { requestId: row.requestId, call: callKey(row.tool, row.input) }),
      status,
      approvalId: row._id,
      decidedBy,
      result,
    })
  }

  /** The request's call, asked again as its agent. `undefined` when it now fails or runs at once. */
  async function askAgain(ctx: MCtx, row: LibraryDataModel['approvals']['document']) {
    try {
      const again = await ctx.runMutation(ownRef(row.tool), {
        caller: row.caller,
        input: row.input,
        renew: true,
        ...(row.requestId === undefined ? {} : { requestId: row.requestId }),
      })
      if (again.status !== 'needs_approval') return undefined
      // An in-app run that waits on the old request waits on the new one instead.
      if (row.caller.door === 'app') {
        const runId = lib(ctx).normalizeId('agentRuns', row.caller.runId)
        const run = runId && (await lib(ctx).get(runId))
        if (run?.status === 'waiting' && run.approvalIds?.includes(row._id)) {
          await lib(ctx).patch(run._id, {
            approvalIds: run.approvalIds.map((id) => (id === row._id ? again.approvalId : id)),
          })
          // Wakes it when the new request expires, as `wait` did for the old one (release review 6).
          const renewedId = lib(ctx).normalizeId('approvals', again.approvalId)
          const renewed = renewedId && (await lib(ctx).get(renewedId))
          await ctx.scheduler.runAt(
            (renewed ? renewed.expiresAt : Date.now()) + 1000,
            makeFunctionReference<'action'>(run.step),
            { runId: run._id, turn: run.turn },
          )
        }
      }
      return again.approvalId
    } catch {
      return undefined
    }
  }

  const resume = (ctx: MCtx, caller: AgentCaller) =>
    caller.door === 'app' ? wake(lib(ctx), ctx.scheduler, caller.runId) : undefined

  const requestView = (row: LibraryDataModel['approvals']['document'], mine: boolean) => ({
    id: row._id,
    summary: row.summary,
    tool: row.tool,
    requester: row.requester,
    expiresAt: row.expiresAt,
    mine,
  })

  const approvals = {
    /**
     * Open requests from agents that act for the signed-in person, and, with
     * `tenantId`, the requests of that tenant, or of a row it shares, that
     * this person may approve as a teammate. A request belongs to the deepest
     * tenant its call named (a site, not the agency above it), so a list for a
     * parent asks per child tenant.
     */
    pending: guarded(
      queryGeneric({
        args: { tenantId: v.optional(v.string()) },
        handler: async (ctx: Ctx, { tenantId }: { tenantId?: string }) => {
          const actor = await person(ctx)
          const now = Date.now()
          const mine = await lib(ctx)
            .query('approvals')
            .withIndex('by_user_status', (q) =>
              q.eq('requester.userId', actor.user._id).eq('status', 'pending').gt('expiresAt', now),
            )
            .take(100)
          const out = mine.map((row) => requestView(row, true))
          if (tenantId !== undefined) {
            const team = await lib(ctx)
              .query('approvals')
              .withIndex('by_tenant_status', (q) =>
                q.eq('tenantId', tenantId).eq('status', 'pending').gt('expiresAt', now),
              )
              .take(100)
            const parties = await lib(ctx)
              .query('approvalParties')
              .withIndex('by_tenant', (q) => q.eq('tenantId', tenantId).gt('expiresAt', now))
              .take(100)
            for (const party of parties) {
              const row = await lib(ctx).get(party.approvalId)
              if (row?.status === 'pending') team.push(row)
            }
            for (const row of team) {
              if (row.requester.userId !== actor.user._id && (await mayDecide(ctx, actor, row)))
                out.push(requestView(row, false))
            }
          }
          return out
        },
      }),
    ),
    /** One request, for the approval page: what it is and whether this person may decide it. */
    get: guarded(
      queryGeneric({
        args: { approvalId: v.string() },
        handler: async (ctx: Ctx, { approvalId }: { approvalId: string }) => {
          const actor = await person(ctx)
          const id = lib(ctx).normalizeId('approvals', approvalId)
          const row = id && (await lib(ctx).get(id))
          if (!row || !(await mayDecide(ctx, actor, row))) return null
          const status = requestStatus(row)
          return {
            ...requestView(row, row.requester.userId === actor.user._id),
            status,
            error: row.error ?? null,
          }
        },
      }),
    ),
    /** Runs the request as the agent, with the person's approval, in this transaction. */
    approve: guarded(
      mutationGeneric({
        args: { approvalId: v.string() },
        handler: async (ctx: MCtx, { approvalId }: { approvalId: string }) => {
          const { actor: approver, row } = await decidable(ctx, approvalId)
          let outcome:
            | { status: 'approved' }
            | {
                status: 'failed'
                error: { code: string; message: string }
                /** After STALE: the same call asked again on the current data, waiting for a person. */
                next?: GenericId<'approvals'>
              }
          {
            // The operation runs as the agent in a sub-transaction. It checks the grant again, so
            // revoking the connection also cancels its requests, and the rows the person saw (STALE).
            // Marks the request as running, so its own work (and only that) runs under this approval.
            await lib(ctx).patch(row._id, { status: 'executing', followUp: crypto.randomUUID() })
            try {
              const output = await ctx.runMutation(ownRef(row.tool), {
                caller: row.caller,
                input: row.input,
                approval: { id: row._id, decidedBy: approver.user._id },
              })
              await lib(ctx).patch(row._id, {
                status: 'approved',
                result: storable(output.result),
                decidedBy: approver.user._id,
                decidedAt: Date.now(),
              })
              outcome = { status: 'approved' }
            } catch (error) {
              const reason = toolFailure(error)
              await lib(ctx).patch(row._id, {
                status: 'failed',
                error: reason,
                decidedBy: approver.user._id,
              })
              // Changed since the agent asked: the same call asks again on the current data, so the
              // person can decide on what is true now, also when the agent is gone. Without a
              // retry key in the activity row: the agent's retry finds the new request.
              const next = reason.code === 'STALE' ? await askAgain(ctx, row) : undefined
              await record(
                ctx,
                next ? { ...row, requestId: undefined } : row,
                'failed',
                approver.user._id,
                reason,
              )
              outcome = { status: 'failed', error: reason, ...(next ? { next } : {}) }
            }
          }
          await resume(ctx, row.caller)
          return outcome
        },
      }),
    ),
    decline: guarded(
      mutationGeneric({
        args: { approvalId: v.string() },
        handler: async (ctx: MCtx, { approvalId }: { approvalId: string }) => {
          const { actor, row } = await decidable(ctx, approvalId)
          await lib(ctx).patch(row._id, { status: 'declined', decidedBy: actor.user._id })
          await record(ctx, row, 'declined', actor.user._id)
          await resume(ctx, row.caller)
          return null
        },
      }),
    ),
  }

  /**
   * What agents did: in a tenant (any member may read it), or for the
   * signed-in person's own agents. Newest first.
   */
  const activity = guarded(
    queryGeneric({
      args: { tenantId: v.optional(v.string()), limit: v.optional(v.number()) },
      handler: async (ctx: Ctx, { tenantId, limit }: { tenantId?: string; limit?: number }) => {
        const actor = await person(ctx)
        const take = Math.min(Math.max(1, limit ?? 50), 200)
        let rows
        if (tenantId !== undefined) {
          const tenant = tenants.refOf(ctx.db, tenantId)
          if (!tenant || (await roleOf(readOnly(ctx), actor.user, tenant)) === null)
            fail('NOT_FOUND', 'Nothing with these IDs was found.')
          rows = await lib(ctx)
            .query('activity')
            .withIndex('by_tenant', (q) => q.eq('tenantId', tenantId))
            .order('desc')
            .take(take)
        } else {
          rows = await lib(ctx)
            .query('activity')
            .withIndex('by_user', (q) => q.eq('actor.userId', actor.user._id))
            .order('desc')
            .take(take)
        }
        return rows.map((row) => ({
          id: row._id,
          at: row._creationTime,
          actor: row.actor,
          action: row.action,
          tool: row.tool ?? null,
          status: row.status,
          decidedBy: row.decidedBy ?? null,
        }))
      },
    }),
  )

  /**
   * Expires old requests (and wakes the runs that waited on them), ends
   * stalled runs, and deletes what is past retention. Run it from a cron:
   * `crons.hourly('library housekeeping', { minuteUTC: 7 }, internal.agents.housekeeping)`.
   * Continues in a new transaction while there is more to do. Deleting comes
   * last, in transactions of its own that each read a bounded amount, so no
   * amount of old data keeps a stalled run from ending.
   */
  const housekeeping = guarded(
    internalMutationGeneric({
      // `waiting`: where the scan of waiting runs continues, so blocked runs are not scanned again in one sweep.
      // `cutoff` stays fixed for one sweep: a Convex cursor is only valid for the same query.
      // `cleanup`: runs and requests are seen to; this transaction deletes what is past retention.
      args: {
        waiting: v.optional(v.union(v.string(), v.null())),
        cutoff: v.optional(v.number()),
        cleanup: v.optional(v.boolean()),
      },
      handler: async (
        ctx: MCtx,
        args: { waiting?: string | null; cutoff?: number; cleanup?: boolean },
      ) => {
        const db = lib(ctx)
        const now = Date.now()
        const next = (more: { waiting?: string; cutoff?: number; cleanup?: true }) =>
          ctx.scheduler.runAfter(0, ownRef('housekeeping'), more)
        if (args.cleanup) {
          if (!(await deleteRetained(db, now))) await next({ cleanup: true })
          return null
        }
        const batch = 200
        const stalled = await db
          .query('agentRuns')
          .withIndex('by_status', (q) => q.eq('status', 'running').lt('stepAt', now - stallAfter))
          .take(sweep.rows)
        for (const run of stalled)
          await finish(db, run, { status: 'failed', error: shownStatus(run).error! })
        // A request holds its plan, up to a document's size: read them within a budget.
        const expired = await within(
          db
            .query('approvals')
            .withIndex('by_status', (q) => q.eq('status', 'pending').lt('expiresAt', now)),
          readBudget(),
        )
        for (const row of expired.rows) {
          await db.patch(row._id, { status: 'expired' })
          if (row.caller.door === 'app') await wake(db, ctx.scheduler, row.caller.runId)
        }
        // Backstop: a waiting run whose requests are all decided goes on, even if its wake-up was lost.
        const cutoff = args.waiting ? (args.cutoff ?? now - 60_000) : now - 60_000
        const waiting = await db
          .query('agentRuns')
          .withIndex('by_status', (q) => q.eq('status', 'waiting').lt('stepAt', cutoff))
          .paginate({ numItems: batch, cursor: args.waiting ?? null })
        for (const run of waiting.page) await wake(db, ctx.scheduler, run._id)
        if (!waiting.isDone) await next({ waiting: waiting.continueCursor, cutoff })
        else if (stalled.length === sweep.rows || expired.more) await next({})
        else await next({ cleanup: true })
        return null
      },
    }),
  )

  const functions = { ...toolFunctions, check_approval, housekeeping } as Record<
    string,
    ReturnType<typeof toolFunction>
  > & {
    check_approval: typeof check_approval
    housekeeping: typeof housekeeping
  }

  /**
   * Cancels the open requests of an MCP connection the person disconnected:
   * nobody is left to act on the decision. Call it next to the revoke, with
   * the app user's ID (not the Better Auth user ID: a plain string does not
   * type-check).
   */
  async function disconnected(ctx: MCtx, userId: GenericId<string>, clientId: string) {
    await cancelRequests(lib(ctx), `mcp:${userId}:${clientId}`)
  }

  return { functions, catalog, approvals, activity, disconnected }
}

/**
 * A query with `paginationOpts` (Convex's own pagination, for
 * `usePaginatedQuery` on the web) reaches models as `cursor` and `limit` in,
 * and `{ items, next }` out: no Convex cursor objects for a model to fill in.
 */
const isPaged = (op: Pick<Operation, 'args'>) => 'paginationOpts' in op.args
const pageResult = v.object({ items: v.array(v.any()), next: v.union(v.string(), v.null()) })
type PageOf = { page: unknown[]; isDone: boolean; continueCursor: string }

function toolArgs(op: Pick<Operation, 'args'>) {
  if (!isPaged(op)) return op.args
  const { paginationOpts: _, ...rest } = op.args
  return { ...rest, cursor: v.optional(v.string()), limit: v.optional(v.number()) }
}

function pageHelp(op: Pick<Operation, 'args'>): Record<string, string> {
  return isPaged(op)
    ? {
        cursor: 'Leave it out for the first page. For more, pass `next` from the last result.',
        limit: 'Items per page, 1 to 100. Default 50.',
      }
    : {}
}

function fromCursor({ cursor, limit, ...rest }: Record<string, unknown>) {
  const numItems = Math.min(100, Math.max(1, Math.floor(typeof limit === 'number' ? limit : 50)))
  // Models write "no cursor yet" in many ways ("", "null", "None"…).
  const first =
    typeof cursor !== 'string' ||
    ['', 'null', 'none', 'undefined', 'nil'].includes(cursor.trim().toLowerCase())
  return { ...rest, paginationOpts: { numItems, cursor: first ? null : cursor } }
}

function toCursor(result: PageOf) {
  return { items: result.page, next: result.isDone ? null : result.continueCursor }
}

/**
 * What one housekeeping transaction reads at most, about: far inside Convex's
 * limits (16 MiB and 32,000 documents), even when every row is near the
 * 1 MiB document limit.
 */
const sweep = { rows: 100, bytes: 4 * 1024 * 1024 }

function readBudget() {
  let rows = sweep.rows
  let bytes = sweep.bytes
  return {
    count(row: Record<string, unknown>) {
      rows -= 1
      bytes -= getConvexSize(row as Value)
    },
    get spent() {
      return rows <= 0 || bytes <= 0
    },
  }
}
type Budget = ReturnType<typeof readBudget>
type LibId = GenericId<keyof LibraryDataModel & string>

/** Reads `query` until it ends or the budget is spent. `more`: rows may remain. */
async function within<T extends Record<string, unknown>>(query: AsyncIterable<T>, budget: Budget) {
  const rows: T[] = []
  if (budget.spent) return { rows, more: true }
  for await (const row of query) {
    rows.push(row)
    budget.count(row)
    if (budget.spent) return { rows, more: true }
  }
  return { rows, more: false }
}

/**
 * Deletes one bounded batch of what is past retention. A request's parties
 * and created rows, and a run's messages, go before the row itself, so a row
 * whose children did not fit stays for the next batch. True when nothing is
 * left.
 */
async function deleteRetained(db: Lib, now: number) {
  const budget = readBudget()
  /** Deletes what `query` holds; false when the budget ran out first. */
  const deleteAll = async (query: AsyncIterable<{ _id: LibId }>) => {
    const { rows, more } = await within(query, budget)
    for (const row of rows) await db.delete(row._id)
    return !more
  }
  /** Deletes the rows `oldest` finds, one by one, each after its children. */
  const deleteParents = async <T extends { _id: LibId }>(
    oldest: () => Promise<T | null>,
    children: (row: T) => Promise<boolean>,
  ) => {
    while (!budget.spent) {
      const row = await oldest()
      if (!row) return true
      budget.count(row)
      if (!(await children(row))) return false
      await db.delete(row._id)
    }
    return false
  }
  const activity = db
    .query('activity')
    .withIndex('by_creation_time', (q) => q.lt('_creationTime', now - retention.activity * day))
  if (!(await deleteAll(activity))) return false
  for (const status of ['approved', 'declined', 'failed', 'expired', 'cancelled'] as const) {
    const done = await deleteParents(
      () =>
        db
          .query('approvals')
          .withIndex('by_status', (q) =>
            q.eq('status', status).lt('expiresAt', now - retention.approvals * day),
          )
          .first(),
      async (row) =>
        (await deleteAll(
          db.query('approvalParties').withIndex('by_approval', (q) => q.eq('approvalId', row._id)),
        )) &&
        (await deleteAll(
          db.query('approvalRows').withIndex('by_approval_row', (q) => q.eq('approvalId', row._id)),
        )),
    )
    if (!done) return false
  }
  for (const status of ['done', 'failed'] as const) {
    const done = await deleteParents(
      () =>
        db
          .query('agentRuns')
          .withIndex('by_status', (q) =>
            q.eq('status', status).lt('stepAt', now - retention.runs * day),
          )
          .first(),
      (run) =>
        deleteAll(db.query('agentMessages').withIndex('by_run', (q) => q.eq('runId', run._id))),
    )
    if (!done) return false
  }
  // A counter is created in its own minute, so creation order is window order. An hour is kept.
  const windows = db
    .query('rateLimits')
    .withIndex('by_creation_time', (q) =>
      q.lt('_creationTime', (Math.floor(now / 60_000) - 60) * 60_000),
    )
  return await deleteAll(windows)
}

/**
 * A request's status as a reader sees it: past its time, a pending request is
 * expired. `executing` exists only inside `approve`'s transaction, so no
 * reader ever sees it.
 */
function requestStatus(row: LibraryDataModel['approvals']['document']) {
  if (row.status === 'pending' && row.expiresAt <= Date.now()) return 'expired'
  return row.status as Exclude<typeof row.status, 'executing'>
}

/** Adds the per-argument text the model reads. */
function describe(
  schema: Record<string, unknown>,
  descriptions: Record<string, string | undefined>,
) {
  for (const [field, description] of Object.entries(descriptions)) {
    const property = (schema.properties as Record<string, Record<string, unknown>> | undefined)?.[
      field
    ]
    if (property && description) property.description = description
  }
  return schema
}
