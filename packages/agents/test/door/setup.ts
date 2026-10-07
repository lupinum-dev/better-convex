import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'

import { mcpClient } from '../support'
import { testing } from './fns'
import schema from './schema'

export const modules = import.meta.glob('./**/*.ts')
export const fn = (path: string) => makeFunctionReference<any>(path)

/** Ann owns org A, with one project. Bob is in no organization. */
export async function setup() {
  testing.reset()
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const ann = await ctx.db.insert('users', { authId: 'ann', name: 'ann' })
    await ctx.db.insert('users', { authId: 'bob', name: 'bob' })
    const a = await ctx.db.insert('orgs', { name: 'A' })
    await ctx.db.insert('memberships', { orgId: a, userId: ann, role: 'owner' })
    const pa = await ctx.db.insert('projects', { orgId: a, name: 'A one', status: 'active' })
    return { a, pa }
  })
  const as = (authId: string) => t.withIdentity({ subject: authId })

  const { mcp } = mcpClient(t)
  /** The whole JSON-RPC response of a tool call. */
  const call = (token: string, name: string, args: Record<string, unknown>) =>
    mcp(token, 'tools/call', { name, arguments: args })
  return { t, ...ids, ann: as('ann'), bob: as('bob'), mcp, call }
}
