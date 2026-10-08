/**
 * Helpers for an app's own tests (`@lupinum/better-convex-functions/test`). They run in
 * tests only, never in a deployment.
 *
 * convex-test finds the functions root by a `_generated` folder next to the
 * modules. A fixture without codegen needs one anyway, with any file in it
 * (for example `_generated/README.ts` with `export {}`).
 */
import type { SchemaDefinition } from 'convex/server'

import { erasureOf } from './functions'
import { OPERATION, HOUSEKEEPING, ERASURE_STEP, scanModules, unguardedFunctions } from './guard'
import { limitOf, type Policy } from './policy'
import { libraryTables } from './schema'

export { unguardedFunctions }

type Syscall = (op: string, json: string) => Promise<string>
type Count = { reads: number; writes: number }

let counting: Count | null = null

/**
 * Documents one call reads and writes, counted where Convex counts them: at
 * the database syscalls, so the library's own lookups (user, role, approval
 * rows) and nested calls count too. For budget tests in convex-test:
 * `expect(await countDocuments(() => t.query(api.x.list, args))).toEqual({ reads: 4, writes: 0 })`.
 *
 * It follows convex-test's metrics: a patch, replace or delete also reads its
 * row; a query counts the rows it returns, not the rows a `.filter()` skipped
 * (a deployment counts those too). Do not run calls in parallel while counting.
 */
export async function countDocuments(call: () => Promise<unknown>): Promise<Count> {
  meter()
  const count = { reads: 0, writes: 0 }
  counting = count
  try {
    await call()
  } finally {
    counting = null
  }
  return count
}

/** Wraps convex-test's syscall shim once; it counts only while `countDocuments` runs. */
function meter() {
  const g = globalThis as {
    Convex?: { syscall: unknown; jsSyscall: unknown; asyncSyscall: Syscall }
    __countDocuments?: true
  }
  if (g.__countDocuments) return
  if (!g.Convex)
    throw new Error('countDocuments needs convex-test: create the test with convexTest() first.')
  g.__countDocuments = true
  const inner = g.Convex
  g.Convex = {
    get syscall() {
      return inner.syscall
    },
    get jsSyscall() {
      return inner.jsSyscall
    },
    get asyncSyscall() {
      const asyncSyscall = inner.asyncSyscall
      return async (op: string, json: string) => {
        const out = await asyncSyscall(op, json)
        if (counting) tally(counting, op, out)
        return out
      }
    },
  }
}

function tally(count: Count, op: string, out: string) {
  switch (op) {
    case '1.0/get':
      if (JSON.parse(out) !== null) count.reads++
      return
    case '1.0/queryStreamNext': {
      const { done, value } = JSON.parse(out) as { done: boolean; value: unknown }
      if (!done && value !== null) count.reads++
      return
    }
    case '1.0/queryPage':
      count.reads += (JSON.parse(out) as { page: unknown[] }).page.length
      return
    case '1.0/insert':
      count.writes++
      return
    case '1.0/shallowMerge':
    case '1.0/replace':
    case '1.0/remove':
      count.reads++
      count.writes++
      return
  }
}

/**
 * The mistakes that hurt most after launch, found before it: returns one plain
 * sentence for each, or an empty list. Run it as a test:
 * `expect(await launchProblems({ modules, schema, crons, fns })).toEqual([])`.
 *
 * It checks four things and nothing else:
 * 1. a function built with Convex's own builders (see `unguardedFunctions`;
 *    `trustedRoutes` is passed on);
 * 2. a user ID (`v.id('users')`, nested, optional or a record key) in a table
 *    whose `erasure` entries do not cover its field, or no module exporting
 *    `fns.erasure.eraseStep`, so deleting an account would leave the data behind;
 * 3. the agents housekeeping function with no cron that calls it;
 * 4. a public mutation of a public action with no entry in `limits`.
 *
 * `crons` is the default export of `convex/crons.ts`. `fns` is the result of
 * `defineFunctions`. The escape hatches are the ones that exist already:
 * `trusted(reason, fn)`, `erasure: { table: { keep: reason } }` and a limit.
 */
