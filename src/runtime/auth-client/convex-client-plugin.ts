import type { BetterAuthClientPlugin } from 'better-auth/client'

interface ConvexTokenActionOptions {
  fetchOptions?: Record<string, unknown>
}

interface ConvexClientPluginOptions {
  /**
   * Observes the route path of every request the Better Auth client starts,
   * before it is sent. Session reconciliation uses it because Better Auth's
   * `$sessionSignal` does not cover every session-changing endpoint.
   */
  observeRequest?: (routePath: string) => void
}

/**
 * Internal Better Auth client action for the fixed Convex session-token route.
 * Consumers cannot supply or replace this plugin.
 */
export function convexClientPlugin(options: ConvexClientPluginOptions = {}) {
  const observeRequest = options.observeRequest
  return {
    id: 'convex',
    pathMethods: { '/convex/token': 'GET' },
    fetchPlugins: observeRequest
      ? [
          {
            id: 'better-convex-session-requests',
            name: 'better-convex-session-requests',
            init(url: string, requestOptions?: Record<string, unknown>) {
              observeRequest(url)
              return { url, options: requestOptions }
            },
          },
        ]
      : undefined,
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
