import { mcpClient } from '@lupinum/better-convex-agents/test'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'

import { testing } from './fns'
import schema from './schema'

export const modules = import.meta.glob('./**/*.ts')
export const fn = (path: string) => makeFunctionReference<any>(path)

/** Ann owns org A, Vic views A, Bob owns B. Each org has one project. */
export async function setup() {
  testing.reset()
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const [ann, vic, bob] = await Promise.all(
      ['ann', 'vic', 'bob'].map((authId) => ctx.db.insert('users', { authId, name: authId })),
    )
    const a = await ctx.db.insert('orgs', { name: 'A' })
    const b = await ctx.db.insert('orgs', { name: 'B' })
    await ctx.db.insert('memberships', { orgId: a, userId: ann!, role: 'owner' })
    await ctx.db.insert('memberships', { orgId: a, userId: vic!, role: 'viewer' })
    await ctx.db.insert('memberships', { orgId: b, userId: bob!, role: 'owner' })
    const pa = await ctx.db.insert('projects', { orgId: a, name: 'A one', status: 'active' })
    const pb = await ctx.db.insert('projects', { orgId: b, name: 'B one', status: 'active' })
    return { users: { ann: ann!, vic: vic!, bob: bob! }, a, b, pa, pb }
  })
  const as = (authId: string) => t.withIdentity({ subject: authId })

  const { mcp } = mcpClient(t)
  /** The whole JSON-RPC response of a tool call. */
  const call = (token: string, name: string, args: Record<string, unknown>) =>
    mcp(token, 'tools/call', { name, arguments: args })
  return { t, ...ids, ann: as('ann'), vic: as('vic'), bob: as('bob'), mcp, call }
}
