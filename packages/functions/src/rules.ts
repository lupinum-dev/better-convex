import type { GenericDatabaseReader, GenericDatabaseWriter, GenericDataModel } from 'convex/server'

import { fail, type Actor, type SystemActor, type Visitor } from './actor'
import { libraryTables } from './schema'

/**
 * Row rules: who may read and write each row. Every app table has one, and the
 * library checks it on every row a handler reads or writes through `ctx.db`,
 * so a forgotten filter cannot hand out another person's data.
 */
export type Rule<Row = any, User = any, DM extends GenericDataModel = GenericDataModel> =
  | { kind: 'tenant'; field: keyof Row & string; createdBy?: string; parent?: keyof Row & string }
  | { kind: 'owner'; field: keyof Row & string }
  | { kind: 'publicRead'; where?: (row: Row) => boolean }
  | { kind: 'anyOf'; rules: readonly Rule<Row, User, DM>[] }
  | { kind: 'allOf'; rules: readonly Rule<Row, User, DM>[] }
  | { kind: 'custom'; check: (ctx: RuleCtx<User, DM>, row: Row) => boolean | Promise<boolean> }
  | { kind: 'unchecked'; reason: string }

/** A tenant: a row of a table whose rule is `tenant('_id')`. */
export interface TenantRef {
  table: string
  id: string
}

export interface RuleCtx<User = any, DM extends GenericDataModel = GenericDataModel> {
  actor: Actor<User> | Visitor
  /** The call's action, for example `'notes.edit'`. */
  action: string
  /** Reading the row, or writing it (insert, patch, replace, delete). */
  mode: 'read' | 'write'
  /**
   * The call's tenant: the deepest tenant its input names, `undefined` for a
   * tenantless call. A rule for a row two parties share uses it to require
   * that the party acting is the one the call names (marketplace slice).
   */
  tenant: TenantRef | undefined
  /** The database without rules, for lookups a rule needs. */
  db: GenericDatabaseReader<DM>
  /** The actor's role in a tenant, or `null`. */
  roleIn(tenant: TenantRef): Promise<string | null>
  /** Does the actor's role in this tenant allow the call's action? The policy's role layer. */
  allows(tenant: TenantRef): Promise<boolean>
}

/**
 * The row belongs to the tenant in `field` (`'_id'` for the tenant table
 * itself). A call may touch it when the actor's role there allows the call's
 * action, and only inside the call's own tenant when it has one. An empty
 * field does not match, so `anyOf(owner('authorId'), tenant('orgId'))` covers
 * rows that are private or shared.
 *
 * On a tenant table, `parent` names the tenant above it (agency → client): a
 * call in the parent reaches the child's rows, and the app's `roleOf` decides
 * which roles a child inherits. Nobody has a role in a tenant that does not
 * exist yet, so only the action named in `createdBy` may insert one, and only
 * under a parent where the actor's role allows that action.
 */
export function tenant<const F extends string>(
  field: F,
  options?: { createdBy?: string },
): { kind: 'tenant'; field: F; createdBy?: string }
export function tenant<const F extends string, const P extends string>(
  field: F,
  options: { createdBy?: string; parent: P },
): { kind: 'tenant'; field: F; createdBy?: string; parent: P }
export function tenant(field: string, options: { createdBy?: string; parent?: string } = {}) {
  return { kind: 'tenant' as const, field, ...options }
}

/** The row belongs to the user in `field` (`'_id'` for the users table itself). */
export function owner<const F extends string>(field: F) {
  return { kind: 'owner' as const, field }
}

/**
 * Anyone may read matching rows, signed-out visitors too. Writes need another
 * rule in `anyOf`. Queries are checked, not filtered: a query that returns a
 * row `where` refuses fails, so narrow it by an index on the same condition
 * (for example `by_site_status_slug` with `status: 'published'`).
 *
 * Type the row `where` reads (`(page: Doc<'pages'>) => …`): inside `anyOf`
 * TypeScript cannot infer it, and an untyped row is a type error, not `any`.
 */
export function publicRead(): { kind: 'publicRead' }
export function publicRead<Row>(where: (row: Row) => boolean): {
  kind: 'publicRead'
  where: (row: Row) => boolean
}
export function publicRead(where?: (row: Record<string, unknown>) => boolean) {
  return { kind: 'publicRead' as const, where }
}

