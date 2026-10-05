/**
 * When the browser runtime (Convex WebSocket client, and the Better Auth
 * client in auth builds) starts.
 *
 * - `'eager'`: at app start, on every page.
 * - `'on-demand'`: only after `useConvexActivation().activate()`, or when the
 *   route middleware reaches a page that needs authentication. Until then the
 *   browser downloads and runs none of it.
 */
export type ConvexClientConnect = 'eager' | 'on-demand'

const CONNECT_MODES: readonly ConvexClientConnect[] = ['eager', 'on-demand']

/** Validate the build-time `convex.client.connect` option. */
export function normalizeConvexClientConnect(input: unknown): ConvexClientConnect {
  if (input === undefined) return 'eager'
  if (!(CONNECT_MODES as readonly unknown[]).includes(input)) {
    throw new TypeError(`[better-convex-nuxt] client.connect must be 'eager' or 'on-demand'`)
  }
  return input as ConvexClientConnect
}