export async function launchProblems(options: {
  modules: Record<string, () => Promise<unknown>>
  schema: SchemaDefinition<any, boolean>
  crons: unknown
  fns: { policy: Policy }
  trustedRoutes?: Record<string, string>
}): Promise<string[]> {
  const { modules, schema, crons, fns, trustedRoutes } = options
  const problems: string[] = []

  // 1. Raw functions.
  for (const id of await unguardedFunctions(modules, { trustedRoutes })) {
    problems.push(
      `${id} is built with Convex's own builders, so it skips the policy and the row rules. Build it with fns.query, fns.mutation or fns.internalMutation, or mark it trusted('why', fn).`,
    )
  }

  // 2. Every user ID a table holds must be covered by its erasure entries.
  const erasure = erasureOf(fns)
  const holders = Object.entries(schema.tables as Record<string, { validator: unknown }>)
    .filter(([table]) => table !== 'users' && !Object.hasOwn(libraryTables, table))
    .map(([table, { validator }]) => [table, userIdFields(validator, '')] as const)
    .filter(([, fields]) => fields.length > 0)
  const scan = await scanModules(modules, { trustedRoutes }, 'launchProblems')
  if (!erasure) {
    if (holders.length > 0)
      problems.push(
        `Account deletion is not set up: add \`erasure\` and \`schema\` to defineFunctions, with an entry for ${holders.map(([table]) => table).join(', ')}. Each table holds a user ID, so it would stay behind when a person deletes their account.`,
      )
  } else {
    for (const [table, fields] of holders) {
      const entries: Record<string, unknown>[] = [
        Object.hasOwn(erasure, table) ? erasure[table]! : [],
      ].flat() as never
      if (entries.some((entry) => 'keep' in entry)) continue
      const covered = new Set(entries.flatMap((entry) => [entry.delete, entry.anonymize]))
      for (const field of fields) {
        const top = field.split(/[.[{]/)[0]!
        // Only a field that holds the ID itself can be erased; delete or anonymize on the field
        // that holds a list, object or record of IDs finds no row.
        if (field === top && covered.has(top)) continue
        problems.push(
          field === top
            ? `The table ${table} holds a user ID in ${field} but erasure does not cover it. Add { delete: '${field}' }, { anonymize: '${field}' } or { keep: 'why the rows stay' } to the ${table} entry of erasure in defineFunctions (an array holds one entry per field).`
            : `The table ${table} holds a user ID inside ${field}, which erasure cannot reach. Store the ID in its own indexed field, or add { keep: 'why the rows stay' } to the ${table} entry of erasure in defineFunctions.`,
        )
      }
    }
    if (
      !scan.exports.some(
        ({ value }) => (value as { [ERASURE_STEP]?: unknown } | null)?.[ERASURE_STEP],
      )
    )
      problems.push(
        'Account deletion is set up but no module exports fns.erasure.eraseStep: add `export const { eraseStep } = fns.erasure` in convex/erasure.ts.',
      )
  }

  // 3. The agents housekeeping function needs a cron.
  const registered = (crons as { crons?: Record<string, { name?: unknown }> } | null)?.crons
  if (!registered || typeof registered !== 'object')
    throw new Error('launchProblems needs crons: pass the default export of convex/crons.ts.')
  const called = new Set(Object.values(registered).map((job) => job.name))
  for (const { path, name, functionName, value } of scan.exports) {
    if (!(value as { [HOUSEKEEPING]?: unknown } | null)?.[HOUSEKEEPING]) continue
    if (!called.has(functionName))
      problems.push(
        `${path} exports ${name}, which expires agent requests and deletes old activity, but no cron calls it. Add crons.hourly('agent housekeeping', { minuteUTC: 7 }, internal.${functionName.replace(':', '.')}, {}) to convex/crons.ts.`,
      )
  }

  // 4. Public mutations need a limit.
  const open = new Set((fns.policy.public as readonly string[] | undefined) ?? [])
  const seen = new Set<string>()
  for (const [id, fn] of scan.functions) {
    const op = fn[OPERATION]
    if (!op || op.kind !== 'mutation' || !fn.isPublic) continue
    if (!open.has(op.action) || limitOf(fns.policy, op.action) || seen.has(op.action)) continue
    seen.add(op.action)
    problems.push(
      `${id} is a public mutation (action ${op.action}) with no limit, so one visitor can fill your database. Add limits: { '${op.action}': { max: 60, every: 'minute', per: 'everyone' } } to definePolicy.`,
    )
  }
  return problems
}

/** Paths of the fields in a validator that hold `v.id('users')`, however deeply nested. */
function userIdFields(validator: unknown, path: string): string[] {
  const node = validator as {
    kind?: string
    tableName?: string
    fields?: Record<string, unknown>
    element?: unknown
    key?: unknown
    value?: unknown
    members?: unknown[]
  } | null
  switch (node?.kind) {
    case 'id':
      return node.tableName === 'users' ? [path || '(the whole document)'] : []
    case 'object':
      return Object.entries(node.fields ?? {}).flatMap(([field, child]) =>
        userIdFields(child, path ? `${path}.${field}` : field),
      )
    case 'array':
      return userIdFields(node.element, `${path}[]`)
    case 'record':
      // `{}` marks a user ID as a key of the record, `[]` one as a value.
      return [...userIdFields(node.key, `${path}{}`), ...userIdFields(node.value, `${path}[]`)]
    case 'union':
      return (node.members ?? []).flatMap((member) => userIdFields(member, path))
    default:
      return []
  }
}