/**
 * The row passes when one of the rules passes. A write one rule refuses with
 * FORBIDDEN stays refused unless another allows it.
 *
 * An ID of an `anyOf` table does not name the call's tenant, as its rows may
 * be private, public or shared by two tenants. An operation on such rows
 * names its tenant in its own arguments (`siteId`, `orgId`); without one the
 * call is tenantless: no role layer, approvals without a tenant, and agent
 * work in no tenant's activity feed.
 */
export function anyOf<const R extends readonly unknown[]>(...rules: R) {
  return { kind: 'anyOf' as const, rules }
}

/**
 * The row passes when every rule passes: a condition on the row's state
 * ("only drafts change") sits in the rule, so an operation that forgets it in
 * its handler still cannot break it. A write is checked on the row before and
 * after the change. The row is hidden when one rule hides it, else refused
 * when one refuses it.
 *
 * With a `tenant` rule among its parts, every row belongs to that tenant, so
 * an ID of the table names the call's tenant as for a plain `tenant` rule.
 */
export function allOf<const R extends readonly [unknown, ...unknown[]]>(...rules: R) {
  return { kind: 'allOf' as const, rules }
}

/**
 * Any other rule. Return `false` and the row does not exist for this actor; a
 * refused write of a row the actor may read fails with FORBIDDEN instead.
 * Use `ctx.allows(tenant)` to apply the role layer: a custom rule that checks
 * membership alone lets a viewer write. Type the row (`custom<Doc<'orders'>>`);
 * untyped it is `unknown`.
 */
export function custom<Row = unknown, User = any, DM extends GenericDataModel = any>(
  check: (ctx: RuleCtx<User, DM>, row: Row) => boolean | Promise<boolean>,
) {
  return { kind: 'custom' as const, check }
}

/** No check. Say why, so a reviewer can find and judge every one. */
export function unchecked(reason: string) {
  return { kind: 'unchecked' as const, reason }
}

type Verdict = 'ok' | 'hidden' | 'denied'
type Row = Record<string, unknown>

/** What one call may touch: who acts, for which action, in which tenant. */
export interface Call<User> {
  actor: Actor<User> | Visitor | SystemActor
  action: string
  tenant: TenantRef | undefined
  /** May this role do this action? From the policy. */
  allows: (role: string, action: string) => boolean
  roleOf: (tenant: TenantRef) => Promise<string | null>
  /** Roles and rows already looked up for this call. */
  known?: { roles: Map<string, string | null>; rows: Map<string, Row | null> }
  /**
   * Receives two checks for the library's own use: `forget` drops cached roles
   * and rows after writes made outside this db (a nested mutation), and
   * `mayWrite` says whether this call may change a row.
   */
  expose?: (checks: {
    forget: () => void
    mayWrite: (table: string, row: Row) => Promise<boolean>
  }) => void
}

const libraryTableNames = new Set(Object.keys(libraryTables))

/**
 * How the rules place rows in tenants: which tables are tenants, the tenant a
 * row belongs to, and the chain of tenants above it. Shared by the call's
 * tenant check (`functions.ts`) and the row check below.
 */
