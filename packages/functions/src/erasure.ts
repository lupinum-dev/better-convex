import {
  getFunctionName,
  internalMutationGeneric,
  makeFunctionReference,
  type FunctionReference,
  type SchemaDefinition,
  type TableDefinition,
} from 'convex/server'
import { v } from 'convex/values'

import { readBudget, within, type Budget } from './budget'
import { guarded } from './guard'
import { libraryTables } from './schema'

/**
 * What happens to a table when a person is erased. Each entry names the field
 * that holds the person's app user ID (or says why the rows stay).
 */
export type ErasureEntry<Field extends string = string> =
  /** Delete the person's rows. */
  | { readonly delete: Field }
  /** Keep the rows, remove the field. It must be `v.optional(...)` in the schema. */
  | { readonly anonymize: Field }
  /** Leave the table alone, and say why. */
  | { readonly keep: string }

export type ErasureMap = Record<string, ErasureEntry>

/** The database as the plan uses it: untyped, because the plan works on any app's tables. */
interface Db {
  query(table: string): {
    withIndex(name: string, range: (q: any) => unknown): AsyncIterable<any>
  }
  delete(id: any): Promise<void>
  patch(id: any, value: Record<string, unknown>): Promise<void>
}
type AnySchema = SchemaDefinition<any, boolean>

/** One table of the plan: a step reads at most a budget of its rows and reports whether rows may remain. */
type Job = (db: Db, userId: string, budget: Budget) => Promise<boolean>

const libraryTableNames = new Set(Object.keys(libraryTables))
const entryKinds = ['delete', 'anonymize', 'keep'] as const

function definitionError(table: string, message: string): never {
  throw new Error(`Erasure for "${table}": ${message}`)
}

/** Checks the map against the schema and returns one job per table that is erased. */
function planApp(schema: AnySchema, map: ErasureMap): Job[] {
  const jobs: Job[] = []
  for (const [table, entry] of Object.entries(map)) {
    if (libraryTableNames.has(table))
      definitionError(table, 'the library erases its own tables; remove this entry.')
    const definition = schema.tables[table] as TableDefinition | undefined
    if (!definition) definitionError(table, 'the schema has no such table.')
    const kinds = entryKinds.filter((kind) => kind in (entry as object))
    if (kinds.length !== 1) definitionError(table, 'use exactly one of delete, anonymize or keep.')
    if ('keep' in entry) {
      if (typeof entry.keep !== 'string' || entry.keep.trim() === '')
        definitionError(table, 'keep needs a reason: a sentence that says why the rows stay.')
      continue
    }
    const kind = 'delete' in entry ? 'delete' : 'anonymize'
    const field = 'delete' in entry ? entry.delete : entry.anonymize
    const validator = definition.validator as unknown as {
      kind: string
      fields?: Record<string, { isOptional: string }>
    }
    if (validator.kind !== 'object' || !validator.fields)
      definitionError(table, 'only a table defined with an object can be erased.')
    const fieldValidator = validator.fields[field]
    if (!fieldValidator) definitionError(table, `the table has no field "${field}".`)
    if (kind === 'anonymize' && fieldValidator.isOptional !== 'optional')
      definitionError(
        table,
        `anonymize removes "${field}", so the schema must say v.optional(...) for it. Use delete to remove the rows instead.`,
      )
    const index = definition[' indexes']().find(({ fields }) => fields[0] === field)
    if (!index)
      definitionError(
        table,
        `add an index whose first field is "${field}", for example .index('by_${field}', ['${field}']).`,
      )
    jobs.push(async (db, userId, budget) => {
      const { rows, more } = await within(
        db.query(table).withIndex(index.indexDescriptor, (q) => q.eq(field, userId)),
        budget,
      )
      for (const row of rows) {
        if (kind === 'delete') await db.delete(row._id)
        else await db.patch(row._id, { [field]: undefined })
      }
      return more
    })
  }
  return jobs
}

/** The actor of a row without the person: the key names them too. */
function withoutPerson(actor: { key: string; userId?: string }) {
  const { userId: _userId, ...rest } = actor
  return { ...rest, key: 'erased' }
}

/**
 * The library's own tables, erased without app config. Only tables the app's
 * schema has. A person's rows go, except rows that hold other people's work:
 * those keep their row and lose the person's ID.
 */
