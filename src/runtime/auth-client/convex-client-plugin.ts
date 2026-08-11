import type { BetterAuthClientPlugin } from 'better-auth/client'

interface ConvexTokenActionOptions {
  fetchOptions?: Record<string, unknown>
}

/**
 * Internal Better Auth client action for the fixed Convex session-token route.
 * Consumers cannot supply or replace this plugin.
 */
export function convexClientPlugin() {
  return {
    id: 'convex',
    pathMethods: { '/convex/token': 'GET' },
    getActions: ($fetch) => ({
      convex: {
        token: async (options?: ConvexTokenActionOptions) =>
          await $fetch<{ token: string | null }>('/convex/token', {
            ...(options?.fetchOptions ?? {}),
            method: 'GET',
          }),
      },
    }),
  } satisfies BetterAuthClientPlugin
}