export function tenancy(rules: Record<string, Rule>) {
  type TenantRule = Extract<Rule, { kind: 'tenant' }>
  const tenantRules = (rule: Rule): TenantRule[] =>
    rule.kind === 'tenant'
      ? [rule]
      : rule.kind === 'anyOf' || rule.kind === 'allOf'
        ? rule.rules.flatMap(tenantRules)
        : []
  /** Tenant rules every row of the table must pass: the rule itself, or parts of an `allOf`. */
  const requiredTenantRules = (rule: Rule): TenantRule[] =>
    rule.kind === 'tenant'
      ? [rule]
      : rule.kind === 'allOf'
        ? rule.rules.flatMap(requiredTenantRules)
        : []
  /** Tenant tables and the field naming their parent tenant. */
  const tenantTables = new Map(
    Object.entries(rules).flatMap(([table, rule]) =>
      tenantRules(rule)
        .filter((r) => r.field === '_id')
        .map((r) => [table, r.parent] as const),
    ),
  )
  /**
   * Tables whose every row belongs to a tenant, and the field that holds it:
   * an ID of one names the call's tenant. A table with `anyOf` does not, as
   * its rows may be private; each of its rows is checked on its own.
   */
  const tenantFieldsOf = new Map(
    Object.entries(rules).flatMap(([table, rule]) => {
      const fields = requiredTenantRules(rule).map((r) => r.field)
      return fields.length > 0 ? [[table, fields] as const] : []
    }),
  )

  function refOf(
    db: GenericDatabaseReader<any>,
    value: unknown,
    hint?: string,
  ): TenantRef | undefined {
    if (typeof value !== 'string') return undefined
    for (const table of hint ? [hint] : tenantTables.keys()) {
      if (db.normalizeId(table, value) !== null) return { table, id: value }
    }
    return undefined
  }

  /** The tenant a row of `table` belongs to, from its first set tenant field. */
  function rowTenant(
    db: GenericDatabaseReader<any>,
    table: string,
    row: Row,
  ): TenantRef | undefined {
    for (const field of tenantFieldsOf.get(table) ?? []) {
      const ref = field === '_id' ? refOf(db, row._id, table) : refOf(db, row[field])
      if (ref) return ref
    }
    return undefined
  }

  /** The tenant and every tenant above it, nearest first. */
  async function chain(
    load: (id: string) => Promise<Row | null>,
    db: GenericDatabaseReader<any>,
    ref: TenantRef,
  ) {
    const out: TenantRef[] = [ref]
    for (let current = ref; ;) {
      const parentField = tenantTables.get(current.table)
      if (!parentField) return out
      const row = await load(current.id)
      const parent = row ? refOf(db, row[parentField]) : undefined
      if (!parent || out.some((t) => t.id === parent.id)) return out
      out.push(parent)
      current = parent
    }
  }

  return { tenantTables, tenantFieldsOf, rowTenant, chain, refOf }
}

/**
 * `ctx.db` with the rules applied. A `get` of a row the call may not see
 * returns `null`, as for a missing row. A query that returns one throws: the
 * query is missing a filter, and failing loudly is safer than a short page.
 * A write to such a row fails with NOT_FOUND, or FORBIDDEN when the actor may
 * see the row but not do this.
 *
 * Only the methods listed here exist on it, and on its queries; anything else
 * Convex adds later throws until it is checked too.
 */
