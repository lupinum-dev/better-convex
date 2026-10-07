import betterAuth, { grantMcp, signInAs } from '@lupinum/better-convex-nuxt/better-auth/test'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'

import { mcpClient, tokenFor } from '../support'
import schema from './schema'

export const modules = import.meta.glob('./**/*.ts')
export const fn = (path: string) => makeFunctionReference<any>(path)

/** Ann owns org A, with one project. Bob is in no organization. */
export async function setup() {
  const t = convexTest(schema, modules)
  betterAuth.register(t)
  const ids = await t.run(async (ctx) => {
    const ann = await ctx.db.insert('users', { authId: 'ann', name: 'ann' })
    await ctx.db.insert('users', { authId: 'bob', name: 'bob' })
    const a = await ctx.db.insert('orgs', { name: 'A' })
    await ctx.db.insert('memberships', { orgId: a, userId: ann, role: 'owner' })
    const pa = await ctx.db.insert('projects', { orgId: a, name: 'A one', status: 'active' })
    return { a, pa }
  })

  const client = mcpClient(t)
  const tokens = new Map<string, string>()
  /**
   * `who` is `<authId>:<scope>,<scope>`: on first use that person connects the host `test-host`
   * with these scopes (a real grant, through `grantMcp`). The request carries the access token,
   * which the host keeps, as a real host does after a revoke.
   */
  const mcp = async (who: string, method: string, params?: Record<string, unknown>) => {
    if (!tokens.has(who)) {
      const [authId = '', scopes = ''] = who.split(':')
      tokens.set(who, tokenFor(await grantMcp(t, authId, scopes.split(','))))
    }
    return client.mcp(tokens.get(who)!, method, params)
  }
  /** The whole JSON-RPC response of a tool call. */
  const call = (who: string, name: string, args: Record<string, unknown>) =>
    mcp(who, 'tools/call', { name, arguments: args })
  return { t, ...ids, ann: await signInAs(t, 'ann'), bob: await signInAs(t, 'bob'), mcp, call }
}
