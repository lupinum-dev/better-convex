/**
 * Helpers for an app's own tests (`@lupinum/better-convex-functions/test`). They run in
 * tests only, never in a deployment.
 *
 * convex-test finds the functions root by a `_generated` folder next to the
 * modules. A fixture without codegen needs one anyway, with any file in it
 * (for example `_generated/README.ts` with `export {}`).
 */
import type { GenericDataModel, GenericQueryCtx } from 'convex/server'
import { ConvexError } from 'convex/values'

import type { Auth } from './functions'

export { unguardedFunctions } from './guard'

/**
 * The auth component faked for convex-test (asked for by the agency, content
 * and marketplace slices, which each copied it). A person is
 * `t.withIdentity({ subject: authId })`; an agent's connection is accepted
 * until `revoke` ends it, like the real component, which checks the
 * connection on every agent call.
 *
 * Create it in the module that calls `defineFunctions`, with the app's data
 * model, and call `reset()` when each test starts, since modules outlive it.
 */
export function testAuth<DM extends GenericDataModel>() {
  const revoked = new Set<string>()
  const auth: Auth<DM> = {
    getUser: async (ctx: GenericQueryCtx<DM>) => {
      const identity = await ctx.auth.getUserIdentity()
      return identity ? { id: identity.subject } : null
    },
    requireMcpPrincipal: async (_ctx, principal) => {
      if (revoked.has(`${principal.userId}:${principal.clientId}`))
        throw new ConvexError({ code: 'MCP_ACCESS_DENIED', message: 'MCP access denied' })
      return { user: { id: principal.userId } }
    },
  }
  return {
    auth,
    /** Revokes a connection in the fake auth component. */
    revoke: (authId: string, clientId = 'host') => void revoked.add(`${authId}:${clientId}`),
    reset: () => revoked.clear(),
  }
}

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
