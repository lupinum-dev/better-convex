import {
  getFunctionAddress,
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  makeFunctionReference,
  mutationGeneric,
  queryGeneric,
  type DataModelFromSchemaDefinition,
  type DocumentByName,
  type FunctionReference,
  type FunctionReturnType,
  type GenericActionCtx,
  type GenericDataModel,
  type GenericMutationCtx,
  type GenericQueryCtx,
  type PaginationOptions,
  type RegisteredMutation,
  type RegisteredQuery,
  type SchemaDefinition,
  type TableNamesInDataModel,
} from 'convex/server'
import {
  v,
  type GenericId,
  type Infer,
  type ObjectType,
  type PropertyValidators,
  type Validator,
  type Value,
} from 'convex/values'

import {
  actingAsValidator,
  actorRecord,
  fail,
  type ActingAs,
  type Actor,
  type AgentCaller,
  type SystemActor,
  type Visitor,
} from './actor'
import { guarded, OPERATION } from './guard'
import { rateLimited, takeToken } from './limits'
import {
  decide,
  isAudited,
  limitOf,
  roleAllows,
  type ActionOf,
  type Decision,
  type Policy,
  type PublicActionOf,
  type RoleOf,
} from './policy'
import { checkedDb, planReader, readOnly, tenancy, type Rule, type TenantRef } from './rules'
import type { libraryTables } from './schema'
import { frozen, idsIn, isIdOf, jsonOf, matches, storable, type ValidatorJson } from './values'

export type LibraryDataModel = DataModelFromSchemaDefinition<
  SchemaDefinition<typeof libraryTables, true>
>

/** The parts of the auth component the library uses. */
export interface Auth<DM extends GenericDataModel> {
  getUser(ctx: GenericQueryCtx<DM>): Promise<{ id: string } | null>
  /**
   * `allowExpiredToken`: work a person approved runs after the access token
   * that asked for it may have expired; the grant must still be live.
   */
  requireMcpPrincipal(
    ctx: GenericQueryCtx<DM>,
    principal: Extract<AgentCaller, { door: 'mcp' }>['principal'],
    options?: { allowExpiredToken?: boolean },
  ): Promise<{ user: { id: string } }>
}

type AnyValidator = Validator<any, 'required', any>

/** How an operation appears to agents. */
export interface ToolSpec<Name extends string, Args extends PropertyValidators> {
  name: Name
  description: string
  /** Text the model reads for each argument. Convex validators carry no descriptions. */
  args?: { [K in keyof Args]?: string }
}

/** Everything the library knows about one operation. Attached to the registered function. */
export interface Operation {
  kind: 'query' | 'mutation'
  action: string
  args: PropertyValidators
  returns: AnyValidator
  tool?: ToolSpec<string, PropertyValidators>
  plan?: (ctx: any, args: any) => Plan | Promise<Plan>
  /** The call may name IDs from several tenants; the role must allow the action in each. */
  crossTenant?: boolean
  /** Mutations get the plan; queries do not. */
  handler: (ctx: any, args: any, plan?: Plan) => unknown
}

/**
 * What a person approves when an agent asks: the sentence they read and the existing rows the
 * work may change. Add any other value the work needs to do exactly what the person saw (a
 * price, a new name): the handler gets the plan as it was when the agent asked.
 */
export interface Plan {
  summary: string
  /** The existing rows the work may change. Without it: the rows the input names. */
  rows?: string[]
  /** Stored files the work may delete. Without it: none. */
  files?: string[]
}

/**
 * The plan of a call: from the operation's `plan`, or, without one, the action and input as JSON
 * and the rows the input names. It reads with `planReader` and gets a frozen copy of the input,
 * so it can change neither (release review 4: a summary changed the input after it was written).
 */
export async function planOf(
  op: Pick<Operation, 'action' | 'args' | 'plan'>,
  ctx: { db: { normalizeId: (table: string, id: string) => unknown } },
  input: Record<string, unknown>,
): Promise<Plan> {
  // Plan rows are app rows: a system ID (`_storage`) is no row, and the checked `db` has no `system`.
  const named = () =>
    idsIn(jsonOf(v.object(op.args)), input)
      .filter(({ table, id }) => !table.startsWith('_') && ctx.db.normalizeId(table, id) !== null)
      .map(({ id }) => id)
  if (!op.plan) return { summary: `${op.action} ${JSON.stringify(input)}`, rows: named() }
  const plan = (await op.plan(planReader(ctx), frozen(input))) as unknown
  if (
    !plan ||
    typeof plan !== 'object' ||
    typeof (plan as Plan).summary !== 'string' ||
    !['rows', 'files'].every((key) => {
      const ids = (plan as Record<string, unknown>)[key]
      return ids === undefined || (Array.isArray(ids) && ids.every((id) => typeof id === 'string'))
    })
  ) {
    throw new Error(
      `The plan of ${op.action} must return { summary: string, rows?: ID[], files?: ID[] }.`,
    )
  }
  // Without `rows`, the work changes the rows the input names, as the person sees in it.
  return (plan as Plan).rows === undefined ? { ...(plan as Plan), rows: named() } : (plan as Plan)
}

/**
 * A job's result as types see it (at runtime it is `null`): a mark that lets operation contexts
 * refuse job references. Nothing reads it.
 */
export type JobDone = { readonly 'better-convex/job': true }

/**
 * The actor as a handler sees it: without the approval it runs under. The approval ID and the
 * follow-up token are credentials that only the library's call wrappers pass on; an app that
 * stores or sends `ctx.actor` must not carry them (Codex round 4).
 */
function shown<T extends object>(actor: T): T {
  if (!('approvalId' in actor) && !('followUp' in actor)) return actor
  const {
    approvalId: _approval,
    followUp: _followUp,
    ...rest
  } = actor as T & {
    approvalId?: unknown
    followUp?: unknown
  }
  return rest as T
}

/** File storage whose `delete` reaches only these files: work under an approval deletes the plan's files. */
function deleting<S extends object>(storage: S, files: Set<string>): S {
  // A new object, not a view of the writer: nothing on it reaches the raw `delete` (release review 6).
  const raw = storage as Record<string, unknown>
  const kept = Object.fromEntries(
    ['getUrl', 'getMetadata', 'generateUploadUrl', 'get', 'store']
      .filter((name) => typeof raw[name] === 'function')
      .map((name) => [name, (raw[name] as (...a: unknown[]) => unknown).bind(storage)]),
  )
  return {
    ...kept,
    delete: async (id: string) => {
      if (!files.has(id))
        fail('FORBIDDEN', 'This work deletes a file that is not in the plan the person approved.')
      return (raw.delete as (id: string) => Promise<void>).call(storage, id)
    },
  } as unknown as S
}

