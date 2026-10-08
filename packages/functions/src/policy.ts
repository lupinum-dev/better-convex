/**
 * The permission model, as plain data. It has no server imports, so the browser
 * (`useCan`) and Convex functions decide with the same `decide`.
 *
 * An action is allowed when every layer allows it:
 * role ∩ grant scopes (agents only) ∩ agent rule (agents only).
 */

/** `'a.b.*'` for every prefix of a dotted action name. */
type Prefixes<A extends string> = A extends `${infer Head}.${infer Tail}`
  ? Head | `${Head}.${Prefixes<Tail>}`
  : never

/** `'projects.create'`, `'projects.*'`, `'billing.invoices.*'` or `'*'`. */
type Pattern<A extends string> = A | `${Prefixes<A>}.*` | '*'

/** What an agent may do on its own. A function reads the call's input: `({ amount }) => amount > 1000 ? 'approve' : 'allow'`. */
export type AgentRule =
  | 'allow'
  | 'approve'
  | 'deny'
  | ((input: Record<string, any>) => 'allow' | 'approve' | 'deny')

/** How often an action may run: `max` calls per `every`, refilled continuously. */
export interface Limit {
  /** Whole calls the bucket holds, and refills per `every`. At least 1. */
  max: number
  every: 'second' | 'minute' | 'hour' | 'day'
  /**
   * Whose calls share the bucket. `'user'` (default): the actor's user, or the agent's user and client.
   * `'tenant'`: the call's tenant (a call without a tenant uses `'user'`). `'everyone'`: one bucket for the action.
   * A visitor, who has no user, uses `'everyone'` for any of these.
   */
  per?: 'user' | 'tenant' | 'everyone'
}

export const everyMs = { second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000 } as const

/** The limit of an action, or `undefined` when it has none. */
export function limitOf(policy: Policy, action: string): Required<Limit> | undefined {
  const limit = own(policy.limits as Record<string, Limit> | undefined, action)
  return limit && { ...limit, per: limit.per ?? 'user' }
}

/** Is a call to this action recorded in the audit log? */
export function isAudited(policy: Policy, action: string): boolean {
  return matches((policy.audit as readonly string[] | undefined) ?? [], action)
}

interface PolicyConfig<A extends string, R extends string, S extends string> {
  /** Every action the app has. Only this list defines the action names; typos elsewhere are type errors. */
  actions: readonly A[]
  /** What each role may do. Roles come from the app (`roleOf`). */
  roles: Record<R, readonly Pattern<NoInfer<A>>[]>
  /** OAuth scopes a person grants to an outside agent, with the consent text. */
  scopes: Record<S, { label: string; actions: readonly Pattern<NoInfer<A>>[] }>
  /** What agents may do on their own. Missing actions are `'allow'`. */
  agents?: Partial<Record<NoInfer<A>, AgentRule>>
  /**
   * Who else may decide an agent's request, by role in the request's tenant.
   * The person the agent acts for always may. The request's tenant is the
   * call's: the deepest tenant its input names (the site, not the agency
   * above it), and `roleOf` decides the role there, so a parent's owner
   * qualifies when `roleOf` lets the child inherit.
   *
   * `{ roles, sharedRows: true }` also lets these roles of another tenant
   * decide when every row the call's input names, and the agent may change,
   * belongs to that tenant too: the seller of an order a buyer's agent
   * cancels. Rows the call only reads (a listing it buys) give no say.
   */
  approvers?: Partial<Record<NoInfer<A>, Approvers<NoInfer<R>>>>
  /**
   * How often each action may run. A call over the limit fails with
   * `RATE_LIMITED`. A call the policy denies never takes a token, and a call
   * that fails gives its token back. Only mutations and actions are limited,
   * and jobs (the system) never are.
   */
  limits?: Partial<Record<NoInfer<A>, Limit>>
  /**
   * Actions recorded in the audit log, with the same patterns as `roles`. Each
   * successful call of a mutation writes one `auditLog` row: who, which
   * action, which tenant and which row ids it changed.
   */
  audit?: readonly Pattern<NoInfer<A>>[]
}

/** The roles that may decide an agent's request; see `approvers`. */
export type Approvers<R extends string = string> =
  | readonly R[]
  | { roles: readonly R[]; sharedRows: true }

export interface Policy<
  A extends string = string,
  R extends string = string,
  S extends string = string,
  Pub extends string = string,
> extends PolicyConfig<A, R, S> {
  /** Actions anyone may call, signed in or not. Row rules still decide which rows they see. */
  public?: readonly Pub[]
  readonly __policy: true
}

export type ActionOf<P> = P extends Policy<infer A, string, string> ? A : never
export type RoleOf<P> = P extends Policy<string, infer R, string> ? R : never
export type ScopeOf<P> = P extends Policy<string, string, infer S> ? S : never
export type PublicActionOf<P> = P extends Policy<string, string, string, infer Pub> ? Pub : never

export function definePolicy<
  const A extends string,
  const R extends string,
  const S extends string,
  const Pub extends A = never,
