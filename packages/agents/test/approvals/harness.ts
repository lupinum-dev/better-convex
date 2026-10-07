import { callTool } from '@lupinum/better-convex-agents/test'
import betterAuth, { grantMcp, signInAs } from '@lupinum/better-convex-nuxt/better-auth/test'
import { convexTest } from 'convex-test'
import { anyApi } from 'convex/server'
import { getConvexSize, jsonToConvex, type Value } from 'convex/values'

import schema from './schema'
import { tools } from './tools'

// convex-test has no per-document size limit; Convex rejects a write that makes
// a document larger than 1 MiB, and the write does not happen. This adds that
// one platform limit at the same point (the write syscall, so the writing
// function can catch it). Nothing else is faked.
const MiB = 1 << 20

type Syscall = (op: string, json: string) => Promise<string>

function withDocumentLimit() {
  const g = globalThis as {
    Convex?: { syscall: unknown; jsSyscall: unknown; asyncSyscall: Syscall }
    __docLimit?: true
  }
  if (g.__docLimit) return
  g.__docLimit = true
  const inner = g.Convex!
  async function sizeAfter(
    asyncSyscall: Syscall,
    op: string,
    args: { table: string; id?: string; value: Record<string, unknown> },
  ) {
    if (op === '1.0/insert') return getConvexSize(jsonToConvex(args.value as never)) + 60 // _id and _creationTime
    const doc = jsonToConvex(
      JSON.parse(await asyncSyscall('1.0/get', JSON.stringify({ table: args.table, id: args.id }))),
    ) as Record<string, Value>
    if (op === '1.0/replace')
      return getConvexSize({
        ...(jsonToConvex(args.value as never) as object),
        _id: doc._id,
        _creationTime: doc._creationTime,
      })
    // A patch field set to `undefined` (`{ $undefined: null }`) removes it.
    const removed = (value: unknown) =>
      !!value && typeof value === 'object' && '$undefined' in value
    const patch = Object.entries(args.value)
    const merged = Object.fromEntries([
      ...Object.entries(doc).filter(([key]) => !patch.some(([field]) => field === key)),
      ...patch
        .filter(([, value]) => !removed(value))
        .map(([key, value]) => [key, jsonToConvex(value as never)]),
    ]) as Record<string, Value>
    return getConvexSize(merged)
  }
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
        if (op === '1.0/insert' || op === '1.0/shallowMerge' || op === '1.0/replace') {
          const size = await sizeAfter(asyncSyscall, op, JSON.parse(json))
          if (size > MiB)
            throw new Error(
              `Document is too large (${size} bytes, limit ${MiB}). [test: Convex document limit]`,
            )
        }
        return asyncSyscall(op, json)
      }
    },
  }
}

export const modules = import.meta.glob('./**/*.ts')
export const api = anyApi as any

/** Long enough for every test's clock: sessions and Ann's MCP token outlive the fake time. */
const week = 7 * 86_400_000

/** Org A: Ann and Olga own it, Vic views it. Five projects. Ann connected a host with both scopes. */
export async function setup() {
  const t = convexTest(schema, modules)
  betterAuth.register(t)
  withDocumentLimit()
  const ids = await t.run(async (ctx) => {
    const [ann, olga, vic] = await Promise.all(
      ['ann', 'olga', 'vic'].map((authId) => ctx.db.insert('users', { authId, active: true })),
    )
    const a = await ctx.db.insert('orgs', { name: 'A' })
    await ctx.db.insert('memberships', { orgId: a, userId: ann!, role: 'owner' })
    await ctx.db.insert('memberships', { orgId: a, userId: olga!, role: 'owner' })
    await ctx.db.insert('memberships', { orgId: a, userId: vic!, role: 'viewer' })
    const projects = []
    for (const name of ['alpha', 'beta', 'gamma', 'delta', 'epsilon']) {
      projects.push(await ctx.db.insert('projects', { orgId: a, name, status: 'active' }))
    }
    return { annId: ann!, a, p: projects }
  })
  const as = (authId: string) => signInAs(t, authId, { expiresInMs: week })
  const [ann, olga, vic] = [await as('ann'), await as('olga'), await as('vic')]
  // The recipe for a token that outlives the test's clock: grantMcp reuses Ann's week-long session.
  const principal = {
    ...(await grantMcp(t, 'ann', ['projects:read', 'projects:write'])),
    expiresAt: Math.floor((Date.now() + week) / 1000),
  }
  /** Ann's MCP connection, as the door hands it to a tool function. */
  const caller = { door: 'mcp', principal }
  /** A tool call as Ann's host makes it through the door. */
  const tool = (name: string, input: Record<string, unknown>, as = principal) =>
    callTool(t, tools, as, name, input)
  /** A tool call that must wait for a person. */
  const ask = async (name: string, input: Record<string, unknown>, as = principal) => {
    const asked = await tool(name, input, as)
    if (asked.status !== 'needs_approval') throw new Error(`${name} ran without asking a person`)
    return asked
  }
  const approvalRows = () => t.run((ctx) => ctx.db.query('approvals').collect())
  return { t, as, ann, olga, vic, ...ids, caller, principal, tool, ask, approvalRows }
}