/** How long work scheduled by an approved request still runs under that approval. */
const followUpWindow = 60 * 60_000

/** IDs in one call's input (D1): more would run into Convex's read limit half-way through. */
const idsPerCall = 1000

/**
 * What `defineTools` and the agent runtime need from one `defineFunctions`
 * call besides its policy, keyed by its result. Not a property of the result:
 * the declaration file of an app that exports `fns` would have to name its
 * type (V5), and app code has no use for it.
 */
const kits = new WeakMap<object, unknown>()

/** The internals of a `defineFunctions` result, for `defineTools` and the agent runtime. */
export function internalsOf(fns: object): unknown {
  if (!kits.has(fns))
    throw new Error('Pass the object defineFunctions returned, not a copy or a part of it.')
  return kits.get(fns)
}

/** Each app table with its typed ID: what `roleOf` receives. */
export type TenantOf<DM extends GenericDataModel> = {
  [T in Exclude<TableNamesInDataModel<DM>, keyof typeof libraryTables>]: {
    table: T
    id: GenericId<T>
  }
}[Exclude<TableNamesInDataModel<DM>, keyof typeof libraryTables>]

/**
 * The operation rides on the registered function at runtime only. Its type
 * must stay exactly Convex's `RegisteredQuery`/`RegisteredMutation`: Convex
 * infers `api.*` argument and return types from that alias, and any
 * intersection turns them into `unknown`.
 */

type AppTables<DM extends GenericDataModel> = Exclude<
  TableNamesInDataModel<DM>,
  keyof typeof libraryTables
>

/**
 * The operations of one app: `query`, `mutation`, internal operations and
 * `job`, all checked against one policy and one rule per table. The app's
 * users live in a table called `users`; `ctx.actor.user` is its row type, so a
 * mistake elsewhere in this call cannot turn it into a plain object (E1).
 */
export function defineFunctions<
  DM extends GenericDataModel,
  P extends Policy,
  User extends { _id: string } = DocumentByName<DM, Extract<'users', AppTables<DM>>> & {
    _id: GenericId<Extract<'users', AppTables<DM>>>
  },
