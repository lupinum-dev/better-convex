import { defineTable, type SchemaDefinition, type TableDefinition } from 'convex/server'
import { v, type VObject } from 'convex/values'

import { actorRecordValidator, agentCallerValidator } from './actor'

const failure = v.object({ code: v.string(), message: v.string() })

/** The library's tables. Spread them into the app schema. */
export const libraryTables = {
  /** What agents and jobs did. One row per agent write, approval decision and job run. */
  activity: defineTable({
    actor: actorRecordValidator,
    action: v.string(),
    tool: v.optional(v.string()),
    /** The tenant the call acted in, for a team's activity feed. */
    tenantId: v.optional(v.string()),
    /** The caller's retry key. A repeated key returns the stored result instead of running again. */
    requestId: v.optional(v.string()),
    /** Which call the retry key belongs to (tool and input). Set together with `requestId`. */
    call: v.optional(v.string()),
    status: v.union(
      v.literal('done'),
      v.literal('approved'),
      v.literal('declined'),
      v.literal('failed'),
    ),
    /** The result, or `{ truncated: true }` when it was too large to keep. */
    result: v.optional(v.any()),
    approvalId: v.optional(v.id('approvals')),
    decidedBy: v.optional(v.string()),
  })
    .index('by_actor_request', ['actor.key', 'requestId'])
    .index('by_user', ['actor.userId'])
    .index('by_tenant', ['tenantId']),

  /** An agent asked for an action its rules hold for a person. */
  approvals: defineTable({
    action: v.string(),
    tool: v.string(),
    input: v.any(),
    /** One line a person reads before deciding. */
    summary: v.string(),
    requester: actorRecordValidator,
    caller: agentCallerValidator,
    /** The call's tenant, so teammates with an approver role can decide. */
    tenantId: v.optional(v.string()),
    /** The agent's retry key, so a retry after the decision replays the outcome. */
    requestId: v.optional(v.string()),
    /** Fingerprints of the rows the summary read; approving fails when one changed. */
    seen: v.optional(v.array(v.object({ id: v.string(), hash: v.string() }))),
    status: v.union(
      v.literal('pending'),
      /** Only inside the `approve` transaction, while the request runs; never stored. */
      v.literal('executing'),
      v.literal('approved'),
      v.literal('declined'),
      v.literal('failed'),
      v.literal('expired'),
      v.literal('cancelled'),
    ),
    expiresAt: v.number(),
    decidedBy: v.optional(v.string()),
    result: v.optional(v.any()),
    error: v.optional(failure),
  })
    .index('by_user_status', ['requester.userId', 'status', 'expiresAt'])
    .index('by_requester_status', ['requester.key', 'status', 'expiresAt'])
    .index('by_requester_request', ['requester.key', 'requestId'])
    .index('by_tenant_status', ['tenantId', 'status', 'expiresAt'])
    .index('by_status', ['status', 'expiresAt']),

  /**
   * A tenant besides the call's own that every row a request touches names,
   * such as the seller of an order a buyer's agent cancels. Its approvers may
   * decide the request too. Written with the request, deleted with it.
   */
  approvalParties: defineTable({
    approvalId: v.id('approvals'),
    tenantId: v.string(),
    expiresAt: v.number(),
  })
    .index('by_tenant', ['tenantId', 'expiresAt'])
    .index('by_approval', ['approvalId']),

  /** A person turned on one of the app's own agents. It acts for them until it expires or they turn it off. */
  agentGrants: defineTable({
    authId: v.string(),
    userId: v.string(),
    agent: v.string(),
    scopes: v.array(v.string()),
    expiresAt: v.number(),
    revokedAt: v.optional(v.number()),
  }).index('by_user_agent', ['userId', 'agent']),

  /** One run of an in-app agent and where it stands. Its conversation is in `agentMessages`. */
  agentRuns: defineTable({
    grantId: v.id('agentGrants'),
    userId: v.string(),
    agent: v.string(),
    /** The agent's step function (`'assistant:step'`). Convex loads only the called module, so no registry can hold this. */
    step: v.string(),
    task: v.string(),
    status: v.union(
      v.literal('running'),
      v.literal('waiting'),
      v.literal('done'),
      v.literal('failed'),
    ),
    /** Each scheduled step carries the turn it was scheduled for; only the current turn may run and save. */
    turn: v.number(),
    /** The turn a step has started; a second step for the same turn stops. */
    claimed: v.optional(v.number()),
    /** Model calls so far, across resumes. */
    steps: v.number(),
    /** When the current turn was scheduled or started. A `running` run far past it has stalled. */
    stepAt: v.number(),
    /** The requests the run waits on. It continues once every one is decided or expired. */
    approvalIds: v.optional(v.array(v.id('approvals'))),
    answer: v.optional(v.string()),
    error: v.optional(failure),
  })
    .index('by_user_agent', ['userId', 'agent'])
    .index('by_user_agent_status', ['userId', 'agent', 'status'])
    .index('by_status', ['status', 'stepAt']),

  /** One message of a run's conversation, as JSON text (model output may hold keys Convex fields cannot). */
  agentMessages: defineTable({
    runId: v.id('agentRuns'),
    order: v.number(),
    json: v.string(),
  }).index('by_run', ['runId', 'order']),

  /** Fixed-window counters for the agent write limit. */
  rateLimits: defineTable({
    key: v.string(),
    window: v.number(),
    count: v.number(),
  }).index('by_key', ['key', 'window']),
}

/**
 * The validator of a whole document of `table`, system fields included, for
 * an operation that returns rows as they are: `returns: docValidator(schema, 'projects')`.
 */
export function docValidator<
  S extends SchemaDefinition<any, boolean>,
  T extends keyof S['tables'] & string,
>(schema: S, table: T) {
  const definition = schema.tables[table] as TableDefinition
  const fields = (definition.validator as VObject<any, any>).fields
  return v.object({ ...fields, _id: v.id(table), _creationTime: v.number() }) as VObject<
    S['tables'][T] extends TableDefinition<infer D>
      ? D['type'] & { _id: import('convex/values').GenericId<T>; _creationTime: number }
      : never,
    any
  >
}