function planLibrary(schema: AnySchema): Job[] {
  const has = (table: string) => table in schema.tables
  const jobs: Job[] = []
  // Grants first: an agent of the person stops acting before its runs are deleted.
  if (has('agentGrants'))
    jobs.push(async (db, userId, budget) => {
      const { rows, more } = await within(
        db.query('agentGrants').withIndex('by_user_agent', (q) => q.eq('userId', userId)),
        budget,
      )
      for (const row of rows) await db.delete(row._id)
      return more
    })
  if (has('approvals'))
    jobs.push(async (db, userId, budget) => {
      const { rows, more } = await within(
        db.query('approvals').withIndex('by_user_status', (q) => q.eq('requester.userId', userId)),
        budget,
      )
      for (const row of rows) {
        // A request nobody can decide any more is cancelled; a decided one keeps its row.
        await db.patch(row._id, {
          requester: withoutPerson(row.requester),
          ...(row.status === 'pending' ? { status: 'cancelled' } : {}),
        })
      }
      return more
    })
  if (has('agentRuns'))
    jobs.push(async (db, userId, budget) => {
      const { rows, more } = await within(
        db.query('agentRuns').withIndex('by_user_agent', (q) => q.eq('userId', userId)),
        budget,
      )
      let left = more
      for (const run of rows) {
        const messages = await within(
          db.query('agentMessages').withIndex('by_run', (q) => q.eq('runId', run._id)),
          budget,
        )
        for (const message of messages.rows) await db.delete(message._id)
        // The run goes with its last message, so a cut-short step finds it again.
        if (messages.more) left = true
        else await db.delete(run._id)
      }
      return left
    })
  for (const table of ['activity', 'auditLog'] as const)
    if (has(table))
      jobs.push(async (db, userId, budget) => {
        const { rows, more } = await within(
          db.query(table).withIndex('by_user', (q) => q.eq('actor.userId', userId)),
          budget,
        )
        for (const row of rows) await db.patch(row._id, { actor: withoutPerson(row.actor) })
        return more
      })
  if (has('rateLimits'))
    jobs.push(async (db, userId, budget) => {
      let left = false
      // A person's limit key starts with their actor key (`person:<id>|…`, `mcp:<id>:<client>|…`,
      // `app:<id>:<agent>|…`); tenant and everyone buckets start with neither.
      for (const prefix of [`person:${userId}|`, `mcp:${userId}:`, `app:${userId}:`]) {
        if (budget.spent) return true
        const { rows, more } = await within(
          db
            .query('rateLimits')
            .withIndex('by_key', (q) => q.gte('key', prefix).lt('key', `${prefix}￿`)),
          budget,
        )
        for (const row of rows) await db.delete(row._id)
        left ||= more
      }
      return left
    })
  return jobs
}

/**
 * Builds the erasure plan, throwing at definition time for a map the schema
 * cannot carry out. Returns the internal mutation the app exports and the call
 * that starts an erasure.
 */
export function defineErasure(schema: AnySchema | undefined, map: ErasureMap) {
  if (!schema)
    throw new Error(
      'Erasure needs the app schema: pass schema to defineFunctions, next to erasure.',
    )
  const jobs = [...planLibrary(schema), ...planApp(schema, map)]

  const eraseStep = guarded(
    internalMutationGeneric({
      args: { userId: v.string(), self: v.string() },
      handler: async (ctx, { userId, self }) => {
        const db = ctx.db as unknown as Db
        const budget = readBudget()
        let more = false
        for (const job of jobs) {
          if (budget.spent) {
            more = true
            break
          }
          if (await job(db, userId, budget)) more = true
        }
        // Rows that are gone are not found again, so the next step starts at the top.
        if (more)
          await ctx.scheduler.runAfter(0, makeFunctionReference<'mutation'>(self), { userId, self })
        return null
      },
    }),
  )

  /**
   * Starts the erasure of one person: schedules `eraseStep`, which works in
   * batches and schedules itself until done. Call it where the person's app
   * user row is deleted, with the app user's ID.
   */
  async function eraseUser(
    ctx: { scheduler: { runAfter: (delay: number, ref: never, args: never) => Promise<unknown> } },
    userId: string,
    step: FunctionReference<'mutation', 'internal', any>,
  ) {
    await ctx.scheduler.runAfter(0, step as never, { userId, self: getFunctionName(step) } as never)
  }

  return { eraseStep, eraseUser }
}