>(config: {
  auth: Auth<DM>
  policy: P
  /** The app user for a Better Auth user ID, or `null` when they may not act (suspended, no profile yet). */
  user: (ctx: GenericQueryCtx<DM>, authId: string) => Promise<NoInfer<User> | null>
  /** The person's role in a tenant, or `null` without a membership. A child tenant may inherit its parent's roles here. */
  roleOf: (ctx: GenericQueryCtx<DM>, user: User, tenant: TenantOf<DM>) => Promise<RoleOf<P> | null>
  /** One rule per app table: who may read and write its rows. See `rules.ts`. */
  rules: NoInfer<{
    [T in AppTables<DM>]: Rule<DocumentByName<DM, T>, User, DM, ActionOf<P>>
  }>
  /**
   * Where the app exports `takeActionToken` from this kit (`'limits:takeActionToken'`).
   * An `internalAction` with a limited `action` takes its token through it, because an
   * action has no database of its own. Convex loads one module per function, so the path
   * has to be spelled out.
   */
  limiter?: string
}) {
  type QCtx = GenericQueryCtx<DM>
  type MCtx = GenericMutationCtx<DM>
  type ACtx = GenericActionCtx<DM>
  type Person = Extract<Actor<User>, { kind: 'person' }>
  type Agent = Extract<Actor<User>, { kind: 'agent' }>
  /** Signed-out callers reach only actions in `policy.public`. */
  type ActorFor<A> = A extends PublicActionOf<P> ? Actor<User> | Visitor : Actor<User>
  const { auth, policy } = config
  const rules = config.rules as Record<string, Rule>
  const tenants = tenancy(rules)
  for (const [table, createdBy] of tenants.createdBy) {
    if (!(policy.actions as readonly string[]).includes(createdBy))
      throw new Error(
        `The tenant rule of ${table} names createdBy ${JSON.stringify(createdBy)}, which is not in the policy's actions.`,
      )
  }
  // The library's own tables are not in the app's generic data model.
  const lib = (ctx: { db: unknown }) => ctx.db as GenericMutationCtx<LibraryDataModel>['db']
  /** Takes the call's token, or fails with RATE_LIMITED. `tenant` is undefined where the caller cannot know it (actions). */
  async function spend(
    ctx: { db: unknown },
    actor: Actor<User> | Visitor,
    action: string,
    tenant: TenantRef | undefined,
    limit: NonNullable<ReturnType<typeof limitOf>>,
  ) {
    // A visitor has no user and no membership: everyone shares one bucket.
    let scope = 'everyone'
    if (actor.kind !== 'visitor' && limit.per !== 'everyone') {
      scope =
        limit.per === 'tenant' && tenant ? `tenant:${tenant.id}` : `user:${actorRecord(actor).key}`
    }
    const wait = await takeToken(lib(ctx), `limit:${action}:${scope}`, limit)
    if (wait !== null) rateLimited(wait)
  }

  /** The action of a read-only operation may not carry a limit: queries cannot write a bucket. */
  function assertUnlimited(spec: { action: string }, what: string) {
    if (limitOf(policy, spec.action))
      throw new Error(
        `${spec.action} has a limit in the policy, but ${what} cannot write: limits apply to mutations and actions. Use an action name without a limit.`,
      )
  }

  const isPublic = (action: string) =>
    (policy.public as readonly string[] | undefined)?.includes(action) ?? false

  async function signedIn(ctx: QCtx): Promise<Person | null> {
    const authUser = await auth.getUser(ctx)
    if (!authUser) return null
    const user = await config.user(readOnly(ctx), authUser.id)
    if (!user) fail('ACCOUNT_DISABLED', 'This account cannot use the app right now.')
    return { kind: 'person', door: 'web', user, authId: authUser.id }
  }

  async function person(ctx: QCtx): Promise<Person> {
    return (await signedIn(ctx)) ?? fail('NOT_SIGNED_IN', 'Sign in first.')
  }

  async function agent(
    ctx: QCtx,
    caller: AgentCaller,
    options: { approved?: boolean; followUp?: boolean } = {},
  ): Promise<Agent> {
    if (caller.door === 'app') {
      // An in-app agent acts on a grant the person gave it, not on their login session,
      // and only from a run that is still going: a step left over from an ended run stops.
      const runId = lib(ctx).normalizeId('agentRuns', caller.runId)
      const run = runId && (await lib(ctx).get(runId))
      const grant = run && (await lib(ctx).get(run.grantId))
      if (!run || !grant || grant.revokedAt !== undefined || grant.expiresAt <= Date.now()) {
        fail('AGENT_DISABLED', 'This agent is turned off.')
      }
      // Work an approved request scheduled is bound to that approval, not to the run: the run may
      // end before it runs. Turning the agent off still stops it (the grant check above).
      if (!options.followUp && (run.status === 'done' || run.status === 'failed'))
        fail('AGENT_DISABLED', 'This run has ended.')
      // A step acts only in its own turn while the run runs. Work a person approved is bound to
      // its request instead (checked by the caller).
      if (!options.approved && (run.status !== 'running' || caller.turn !== run.turn)) {
        fail('AGENT_DISABLED', 'This step of the run is no longer current.')
      }
      const user = await config.user(readOnly(ctx), grant.authId)
      if (!user) fail('ACCOUNT_DISABLED', 'This account cannot use the app right now.')
      return {
        kind: 'agent',
        door: 'app',
        user,
        agent: grant.agent,
        runId: run._id,
        scopes: grant.scopes,
        caller,
      }
    }
    // Work a person approved may run up to 30 minutes after the request, past the
    // access token's 10 minutes; the grant behind it must still be live.
    const { user: authUser } = await auth
      .requireMcpPrincipal(
        ctx,
        caller.principal,
        options.approved ? { allowExpiredToken: true } : {},
      )
      .catch((error: unknown) => {
        // The auth component's answer for a revoked or expired grant: agents meet one code at both doors.
        if ((error as { data?: { code?: unknown } } | null)?.data?.code === 'MCP_ACCESS_DENIED')
          fail('AGENT_DISABLED', 'This connection was revoked or has expired. Reconnect it.')
        throw error
      })
    const user = await config.user(readOnly(ctx), authUser.id)
    if (!user) fail('ACCOUNT_DISABLED', 'This account cannot use the app right now.')
    const { clientId, scopes } = caller.principal
    return { kind: 'agent', door: 'mcp', user, clientId, scopes, caller }
  }

  /** The actor an internal operation acts for, checked again now. */
  async function actingAs(ctx: QCtx, who: ActingAs): Promise<Actor<User> | Visitor | SystemActor> {
    switch (who.kind) {
      case 'system':
        return who
      case 'visitor':
        return who
      case 'agent': {
        const actor = await agent(ctx, who.caller, {
          approved: who.approvalId !== undefined,
          followUp: who.approvalId !== undefined && who.followUp !== undefined,
        })
        if (who.approvalId === undefined) return actor
        // Work done under a person's approval: the approval must be this agent's, and still stand.
        const id = lib(ctx).normalizeId('approvals', who.approvalId)
        const row = id && (await lib(ctx).get(id))
        // While `approve` runs this very request; and, for an hour after, the work it scheduled then
        // (an internal action that calls out, then records the result), known by the token it
        // carries. A pending, declined, failed or old approval, or other work of the same agent,
        // grants nothing (R22; docs-only slice; Codex round 3). The grant is checked again above,
        // so a revoked connection stops follow-ups too.
        const standing =
          row?.status === 'executing' ||
          (row?.status === 'approved' &&
            row.decidedAt !== undefined &&
            Date.now() < row.decidedAt + followUpWindow &&
            who.followUp !== undefined &&
            who.followUp === row.followUp)
        if (!row || row.requester.key !== actorRecord(actor).key || !standing) {
          fail('APPROVAL_NOT_FOUND', "This work does not run under a person's approval.")
        }
        return {
          ...actor,
          approvalId: who.approvalId,
          ...(who.followUp === undefined ? {} : { followUp: who.followUp }),
        }
      }
      case 'person': {
        const user = await config.user(readOnly(ctx), who.authId)
        if (!user) fail('ACCOUNT_DISABLED', 'This account cannot use the app right now.')
        return { kind: 'person', door: 'web', user, authId: who.authId }
      }
    }
  }

  /** How to pass an actor on to an internal operation. */
  function handOver(actor: Actor<User> | Visitor | SystemActor): ActingAs {
    if (actor.kind === 'system' || actor.kind === 'visitor') return actor
    if (actor.kind === 'person') return { kind: 'person', authId: actor.authId }
    return {
      kind: 'agent',
      caller: actor.caller,
      ...(actor.approvalId === undefined ? {} : { approvalId: actor.approvalId }),
      ...(actor.followUp === undefined ? {} : { followUp: actor.followUp }),
    }
  }

  /**
   * The tenants named by the input: the tenant of every ID whose table has a
   * `tenant` rule, at any depth (arrays, objects, unions). Rows read here are
   * kept for the handler.
   */
  async function tenantsOf(
    ctx: QCtx,
    op: Pick<Operation, 'args'>,
    input: Record<string, unknown>,
    rows: Map<string, Record<string, unknown> | null>,
  ) {
    const found = new Map<string, TenantRef>()
    const isId = (table: string, value: string) => isIdOf(ctx.db, table, value)
    let ids = 0
    async function visit(json: ValidatorJson, value: unknown, inUnion: boolean): Promise<void> {
      if (value === undefined || value === null) return
      switch (json.type) {
        case 'id': {
          if (typeof value !== 'string') return
          if (++ids > idsPerCall) fail('TOO_LARGE', `Send at most ${idsPerCall} IDs per call.`)
          if (!tenants.tenantFieldsOf.has(json.tableName)) return
          const id = ctx.db.normalizeId(json.tableName as never, value)
          // In a union, a string that is not this table's ID belongs to another member.
          if (!id && inUnion) return
          if (!rows.has(value))
            rows.set(value, id && ((await ctx.db.get(id)) as Record<string, unknown> | null))
          const row = rows.get(value)
          if (!row) fail('NOT_FOUND', `No ${json.tableName} with this ID.`)
          const ref = tenants.rowTenant(ctx.db, json.tableName, row)
          if (ref) found.set(ref.id, ref)
          return
        }
        case 'array':
          if (Array.isArray(value)) for (const item of value) await visit(json.value, item, inUnion)
          return
        case 'object':
          if (typeof value === 'object') {
            for (const [key, field] of Object.entries(json.value)) {
              await visit(field.fieldType, (value as Record<string, unknown>)[key], inUnion)
            }
          }
          return
        case 'record':
          if (typeof value === 'object') {
            for (const [key, item] of Object.entries(value)) {
              await visit(json.keys, key, inUnion)
              await visit(json.values.fieldType, item, inUnion)
            }
          }
          return
        case 'union':
          // Only the members the value is: an ID-shaped string in another member's text field names no tenant.
          for (const member of json.value)
            if (matches(member, value, isId)) await visit(member, value, true)
          return
      }
    }
    for (const [name, validator] of Object.entries(op.args))
      await visit(jsonOf(validator), input[name], false)
    return [...found.values()]
  }

  /**
   * The one place that turns an actor, an operation and its input into a
   * decision, and the context its handler runs with: the actor, `ctx.db` with
   * the row rules applied for this call, and `ctx.run`/`ctx.schedule` for
   * internal operations.
   */
  async function authorize<Ctx extends QCtx>(
    ctx: Ctx,
    op: Pick<Operation, 'action' | 'args' | 'crossTenant'> & { kind?: Operation['kind'] },
    actor: Actor<User> | Visitor | SystemActor,
    input: Record<string, unknown>,
  ) {
    const rows = new Map<string, Record<string, unknown> | null>()
    const roles = new Map<string, string | null>()
    const load = async (id: string) => {
      if (!rows.has(id))
        rows.set(id, (await ctx.db.get(id as never)) as Record<string, unknown> | null)
      return rows.get(id)!
    }
    const roleOf = (ref: TenantRef) =>
      actor.kind === 'person' || actor.kind === 'agent'
        ? config.roleOf(readOnly(ctx), actor.user, ref as TenantOf<DM>)
        : Promise.resolve(null)

    const named = await tenantsOf(ctx, op, input, rows)
    const chains = await Promise.all(named.map((ref) => tenants.chain(load, ctx.db, ref)))
    for (const ref of named) roles.set(ref.id, await roleOf(ref))
    const open = isPublic(op.action) || actor.kind === 'system'
    // Without any role there, the tenant's resources do not exist for this actor:
    // FORBIDDEN would tell an agent that a foreign ID is real.
    if (!open && named.some((ref) => roles.get(ref.id) === null))
      fail('NOT_FOUND', 'Nothing with these IDs was found.')
    // IDs from one place: every named tenant lies on the chain of the deepest one.
    const deepest = chains.find((chain) => named.every((ref) => chain.some((t) => t.id === ref.id)))
    if (named.length > 0 && !deepest && !op.crossTenant) {
      fail('FORBIDDEN', 'These IDs belong to different places. Use IDs from one place per call.')
    }
    // A call that spans places has no tenant of its own: each place's role must allow it, and
    // each row is checked in its own place.
    if (op.crossTenant && !open) {
      for (const ref of named) {
        const role = roles.get(ref.id)
        if (role === null || role === undefined || !roleAllows(policy, role, op.action))
          fail('FORBIDDEN', `You may not ${op.action} here.`)
      }
    }
    const tenant = op.crossTenant ? undefined : deepest?.[0]
    const asker =
      actor.kind === 'agent'
        ? { kind: 'agent' as const, scopes: actor.scopes }
        : { kind: actor.kind }
    const decision: Decision = decide(policy, {
      action: op.action as ActionOf<P>,
      asker,
      role: (tenant ? roles.get(tenant.id) : null) as RoleOf<P> | null,
      tenantless: tenant === undefined,
      input,
    })
    if (decision === 'deny') {
      fail(
        actor.kind === 'visitor' ? 'NOT_SIGNED_IN' : 'FORBIDDEN',
        actor.kind === 'visitor' ? 'Sign in first.' : `You may not ${op.action} here.`,
      )
    }
    // A call the policy allows takes its token; the decision came first, so a denied call costs nothing.
    // An agent's request that waits for a person takes it when the person's approval runs it.
    const limit = op.kind === 'mutation' ? limitOf(policy, op.action) : undefined
    if (
      limit &&
      actor.kind !== 'system' &&
      (decision === 'allow' || (actor.kind === 'agent' && actor.approvalId !== undefined))
    )
      await spend(ctx, actor, op.action, tenant, limit)
    // A system actor's db has no rules: it may change any row.
    let checks = {
      forget: () => {},
      mayWrite: async (_table: string, _row: Record<string, unknown>) => true,
    }
    let tainted: unknown = null
    // Work under a person's approval changes only the rows of the plan the person approved, and
    // rows that work created.
    let plan:
      | { has: (id: string) => Promise<boolean>; created: (id: string) => Promise<void> }
      | undefined
    let files: Set<string> | undefined
    if (actor.kind === 'agent' && actor.approvalId !== undefined) {
      const approvalId = lib(ctx).normalizeId('approvals', actor.approvalId)
      const approval = approvalId && (await lib(ctx).get(approvalId))
      const listed = new Set((approval?.plan as Plan | undefined)?.rows ?? [])
      files = new Set((approval?.plan as Plan | undefined)?.files ?? [])
      plan = {
        has: async (id) =>
          listed.has(id) ||
          (!!approvalId &&
            (await lib(ctx)
              .query('approvalRows')
              .withIndex('by_approval_row', (q) => q.eq('approvalId', approvalId).eq('rowId', id))
              .first()) !== null),
        created: async (id) => {
          if (approvalId)
            await lib(ctx as unknown as MCtx).insert('approvalRows', { approvalId, rowId: id })
        },
      }
    }
    const written = new Set<string>()
    const db = checkedDb(ctx.db as MCtx['db'], rules, {
      // Custom rules see the actor as handlers do, without the approval's credentials (class 10).
      actor: shown(actor),
      action: op.action,
      tenant,
      allows: (role, action) => roleAllows(policy, role, action),
      roleOf,
      known: { roles, rows },
      plan,
      written: (id) => written.add(id),
      expose: (exposed) => (checks = exposed),
    })
    const nested = nestedCalls(
      ctx,
      handOver(actor),
      () => checks.forget(),
      () =>
        (tainted ??= new Error(
          'This call reached a function that is not an internal operation; nothing it did is kept.',
        )),
    )
    /** The handler's result, unless the call reached a raw function: then the whole transaction fails. */
    const settle = <T>(value: T): T => {
      if (tainted) throw tainted
      return value
    }
    rawDbs.set(db, ctx.db as object)
    return {
      decision,
      tenant,
      rows,
      written,
      settle,
      /** May this call change the row? For approvals: rows it only reads give their tenant no say. */
      mayWrite: (table: string, row: Record<string, unknown>) => checks.mayWrite(table, row),
      ctx: {
        ...ctx,
        ...nested,
        ...(files && 'storage' in ctx && { storage: deleting(ctx.storage as object, files) }),
        db: db as Ctx['db'],
        actor: shown(actor),
      },
    }
  }

  /**
   * `ctx.runQuery`, `runMutation`, `runAction` and `scheduler` as in Convex,
   * with one difference: a call to one of the app's own functions carries
   * this call's actor, so it must be an internal operation, which checks the
   * actor, the policy and the row rules again. A raw internal function
   * rejects that argument shape: it cannot be reached from an operation.
   * Component functions (rate limiters, workpools) get their arguments as is.
   */
  function nestedCalls(
    ctx: object,
    acting: ActingAs,
    afterWrite: () => void = () => {},
    reachedRaw: () => void = () => {},
  ) {
    const c = ctx as Record<string, any>
    const isComponent = (ref: unknown) =>
      (getFunctionAddress(ref as never) as { reference?: string }).reference?.startsWith(
        '_reference/childComponent/',
      ) ?? false
    const wrapArgs = (ref: unknown, args: unknown, as: ActingAs = acting) =>
      isComponent(ref) ? args : { actingAs: as, input: args ?? {} }
    // Work an approved request schedules while it runs carries the request's follow-up token
    // (minted by `approve`): only that work continues under the approval after `approve` returns.
    const scheduledAs = async (): Promise<ActingAs> => {
      if (acting.kind !== 'agent' || acting.approvalId === undefined || acting.followUp)
        return acting
      if (!c.db) return acting
      const id = lib(c as { db: unknown }).normalizeId('approvals', acting.approvalId)
      const row = id && (await lib(c as { db: unknown }).get(id))
      if (!row || row.status !== 'executing' || row.followUp === undefined) return acting
      return { ...acting, followUp: row.followUp }
    }
    const approved = acting.kind === 'agent' && acting.approvalId !== undefined
    const scheduledHere = new Set<string>()
    const own = <T>(id: T) => {
      scheduledHere.add(String(id))
      return id
    }
    const runner = (name: string) =>
      c[name]
        ? {
            [name]: async (ref: unknown, args?: unknown) => {
              let out: unknown
              try {
                out = await c[name](ref, wrapArgs(ref, args))
              } catch (error) {
                throw notAnOperation(ref, error)
              } finally {
                // The nested call may have changed memberships or rows this call has cached.
                if (name !== 'runQuery') afterWrite()
              }
              if (isComponent(ref)) return out
              // Only an internal operation answers in this envelope: a raw function's result never reaches the handler.
              if (
                !out ||
                typeof out !== 'object' ||
                (out as { operation?: unknown }).operation !== operationMark
              ) {
                // The raw function already ran. Fail this whole call, so its writes roll back even if
                // the handler catches this error.
                reachedRaw()
                throw notAnOperation(ref, null)
              }
              return (out as { result: unknown }).result
            },
          }
        : {}
    return {
      ...runner('runQuery'),
      ...runner('runMutation'),
      ...runner('runAction'),
      ...(c.scheduler && {
        scheduler: {
          runAfter: async (delay: number, ref: unknown, args?: unknown) =>
            own(await c.scheduler.runAfter(delay, ref, wrapArgs(ref, args, await scheduledAs()))),
          runAt: async (time: number | Date, ref: unknown, args?: unknown) =>
            own(await c.scheduler.runAt(time, ref, wrapArgs(ref, args, await scheduledAs()))),
          cancel: async (id: unknown) => {
            // Work under a person's approval cancels only jobs it scheduled itself (release review 5).
            if (approved && !scheduledHere.has(String(id)))
              fail(
                'FORBIDDEN',
                'This work cancels a job it did not schedule. The person did not approve that.',
              )
            return c.scheduler.cancel(id)
          },
        },
      }),
    }
  }

  /** A raw internal function rejects the actor the call hands over: say what to do instead. */
  function notAnOperation(ref: unknown, error: unknown) {
    const message = error instanceof Error ? error.message : ''
    if (
      error !== null &&
      (!/validator|ArgumentValidationError/i.test(message) ||
        !/actingAs|`input`|field `/.test(message))
    )
      return error
    const name = (getFunctionAddress(ref as never) as { name?: string }).name ?? 'This function'
    return new Error(
      `${name} is not an internal operation, so it cannot run as this call's actor. ` +
        'Build it with internalQuery, internalMutation or internalAction from defineFunctions, or call a plain TypeScript function.',
    )
  }

  /** A wrapper that drops `action` (or a typo cast past the types) fails here, not at the first call. */
  function assertAction(spec: { action?: unknown }) {
    if (
      typeof spec.action !== 'string' ||
      !(policy.actions as readonly string[]).includes(spec.action)
    ) {
      throw new Error(
        `Operation action ${JSON.stringify(spec.action)} is not in the policy's actions. Add it there, or check that a wrapper kept it.`,
      )
    }
  }

  function operation<F>(registered: F, op: Operation): F {
    Object.assign(registered as object, { [OPERATION]: op })
    return registered
  }

  /** The input of an internal operation, or the arguments of a component function. */
  type InputOf<F extends FunctionReference<any, any>> = F['_args'] extends {
    actingAs: ActingAs
    input: infer I
  }
    ? I
    : F['_args']
  type OutputOf<F extends FunctionReference<any, any>> =
    FunctionReturnType<F> extends { operation: typeof operationMark; result: infer O }
      ? O
      : FunctionReturnType<F>
  type Rest<F extends FunctionReference<any, any>> =
    {} extends InputOf<F> ? [input?: InputOf<F>] : [input: InputOf<F>]
  /**
   * A job reference where the caller is an operation: a type error that says why. Jobs run as
   * the system, from a cron or another job; an operation that needs one queues a row instead.
   */
  type NoJob<F extends FunctionReference<any, any>, Jobs extends boolean> = Jobs extends true
    ? F
    : FunctionReturnType<F> extends JobDone
      ? 'A job runs from a cron or another job, not from an operation. Queue a row for it instead.'
      : F
  type Runs<Kinds extends 'query' | 'mutation' | 'action', Jobs extends boolean = false> = {
    runQuery: <F extends FunctionReference<'query', 'internal'>>(
      ref: F,
      ...input: Rest<F>
    ) => Promise<OutputOf<F>>
  } & ('mutation' extends Kinds
    ? {
        runMutation: <F extends FunctionReference<'mutation', 'internal'>>(
          ref: NoJob<F, Jobs>,
          ...input: Rest<F>
        ) => Promise<OutputOf<F>>
      }
    : {}) &
    ('action' extends Kinds
      ? {
          runAction: <F extends FunctionReference<'action', 'internal'>>(
            ref: F,
            ...input: Rest<F>
          ) => Promise<OutputOf<F>>
        }
      : {})
  type Scheduling<Jobs extends boolean = false> = {
    scheduler: {
      runAfter: <F extends FunctionReference<any, 'internal'>>(
        delayMs: number,
        ref: NoJob<F, Jobs>,
        ...input: Rest<F>
      ) => Promise<GenericId<'_scheduled_functions'>>
      runAt: <F extends FunctionReference<any, 'internal'>>(
        time: number | Date,
        ref: NoJob<F, Jobs>,
        ...input: Rest<F>
      ) => Promise<GenericId<'_scheduled_functions'>>
      cancel: (id: GenericId<'_scheduled_functions'>) => Promise<void>
    }
  }
  type QueryCtx = Omit<QCtx, 'runQuery'> & Runs<'query'>
  type MutationCtx = Omit<MCtx, 'runQuery' | 'runMutation' | 'scheduler'> &
    Runs<'query' | 'mutation'> &
    Scheduling
  type JobCtx = Omit<MCtx, 'runQuery' | 'runMutation' | 'scheduler'> &
    Runs<'query' | 'mutation', true> &
    Scheduling<true>
  type ActionCtx = Omit<ACtx, 'runQuery' | 'runMutation' | 'runAction' | 'scheduler'> &
    Runs<'query' | 'mutation' | 'action'> &
    Scheduling

  type Spec<
    Ctx,
    A extends ActionOf<P>,
    Args extends PropertyValidators,
    Returns extends AnyValidator,
    Name extends string,
  > = {
    action: A
    /** IDs of tables with a `tenant` rule (alone or in `allOf`) name the call's tenant; see `anyOf` for the tables that do not. */
    args: Args
    returns: Returns
    tool?: ToolSpec<Name, Args>
    /** The call may name IDs from several tenants ("move to team"); the role must allow the action in each. */
    crossTenant?: true
    handler: (
      ctx: Ctx & { actor: ActorFor<A> },
      args: ObjectType<Args>,
    ) => Promise<Infer<Returns>> | Infer<Returns>
  }

  async function caller(ctx: QCtx, action: string): Promise<Actor<User> | Visitor> {
    return (
      (await signedIn(ctx)) ??
      (isPublic(action) ? { kind: 'visitor' } : fail('NOT_SIGNED_IN', 'Sign in first.'))
    )
  }

  function query<
    const A extends ActionOf<P>,
    Args extends PropertyValidators,
    Returns extends AnyValidator,
    const Name extends string,
  >(spec: Spec<QueryCtx, A, Args, Returns, Name>) {
    assertAction(spec)
    assertUnlimited(spec, 'a query')
    const rule = policy.agents?.[spec.action]
    if (rule === 'approve' || typeof rule === 'function') {
      throw new Error(
        `${spec.action} is a query, so it cannot wait for approval: queries answer at once. ` +
          `Set its agent rule to 'allow' or 'deny', or make the guarded part a mutation.`,
      )
    }
    const op: Operation = { kind: 'query', ...spec }
    const registered = queryGeneric({
      args: spec.args,
      returns: spec.returns,
      handler: async (ctx: QCtx, input: ObjectType<Args>) => {
        const { ctx: checked, settle } = await authorize(
          ctx,
          op,
          await caller(ctx, spec.action),
          input,
        )
        return settle(await spec.handler(checked as never, input))
      },
    })
    return operation<RegisteredQuery<'public', ObjectType<Args>, Promise<Infer<Returns>>>>(
      registered,
      op,
    )
  }

  function mutation<
    const A extends ActionOf<P>,
    Args extends PropertyValidators,
    Returns extends AnyValidator,
    const Name extends string,
    Pl extends Plan = Plan,
  >(
    spec: Omit<Spec<MutationCtx, A, Args, Returns, Name>, 'handler'> & {
      /**
       * What a person approves when an agent asks: one sentence to read, and the existing rows
       * the work may change. Runs when the agent asks; the handler then gets this plan as it
       * was, and changes no other existing row. Approving fails as STALE when a listed row or a
       * row the input names changed. It reads only, under the call's row rules, without
       * `paginate`: fail here for work that could never run, so it never reaches a person.
       * For a person's own call it runs too, right before the handler.
       */
      plan?: (
        ctx: Omit<QueryCtx, 'runQuery'> & { actor: ActorFor<A> },
        args: Readonly<ObjectType<Args>>,
      ) => Pl | Promise<Pl>
      handler: (
        ctx: MutationCtx & { actor: ActorFor<A> },
        args: ObjectType<Args>,
        plan: Readonly<Pl>,
      ) => Promise<Infer<Returns>> | Infer<Returns>
    },
  ) {
    assertAction(spec)
    const op = { kind: 'mutation', ...spec } as unknown as Operation
    const registered = mutationGeneric({
      args: spec.args,
      returns: spec.returns,
      handler: async (ctx: MCtx, input: ObjectType<Args>) => {
        const who = await caller(ctx, spec.action)
        const { ctx: checked, settle, tenant, written } = await authorize(ctx, op, who, input)
        const plan = frozen(await planOf(op, checked, input))
        const result = settle(await spec.handler(checked as never, input, plan as Pl))
        // Same transaction as the handler: a call that fails writes no audit row. A visitor has no actor to record.
        if (who.kind !== 'visitor' && isAudited(policy, spec.action)) {
          const ids = [...written]
          await lib(ctx).insert('auditLog', {
            actor: actorRecord(who),
            action: spec.action,
            ...(tenant && { tenantId: tenant.id }),
            rows: ids.slice(0, auditRows),
            more: Math.max(0, ids.length - auditRows),
          })
        }
        return result
      },
    })
    return operation<RegisteredMutation<'public', ObjectType<Args>, Promise<Infer<Returns>>>>(
      registered,
      op,
    )
  }

  type InternalSpec<
    Ctx,
    A extends ActionOf<P>,
    Args extends PropertyValidators,
    Returns extends AnyValidator,
  > = {
    action: A
    args: Args
    returns?: Returns
    handler: (
      ctx: Ctx & { actor: Actor<User> | Visitor | SystemActor },
      args: ObjectType<Args>,
    ) => Promise<Infer<Returns>> | Infer<Returns>
  }
  const internalArgs = (args: PropertyValidators) => ({
    actingAs: actingAsValidator,
    input: v.object(args),
  })

  /**
   * An internal operation runs as the actor its caller handed over, with the
   * same checks as any call. An agent rule of `approve` holds here too: only
   * work that runs under that agent's approval passes.
   */
  async function authorizeInternal<Ctx extends QCtx>(
    ctx: Ctx,
    spec: Pick<Operation, 'action' | 'args'>,
    who: ActingAs,
    input: Record<string, unknown>,
  ) {
    const actor = await actingAs(ctx, who)
    const authorized = await authorize(ctx, spec, actor, input)
    if (
      authorized.decision === 'approve' &&
      !(actor.kind === 'agent' && actor.approvalId !== undefined)
    ) {
      fail('FORBIDDEN', `${spec.action} needs a person's approval. Use the tool that asks for it.`)
    }
    return authorized
  }

  /**
   * Internal operations: reached only through `ctx.run` / `ctx.schedule` of
   * another operation, a job or an internal action, as the actor that
   * passed them. The actor, policy and row rules are checked like any call.
   */
  function internalQuery<
    const A extends ActionOf<P>,
    Args extends PropertyValidators,
    Returns extends AnyValidator,
  >(spec: InternalSpec<QueryCtx, A, Args, Returns>) {
    assertAction(spec)
    assertUnlimited(spec, 'an internal query')
    return guarded(
      internalQueryGeneric({
        args: internalArgs(spec.args),
        ...(spec.returns && {
          returns: v.object({ operation: v.literal(operationMark), result: spec.returns }),
        }),
        handler: async (
          ctx: QCtx,
          { actingAs: who, input }: { actingAs: ActingAs; input: ObjectType<Args> },
        ) => {
          const { ctx: checked, settle } = await authorizeInternal(ctx, spec, who, input)
          return {
            operation: operationMark,
            result: settle(await spec.handler(checked as never, input)),
          }
        },
      }),
    ) as unknown as FunctionReferenceTarget<'query', ObjectType<Args>, Infer<Returns>>
  }

  function internalMutation<
    const A extends ActionOf<P>,
    Args extends PropertyValidators,
    Returns extends AnyValidator,
  >(spec: InternalSpec<MutationCtx, A, Args, Returns>) {
    assertAction(spec)
    return guarded(
      internalMutationGeneric({
        args: internalArgs(spec.args),
        ...(spec.returns && {
          returns: v.object({ operation: v.literal(operationMark), result: spec.returns }),
        }),
        handler: async (
          ctx: MCtx,
          { actingAs: who, input }: { actingAs: ActingAs; input: ObjectType<Args> },
        ) => {
          const { ctx: checked, settle } = await authorizeInternal(ctx, spec, who, input)
          return {
            operation: operationMark,
            result: settle(await spec.handler(checked as never, input)),
          }
        },
      }),
    ) as unknown as FunctionReferenceTarget<'mutation', ObjectType<Args>, Infer<Returns>>
  }

  /**
   * Work outside the database: fetch a site, send an email, call a model.
   * Scheduled by an operation (`ctx.schedule(0, internal.sites.check, …)`),
   * which already checked the policy; reads and writes go through
   * `ctx.run(internal.…)`, as the same actor. `ctx.actor` is who it acts for,
   * not yet checked again: that happens in each `ctx.run`.
   */
  function internalAction<Args extends PropertyValidators, Returns extends AnyValidator>(spec: {
    /**
     * The policy action this work counts as. When the policy limits it, the action takes a
     * token before its handler (through `takeActionToken`; see `limiter`). A limit `per: 'tenant'`
     * counts per user here: an action reads no rows, so it does not know its tenant.
     */
    action?: ActionOf<P>
    args: Args
    returns?: Returns
    handler: (
      ctx: ActionCtx & { actor: ActingAs },
      args: ObjectType<Args>,
    ) => Promise<Infer<Returns>>
  }) {
    if (spec.action !== undefined) {
      assertAction(spec)
      if (limitOf(policy, spec.action) && !config.limiter)
        throw new Error(
          `${spec.action} has a limit, so its action needs defineFunctions({ limiter: 'module:takeActionToken' }) and that export from the kit.`,
        )
    }
    return guarded(
      internalActionGeneric({
        args: internalArgs(spec.args),
        ...(spec.returns && {
          returns: v.object({ operation: v.literal(operationMark), result: spec.returns }),
        }),
        handler: async (
          ctx: ACtx,
          { actingAs: who, input }: { actingAs: ActingAs; input: ObjectType<Args> },
        ) => {
          // An action has no transaction: a raw function it reached has already committed. It fails loudly
          // instead, and the no-bypass check (raw internal functions must not exist) is what prevents it.
          let reached: unknown = null
          const nested = nestedCalls(
            ctx,
            who,
            () => {},
            () =>
              (reached ??= new Error(
                'This action reached a function that is not an internal operation.',
              )),
          )
          // An action cannot read the approved plan: under an approval, it deletes files through
          // an internal mutation, which can (release review 5).
          const approved = who.kind === 'agent' && who.approvalId !== undefined
          if (spec.action !== undefined && limitOf(policy, spec.action)) {
            await nested.runMutation(
              makeFunctionReference<'mutation'>(config.limiter!) as never,
              {
                action: spec.action,
              } as never,
            )
          }
          const result = await spec.handler(
            {
              ...ctx,
              ...nested,
              ...(approved && { storage: deleting(ctx.storage, new Set()) }),
              actor: shown(who),
            } as never,
            input,
          )
          if (reached) {
            console.error(
              'Raw function reached from an internal action; its writes are committed. Make it an internal operation.',
              reached,
            )
            throw reached
          }
          return { operation: operationMark, result }
        },
      }),
    ) as unknown as FunctionReferenceTarget<'action', ObjectType<Args>, Infer<Returns>>
  }

  /**
   * Internal code run by the system: crons and scheduled work. Recorded as one
   * activity row, with the result (a Convex value; a large one is kept as
   * `{ truncated, bytes }`). `ctx.runQuery`, `runMutation`, `runAction` and
   * `scheduler` reach internal operations, internal actions and other jobs
   * as the system, as in an operation. A cron passes a job its arguments as
   * they are; another job passes them with the system as the actor. An
   * operation cannot start a job.
   */
  function job<Args extends PropertyValidators>(spec: {
    name: string
    args: Args
    handler: (
      ctx: JobCtx & { actor: SystemActor },
      args: ObjectType<Args>,
      // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- a job may return nothing
    ) => Promise<Value | void>
  }) {
    for (const reserved of ['actingAs', 'input']) {
      if (reserved in spec.args)
        throw new Error(`Job ${spec.name}: the argument name ${reserved} is reserved. Rename it.`)
    }
    const required = Object.keys(spec.args).filter(
      (key) => spec.args[key]!.isOptional === 'required',
    )
    // The arguments as a cron passes them (each checked below when required), or wrapped by ctx.run*.
    const args = {
      ...Object.fromEntries(
        Object.entries(spec.args).map(([key, validator]) => [
          key,
          validator.isOptional === 'optional' ? validator : v.optional(validator as AnyValidator),
        ]),
      ),
      actingAs: v.optional(actingAsValidator),
      input: v.optional(v.object(spec.args)),
    }
    // A job runs as the system, by design: crons and the cleanup they schedule.
    return guarded(
      internalMutationGeneric({
        args,
        handler: async (
          ctx: MCtx,
          {
            actingAs: who,
            input: wrapped,
            ...plain
          }: { actingAs?: ActingAs; input?: ObjectType<Args> } & Record<string, unknown>,
        ) => {
          if (who !== undefined && who.kind !== 'system')
            throw new Error(
              `Job ${spec.name} runs from a cron or another job, not from an operation.`,
            )
          if (wrapped === undefined) {
            const missing = required.filter((key) => plain[key] === undefined)
            if (missing.length > 0)
              throw new Error(`Job ${spec.name}: missing argument ${missing.join(', ')}.`)
          }
          const input = (wrapped ?? plain) as ObjectType<Args>
          const actor: SystemActor = { kind: 'system', job: spec.name }
          let tainted: unknown = null
          const nested = nestedCalls(
            ctx,
            actor,
            () => {},
            () =>
              (tainted ??= new Error(
                'This job reached a function that is not an internal operation; nothing it did is kept.',
              )),
          )
          const result = await spec.handler({ ...ctx, ...nested, actor } as never, input)
          if (tainted) throw tainted
          await lib(ctx).insert('activity', {
            actor: { key: `system:${spec.name}`, kind: 'system', door: 'job', job: spec.name },
            action: `job.${spec.name}`,
            status: 'done',
            result: storable(result as Value | undefined),
          })
          // Called through ctx.run*, answer in the envelope that tells an internal operation from a raw function.
          return who ? { operation: operationMark, result: null } : null
        },
      }),
      'job',
    ) as unknown as RegisteredMutation<'internal', ObjectType<Args>, Promise<JobDone>>
  }

  /**
   * Takes an action's token for an `internalAction`. The app exports it from the module that
   * `limiter` names: `export const { takeActionToken } = fns`.
   */
  const takeActionToken = guarded(
    internalMutationGeneric({
      args: internalArgs({ action: v.string() }),
      returns: v.object({ operation: v.literal(operationMark), result: v.null() }),
      handler: async (
        ctx: MCtx,
        { actingAs: who, input }: { actingAs: ActingAs; input: { action: string } },
      ) => {
        const limit = limitOf(policy, input.action)
        if (!limit) throw new Error(`${input.action} has no limit in the policy.`)
        const actor = await actingAs(ctx, who)
        if (actor.kind !== 'system') await spend(ctx, actor, input.action, undefined, limit)
        return { operation: operationMark, result: null }
      },
    }),
  ) as unknown as FunctionReferenceTarget<'mutation', { action: string }, null>

  const fns = {
    /** The policy every operation here checks. */
    policy,
    takeActionToken,
    query,
    mutation,
    internalQuery,
    internalMutation,
    internalAction,
    job,
  }
  kits.set(fns, { auth, person, agent, authorize, lib, tenants, roleOf: config.roleOf })
  return fns
}

/** The registered type of an internal operation, so `internal.x.y` is a ref `ctx.run` accepts with typed input. */
type Envelope<Output> = { operation: typeof operationMark; result: Output }
type FunctionReferenceTarget<
  Kind extends 'query' | 'mutation' | 'action',
  Input,
  Output,
> = Kind extends 'query'
  ? RegisteredQuery<'internal', { actingAs: ActingAs; input: Input }, Promise<Envelope<Output>>>
  : Kind extends 'mutation'
    ? RegisteredMutation<
        'internal',
        { actingAs: ActingAs; input: Input },
        Promise<Envelope<Output>>
      >
    : import('convex/server').RegisteredAction<
        'internal',
        { actingAs: ActingAs; input: Input },
        Promise<Envelope<Output>>
      >

/** At most this many ids go into one audit row; the rest are counted in `more`. */
const auditRows = 50

/** The unchecked db behind a call's `ctx.db`, so `auditTrail` can read the library's table. */
const rawDbs = new WeakMap<object, object>()

/**
 * The audit log of a tenant, newest first, one page at a time. Call it from an
 * operation of your own, whose action decides who may read the log: the
 * library does not.
 */
export async function auditTrail(
  ctx: { db: unknown },
  options: { tenantId: string; paginationOpts: PaginationOptions },
) {
  const db = (rawDbs.get(ctx.db as object) ?? ctx.db) as GenericQueryCtx<LibraryDataModel>['db']
  return await db
    .query('auditLog')
    .withIndex('by_tenant', (q) => q.eq('tenantId', options.tenantId))
    .order('desc')
    .paginate(options.paginationOpts)
}

/** Marks an internal operation's result, so a call can tell it from a raw function's. */
const operationMark = 'better-convex/operation' as const
