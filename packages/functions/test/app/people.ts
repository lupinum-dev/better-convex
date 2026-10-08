import type { Auth } from '@lupinum/better-convex-functions'
import type { GenericDataModel } from 'convex/server'

/**
 * The auth component for this package's fixtures: a person is the test identity's subject.
 * Agent calls, and the fake that serves them, belong to `@lupinum/better-convex-agents/test`.
 */
export function people<DM extends GenericDataModel>(): Auth<DM> {
  return {
    getUser: async (ctx) => {
      const identity = await ctx.auth.getUserIdentity()
      return identity ? { id: identity.subject } : null
    },
    requireMcpPrincipal: async () => {
      throw new Error(
        'The functions fixtures have no agents. Test agent calls in the agents package.',
      )
    },
  }
}
