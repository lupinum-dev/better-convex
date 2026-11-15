import betterAuth, { grantMcp, signInAs } from '@lupinum/better-convex-nuxt/better-auth/test'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import { vi } from 'vitest'

import { mcpClient, tokenFor } from '../support'
import schema from './schema'

export const modules = import.meta.glob('./**/*.ts')
export const fn = (path: string) => makeFunctionReference<any>(path)

const print = console.log.bind(console)

/** Ann owns org A, with one project. Bob is in no organization. */
export async function setup() {
  // The fixture turns `observe` on: its event lines go to `events`, not to the test output.
  const lines: Record<string, unknown>[] = []
  vi.spyOn(console, 'log').mockImplementation((line: unknown, ...rest: unknown[]) => {
    if (typeof line === 'string' && line.startsWith('{"type":"better-convex.call"'))
      lines.push(JSON.parse(line) as Record<string, unknown>)
    else print(line, ...rest)
  })
  /** The event lines written since the last call, parsed. */
  const events = () => lines.splice(0)
  const t = convexTest({ schema, modules, transactionLimits: true })
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
  const ann = await signInAs(t, 'ann')
  const bob = await signInAs(t, 'bob')
  events()
  return { t, ...ids, ann, bob, mcp, call, events }
}
