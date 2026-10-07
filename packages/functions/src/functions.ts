import {
  getFunctionAddress,
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
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
  failureOf,
  type ActingAs,
  type Actor,
  type AgentCaller,
  type SystemActor,
  type Visitor,
} from './actor'
import { guarded, OPERATION } from './guard'
import {
  decide,
  roleAllows,
  type ActionOf,
  type Decision,
  type Policy,
  type PublicActionOf,
  type RoleOf,
} from './policy'
import { checkedDb, tenancy, type Rule, type TenantRef } from './rules'
import type { libraryTables } from './schema'
import { jsonOf, storable, type ValidatorJson } from './values'

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
  approval?: (ctx: any, args: any) => string | Promise<string>
  /** The call may name IDs from several tenants; the role must allow the action in each. */
  crossTenant?: boolean
  handler: (ctx: any, args: any) => unknown
}

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
  const isPublic = (action: string) =>
    (policy.public as readonly string[] | undefined)?.includes(action) ?? false

  async function signedIn(ctx: QCtx): Promise<Person | null> {
    const authUser = await auth.getUser(ctx)
    if (!authUser) return null
    const user = await config.user(ctx, authUser.id)
    if (!user) fail('ACCOUNT_DISABLED', 'This account cannot use the app right now.')
    return { kind: 'person', door: 'web', user, authId: authUser.id }
  }

  async function person(ctx: QCtx): Promise<Person> {
    return (await signedIn(ctx)) ?? fail('NOT_SIGNED_IN', 'Sign in first.')
  }

  async function agent(
    ctx: QCtx,
    caller: AgentCaller,
    options: { approved?: boolean } = {},
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
      if (run.status === 'done' || run.status === 'failed')
        fail('AGENT_DISABLED', 'This run has ended.')
      // A step acts only in its own turn while the run runs. Work a person approved is bound to
      // its request instead (checked by the caller).
      if (!options.approved && (run.status !== 'running' || caller.turn !== run.turn)) {
        fail('AGENT_DISABLED', 'This step of the run is no longer current.')
      }
      const user = await config.user(ctx, grant.authId)
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
        if (failureOf(error)?.code === 'MCP_ACCESS_DENIED')
          fail('AGENT_DISABLED', 'This connection was revoked or has expired. Reconnect it.')
        throw error
      })
    const user = await config.user(ctx, authUser.id)
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
        const actor = await agent(ctx, who.caller, { approved: who.approvalId !== undefined })
        if (who.approvalId === undefined) return actor
        // Work done under a person's approval: the approval must be this agent's, and still stand.
        const id = lib(ctx).normalizeId('approvals', who.approvalId)
        const row = id && (await lib(ctx).get(id))
        // Only while `approve` runs this very request: a pending or earlier approval grants nothing.
        if (!row || row.requester.key !== actorRecord(actor).key || row.status !== 'executing') {
          fail('APPROVAL_NOT_FOUND', "This work does not run under a person's approval.")
        }
        return { ...actor, approvalId: who.approvalId }
      }
      case 'person': {
        const user = await config.user(ctx, who.authId)
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
          for (const member of json.value) await visit(member, value, true)
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
    op: Pick<Operation, 'action' | 'args' | 'crossTenant'>,
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
        ? config.roleOf(ctx, actor.user, ref as TenantOf<DM>)
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
    // A system actor's db has no rules: it may change any row.
    let checks = {
      forget: () => {},
      mayWrite: async (_table: string, _row: Record<string, unknown>) => true,
    }
    let tainted: unknown = null
    const db = checkedDb(ctx.db as MCtx['db'], rules, {
      actor,
      action: op.action,
      tenant,
      allows: (role, action) => roleAllows(policy, role, action),
      roleOf,
      known: { roles, rows },
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
    return {
      decision,
      tenant,
      rows,
      settle,
      /** May this call change the row? For approvals: rows it only reads give their tenant no say. */
      mayWrite: (table: string, row: Record<string, unknown>) => checks.mayWrite(table, row),
      ctx: { ...ctx, ...nested, db: db as Ctx['db'], actor },
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
    const wrapArgs = (ref: unknown, args: unknown) =>
      isComponent(ref) ? args : { actingAs: acting, input: args ?? {} }
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
          runAfter: (delay: number, ref: unknown, args?: unknown) =>
            c.scheduler.runAfter(delay, ref, wrapArgs(ref, args)),
          runAt: (time: number | Date, ref: unknown, args?: unknown) =>
            c.scheduler.runAt(time, ref, wrapArgs(ref, args)),
          cancel: (id: unknown) => c.scheduler.cancel(id),
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
  type Runs<Kinds extends 'query' | 'mutation' | 'action'> = {
    runQuery: <F extends FunctionReference<'query', 'internal'>>(
      ref: F,
      ...input: Rest<F>
    ) => Promise<OutputOf<F>>
  } & ('mutation' extends Kinds
    ? {
        runMutation: <F extends FunctionReference<'mutation', 'internal'>>(
          ref: F,
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
  type Scheduling = {
    scheduler: {
      runAfter: <F extends FunctionReference<any, 'internal'>>(
        delayMs: number,
        ref: F,
        ...input: Rest<F>
      ) => Promise<GenericId<'_scheduled_functions'>>
      runAt: <F extends FunctionReference<any, 'internal'>>(
        time: number | Date,
        ref: F,
        ...input: Rest<F>
      ) => Promise<GenericId<'_scheduled_functions'>>
      cancel: (id: GenericId<'_scheduled_functions'>) => Promise<void>
    }
  }
  type QueryCtx = Omit<QCtx, 'runQuery'> & Runs<'query'>
  type MutationCtx = Omit<MCtx, 'runQuery' | 'runMutation' | 'scheduler'> &
    Runs<'query' | 'mutation'> &
    Scheduling
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
  >(
    spec: Spec<MutationCtx, A, Args, Returns, Name> & {
      /**
       * One sentence a person reads before approving an agent's request. The
       * rows it reads are fingerprinted: approving fails when one changed.
       * It runs before the request is stored, under the call's row rules, and
       * public rows are readable to everyone: fail here for work that could
       * never run (a row outside the call's tenant), so it never reaches a
       * person as a request (content slice).
       */
      approval?: (
        ctx: MCtx & { actor: ActorFor<A> },
        args: ObjectType<Args>,
      ) => string | Promise<string>
    },
  ) {
    assertAction(spec)
    const op: Operation = { kind: 'mutation', ...spec }
    const registered = mutationGeneric({
      args: spec.args,
      returns: spec.returns,
      handler: async (ctx: MCtx, input: ObjectType<Args>) => {
        const { ctx: checked, settle } = await authorize(
          ctx,
          op,
          await caller(ctx, spec.action),
          input,
        )
        return settle(await spec.handler(checked as never, input))
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
    args: Args
    returns?: Returns
    handler: (
      ctx: ActionCtx & { actor: ActingAs },
      args: ObjectType<Args>,
    ) => Promise<Infer<Returns>>
  }) {
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
          const result = await spec.handler({ ...ctx, ...nested, actor: who } as never, input)
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
   * `scheduler` reach internal operations and internal actions as the system,
   * as in an operation.
   */
  function job<Args extends PropertyValidators>(spec: {
    name: string
    args: Args
    handler: (
      ctx: MutationCtx & { actor: SystemActor },
      args: ObjectType<Args>,
      // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- a job may return nothing
    ) => Promise<Value | void>
  }) {
    // A job runs as the system, by design: crons and the cleanup they schedule.
    return guarded(
      internalMutationGeneric({
        args: spec.args,
        handler: async (ctx: MCtx, input: ObjectType<Args>) => {
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
          return null
        },
      }),
      'job',
    )
  }

  const fns = {
    /** The policy every operation here checks. */
    policy,
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

/** Marks an internal operation's result, so a call can tell it from a raw function's. */
const operationMark = 'better-convex/operation' as const