>(
  config: PolicyConfig<A, R, S> & {
    /** Actions anyone may call, signed in or not. Row rules still decide which rows they see. */
    public?: readonly Pub[]
  },
): Policy<A, R, S, Pub> {
  const actions = config.actions as readonly string[]
  for (const [action, limit] of Object.entries(config.limits ?? {}) as [string, Limit][]) {
    if (!actions.includes(action))
      throw new Error(
        `limits names ${JSON.stringify(action)}, which is not in the policy's actions.`,
      )
    if (!Number.isInteger(limit.max) || limit.max < 1)
      throw new Error(`The limit of ${action} needs max to be a whole number of at least 1.`)
    if (!Object.hasOwn(everyMs, limit.every))
      throw new Error(
        `The limit of ${action} needs every to be 'second', 'minute', 'hour' or 'day'.`,
      )
    if (limit.per !== undefined && !['user', 'tenant', 'everyone'].includes(limit.per))
      throw new Error(`The limit of ${action} needs per to be 'user', 'tenant' or 'everyone'.`)
  }
  for (const pattern of (config.audit ?? []) as readonly string[]) {
    if (!actions.some((action) => matches([pattern], action)))
      throw new Error(
        `audit lists ${JSON.stringify(pattern)}, which matches no action of the policy.`,
      )
  }
  return { ...config, __policy: true }
}

function matches(patterns: readonly string[], action: string): boolean {
  return patterns.some(
    (pattern) =>
      pattern === '*' ||
      pattern === action ||
      (pattern.endsWith('.*') && action.startsWith(pattern.slice(0, -1))),
  )
}

/** Own properties only, so a role or scope named like `__proto__` or `toString` matches nothing. */
function own<T>(record: Record<string, T> | undefined, key: string): T | undefined {
  return record && Object.hasOwn(record, key) ? record[key] : undefined
}

/** Who asks, as far as the policy cares. */
export type Asker =
  | { kind: 'person' }
  | { kind: 'agent'; scopes: readonly string[] | 'all' }
  | { kind: 'visitor' }
  | { kind: 'system' }

export type Decision = 'allow' | 'approve' | 'deny'

/**
 * The one decision function. `role` is the asker's role in the call's tenant,
 * `null` without a membership; a call without a tenant (`tenantless`) skips
 * the role layer, and the row rules check each row in its own tenant.
 * `input` feeds agent rules that read it.
 */
export function decide<P extends Policy>(
  policy: P,
  call: {
    action: ActionOf<P>
    asker: Asker
    role: RoleOf<P> | null
    tenantless?: boolean
    input?: Record<string, unknown>
  },
): Decision {
  const { action, asker, role } = call
  if (asker.kind === 'system') return 'allow'
  const isPublic = (policy.public as readonly string[] | undefined)?.includes(action) ?? false
  if (asker.kind === 'visitor') return isPublic ? 'allow' : 'deny'
  if (!isPublic && !call.tenantless) {
    if (role === null || !roleAllows(policy, role, action)) return 'deny'
  }
  if (asker.kind === 'person') return 'allow'
  if (asker.scopes !== 'all') {
    const granted = asker.scopes.some((scope) => {
      const entry = own(policy.scopes as Record<string, { actions: readonly string[] }>, scope)
      return entry !== undefined && matches(entry.actions, action)
    })
    if (!granted) return 'deny'
  }
  return agentRule(policy, action, call.input ?? {})
}

const decisions: readonly unknown[] = ['allow', 'approve', 'deny']

/**
 * The agent rule for an action and input. A rule that throws on odd input, or
 * returns something that is not a decision (`decisions[mode]` for an unknown
 * mode is `undefined`), asks a person: it never fails open.
 */
function agentRule(policy: Policy, action: string, input: Record<string, unknown>): Decision {
  // No rule allows; an explicit null is not a decision and asks a person like any other.
  const stated = own(policy.agents as Record<string, AgentRule> | undefined, action)
  const rule = stated === undefined ? 'allow' : stated
  let decision: unknown = rule
  if (typeof rule === 'function') {
    try {
      decision = rule(input)
    } catch {
      return 'approve'
    }
  }
  return decisions.includes(decision) ? (decision as Decision) : 'approve'
}

/** May this role do this action? The role layer of `decide`, also used for each row a call touches. */
export function roleAllows(policy: Policy, role: string, action: string): boolean {
  return matches(own(policy.roles as Record<string, readonly string[]>, role) ?? [], action)
}

/** Scopes whose actions include this action. */
export function scopesFor(policy: Policy, action: string): string[] {
  return Object.entries(policy.scopes as Record<string, { actions: readonly string[] }>)
    .filter(([, entry]) => matches(entry.actions, action))
    .map(([scope]) => scope)
}

/** For the browser: may a person with this role do this action? Same rule as the server. */
export function can<P extends Policy>(
  policy: P,
  action: ActionOf<P>,
  role: RoleOf<P> | null | undefined,
): boolean {
  return decide(policy, { action, asker: { kind: 'person' }, role: role ?? null }) === 'allow'
}

/** The scope list and consent text in the shape the OAuth profile expects. */
export function consentScopes<P extends Policy>(policy: P): Record<ScopeOf<P>, string> {
  return Object.fromEntries(
    Object.entries(policy.scopes).map(([scope, entry]) => [
      scope,
      (entry as { label: string }).label,
    ]),
  ) as Record<ScopeOf<P>, string>
}

/** Who besides the requester may decide an agent's request for this action. */
export function approversFor(
  policy: Policy,
  action: string,
): { roles: readonly string[]; sharedRows: boolean } {
  const entry = own(policy.approvers as Record<string, Approvers> | undefined, action)
  if (entry === undefined) return { roles: [], sharedRows: false }
  return Array.isArray(entry)
    ? { roles: entry, sharedRows: false }
    : { roles: (entry as { roles: readonly string[] }).roles, sharedRows: true }
}
