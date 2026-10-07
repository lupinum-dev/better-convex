import { convexTest } from 'convex-test'
import { anyApi } from 'convex/server'
import { getConvexSize, jsonToConvex, type Value } from 'convex/values'

import schema from './schema'

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

/** Org A: Ann and Olga own it, Vic views it. Five projects. */
export async function setup() {
  const t = convexTest(schema, modules)
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
  const as = (authId: string) => t.withIdentity({ subject: authId })
  const approvalRows = () => t.run((ctx) => ctx.db.query('approvals').collect())
  return { t, ann: as('ann'), olga: as('olga'), vic: as('vic'), ...ids, approvalRows }
}

/** Ann's MCP connection with both scopes, as the door hands it to a tool function. */
export const caller = {
  door: 'mcp',
  principal: {
    kind: 'oauth',
    userId: 'ann',
    clientId: 'host',
    scopes: ['projects:read', 'projects:write'],
    sessionId: 's',
    grantId: 'g',
    issuer: 'i',
    resource: 'r',
    expiresAt: 4_102_444_800, // 2100: these tests are not about token expiry
  },
}
