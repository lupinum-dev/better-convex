import type { BetterAuthPlugin } from 'better-auth'
import { createAuthMiddleware } from 'better-auth/api'

/**
 * Identity guards that close account-takeover paths Better Auth leaves open
 * by default. The factory owns this plugin; options cannot turn it off.
 */
export function createIdentityGuardsPlugin(): BetterAuthPlugin {
  return {
    id: 'better-convex-identity-guards',
    hooks: {
      before: [
        {
          // A changed password must end every other session of that person.
          matcher: (context) => context.path === '/change-password',
          handler: createAuthMiddleware(async (context) => ({
            context: {
              ...context,
              body: { ...(context.body as object), revokeOtherSessions: true },
            },
          })),
        },
      ],
    },
  }
}