export function checkedDb<DB extends GenericDatabaseWriter<any>>(
  raw: DB,
  rules: Record<string, Rule>,
  call: Call<any>,
): DB {
  if (call.actor.kind === 'system') return raw
  const actor = call.actor
  const { chain, refOf, tenantTables } = tenancy(rules)
  const roles = call.known?.roles ?? new Map<string, string | null>()
  const roleCache = new Map<string, Promise<string | null>>(
    [...roles].map(([id, role]) => [id, Promise.resolve(role)]),
  )
  // Rows read in this call, so a rule check, a tenant lookup and the handler read each row once.
  const rows = call.known?.rows ?? new Map<string, Row | null>()

  // A write may change a membership, so roles are looked up again after any write.
  const wrote = (id?: string) => {
    roleCache.clear()
    if (id) rows.delete(id)
  }
  const roleIn = (ref: TenantRef) => {
    if (actor.kind === 'visitor') return Promise.resolve(null)
    if (!roleCache.has(ref.id)) roleCache.set(ref.id, call.roleOf(ref))
    return roleCache.get(ref.id)!
  }
  async function load(id: string): Promise<Row | null> {
    if (!rows.has(id)) rows.set(id, (await raw.get(id as never)) as Row | null)
    return rows.get(id)!
  }

  function ruleOf(table: string): Rule {
    if (libraryTableNames.has(table))
      throw new Error(
        `The ${table} table belongs to the library; app handlers do not read or write it.`,
      )
    const rule = rules[table]
    if (!rule) throw new Error(`The ${table} table has no row rule.`)
    return rule
  }

  async function insideCall(ref: TenantRef) {
    if (call.tenant === undefined) return true
    return (await chain(load, raw, ref)).some((t) => t.id === call.tenant!.id)
  }

  /** May this call place a tenant under this parent? Inside the call, with a role there that allows the action. */
  async function underParent(value: unknown): Promise<Verdict> {
    const parent = refOf(raw, value)
    if (!parent || !(await insideCall(parent))) return 'hidden'
    const role = await roleIn(parent)
    if (role === null) return 'hidden'
    return call.allows(role, call.action) ? 'ok' : 'denied'
  }

  async function judgeRule(
    rule: Rule,
    table: string,
    row: Row,
    mode: 'read' | 'write' | 'insert',
  ): Promise<Verdict> {
    switch (rule.kind) {
      case 'unchecked':
        return 'ok'
      case 'owner':
        return actor.kind !== 'visitor' && row[rule.field] === actor.user._id ? 'ok' : 'hidden'
      case 'publicRead': {
        const visible = !rule.where || rule.where(row as never)
        if (!visible) return 'hidden'
        return mode === 'read' ? 'ok' : 'denied'
      }
      case 'custom': {
        const ctx: RuleCtx = {
          actor,
          action: call.action,
          mode: mode === 'read' ? 'read' : 'write',
          tenant: call.tenant,
          db: raw,
          roleIn,
          allows: async (ref) => {
            const role = await roleIn(ref)
            return role !== null && call.allows(role, call.action)
          },
        }
        return (await rule.check(ctx, row)) ? 'ok' : 'hidden'
      }
      case 'anyOf': {
        const verdicts = []
        for (const member of rule.rules) {
          const verdict = await judgeRule(member, table, row, mode)
          if (verdict === 'ok') return 'ok'
          verdicts.push(verdict)
        }
        return verdicts.includes('denied') ? 'denied' : 'hidden'
      }
      case 'allOf': {
        // Every part runs, so a part that hides the row wins over one that refuses it.
        let verdict: Verdict = 'ok'
        for (const member of rule.rules) {
          const part = await judgeRule(member, table, row, mode)
          if (part === 'hidden') return 'hidden'
          if (part === 'denied') verdict = 'denied'
        }
        return verdict
      }
      case 'tenant': {
        if (rule.field === '_id' && mode === 'insert') {
          // A new tenant has no ID and no members yet: only the action the rule names may create one,
          // under a parent where the actor's role allows it.
          if (rule.createdBy !== call.action) return 'denied'
          return rule.parent ? underParent(row[rule.parent]) : 'ok'
        }
        const value = rule.field === '_id' ? row._id : row[rule.field]
        const ref = rule.field === '_id' ? { table, id: String(value) } : refOf(raw, value)
        if (!ref) return 'hidden'
        if (!(await insideCall(ref))) return 'hidden'
        const role = await roleIn(ref)
        if (role === null) return 'hidden'
        return call.allows(role, call.action) ? 'ok' : 'denied'
      }
    }
  }

  const judge = (table: string, row: Row, mode: 'read' | 'write' | 'insert') =>
    judgeRule(ruleOf(table), table, row, mode)
  call.expose?.({
    forget: () => {
      roleCache.clear()
      rows.clear()
    },
    mayWrite: async (table, row) => (await judge(table, row, 'write')) === 'ok',
  })

  function tableOf(id: string): string {
    for (const table of [...Object.keys(rules), ...libraryTableNames]) {
      if (raw.normalizeId(table, id) !== null) return table
    }
    throw new Error('This ID belongs to no known table.')
  }

  async function readable(table: string, row: Row | null) {
    return row !== null && (await judge(table, row, 'read')) === 'ok' ? row : null
  }

  async function assertReadable(table: string, row: unknown) {
    if (row === null || typeof row !== 'object') return
    const doc = row as Row
    if ((await judge(table, doc, 'read')) !== 'ok') {
      // Rows are checked, not filtered: a skipped row would make pages short and counts wrong without a sign.
      throw new Error(
        `A query on ${table} returned a row this call may not read. Narrow the query by an index on what the table's rule checks: ` +
          'the tenant or owner field, or the publicRead condition.',
      )
    }
    rows.set(String(doc._id), doc)
  }

  async function assertWritable(table: string, row: Row, mode: 'write' | 'insert') {
    let verdict = await judge(table, row, mode)
    // A row the actor may read exists for them: say they may not do this, not that it is missing (marketplace slice).
    if (verdict === 'hidden' && mode === 'write' && (await judge(table, row, 'read')) === 'ok')
      verdict = 'denied'
    if (verdict === 'hidden') fail('NOT_FOUND', `No ${table} with this ID.`)
    if (verdict === 'denied') fail('FORBIDDEN', `You may not ${call.action} here.`)
  }

  /** `(table, id, ...)` or `(id, ...)`, as Convex accepts both. A table-qualified ID must belong to that table. */
  function target(args: unknown[], qualified: boolean): { table: string; id: string } | null {
    if (!qualified) return { table: tableOf(args[0] as string), id: args[0] as string }
    const table = args[0] as string
    ruleOf(table)
    return raw.normalizeId(table, args[1] as string) === null
      ? null
      : { table, id: args[1] as string }
  }

  /**
   * A write that moves a tenant under another parent is checked like a new
   * tenant there: the role in the tenant itself says nothing about the new
   * parent (agency → client).
   */
  async function assertParent(table: string, before: Row, after: Row) {
    const field = tenantTables.get(table)
    if (!field || after[field] === before[field]) return
    const verdict = await underParent(after[field])
    if (verdict === 'hidden') fail('NOT_FOUND', 'Nothing with these IDs was found.')
    if (verdict === 'denied') fail('FORBIDDEN', `You may not ${call.action} here.`)
  }

  async function existing(args: unknown[], qualified: boolean) {
    const found = target(args, qualified)
    if (!found) fail('NOT_FOUND', `No ${args[0]} with this ID.`)
    const { table, id } = found
    const row = await load(id)
    if (!row) fail('NOT_FOUND', `No ${table} with this ID.`)
    await assertWritable(table, row, 'write')
    return { table, id, row, value: args[args.length - 1] as Row }
  }

  const db = {
    normalizeId: raw.normalizeId.bind(raw),
    get system(): never {
      // Scheduled-function arguments and file metadata belong to every user at once.
      throw new Error(
        'System tables are not available to operations that act for a person or an agent.',
      )
    },
    async get(...args: unknown[]) {
      const found = target(args, args.length === 2)
      return found && readable(found.table, await load(found.id))
    },
    query(table: string) {
      ruleOf(table)
      return guardQuery(raw.query(table), (row) => assertReadable(table, row))
    },
    async insert(table: string, value: Row) {
      await assertWritable(table, value, 'insert')
      wrote()
      return raw.insert(table, value as never)
    },
    async patch(...args: unknown[]) {
      const { table, id, row, value } = await existing(args, args.length === 3)
      const next = { ...row, ...value }
      // As in Convex, a field patched to `undefined` is removed.
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      for (const [key, field] of Object.entries(value)) if (field === undefined) delete next[key]
      await assertWritable(table, next, 'write')
      await assertParent(table, row, next)
      wrote(id)
      return (raw.patch as (...a: unknown[]) => Promise<void>)(...args)
    },
    async replace(...args: unknown[]) {
      const { table, id, row, value } = await existing(args, args.length === 3)
      const next = { ...value, _id: row._id }
      await assertWritable(table, next, 'write')
      await assertParent(table, row, next)
      wrote(id)
      return (raw.replace as (...a: unknown[]) => Promise<void>)(...args)
    },
    async delete(...args: unknown[]) {
      const { id } = await existing(args, args.length === 2)
      wrote(id)
      return (raw.delete as (...a: unknown[]) => Promise<void>)(...args)
    },
  }
  return db as unknown as DB
}

/** Query methods that return another query. */
const chainable = new Set(['fullTableScan', 'withIndex', 'withSearchIndex', 'order', 'filter'])

/**
 * Wraps a Convex query so every row it hands out passes `check`, however it is
 * read. Only the methods named here exist; a new Convex method throws until
 * it is added, so it cannot hand out unchecked rows.
 */
function guardQuery(query: any, check: (row: unknown) => Promise<void>): any {
  const rowsOf = async <T>(rows: T[]) => {
    for (const row of rows) await check(row)
    return rows
  }
  const methods: Record<PropertyKey, unknown> = {
    collect: async () => rowsOf(await query.collect()),
    take: async (n: number) => rowsOf(await query.take(n)),
    first: async () => {
      const row = await query.first()
      await check(row)
      return row
    },
    // Convex's own unique() error lists the matching IDs, foreign ones included.
    unique: async () => {
      const rows = await rowsOf(await query.take(2))
      if (rows.length > 1) throw new Error('unique() found more than one row.')
      return rows[0] ?? null
    },
    paginate: async (options: unknown) => {
      const result = await query.paginate(options)
      await rowsOf(result.page)
      return result
    },
    next: async () => {
      const step = await query.next()
      if (!step.done) await check(step.value)
      return step
    },
    return: async () => query.return(),
    [Symbol.asyncIterator]: () => guardQuery(query[Symbol.asyncIterator](), check),
  }
  for (const name of chainable)
    methods[name] = (...args: unknown[]) => guardQuery(query[name](...args), check)
  return new Proxy(
    {},
    {
      get(_, prop) {
        if (prop in methods) return methods[prop]
        if (prop === 'then') return undefined
        throw new Error(
          `ctx.db queries do not support ${String(prop)} yet: the library cannot check its rows.`,
        )
      },
    },
  )
}
