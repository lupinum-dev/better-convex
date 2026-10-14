import { resolveServerAuthSnapshot, type ServerAuthSnapshot } from './auth-snapshot'
import type { ConvexServerEvent } from './event'

export interface RequestAuthSnapshotInput {
  siteUrl: string
  /** The normalized public application origin (`auth.origin`). */
  publicOrigin: string
  trustedClientIpHeader: string
  cookieHeader: string | null
  /** Correlates the devtools waterfall; generated when omitted. */
  requestId?: string
  /** Record the devtools auth waterfall; defaults to development builds. */
  trackWaterfall?: boolean
}

// Keyed by the request's `event.context`, so an entry lives exactly as long as
// its request and is invisible to handler code (nothing is stored on the
// context). The context, not the event, is the key: one request can reach us
// as several event objects (Nuxt 4.6 wraps the raw h3 event in a portable
// Proxy for `nuxt/server` handlers while SSR keeps the raw event; Nuxt 5 gives
// SSR a new event), and they all share one `context`.
const requestSnapshots = new WeakMap<object, Promise<ServerAuthSnapshot>>()

/**
 * The request's one auth snapshot. SSR hydration, the Nitro user helpers, and
 * the cookie path of `serverConvex` share it, so a request performs at most one
 * Better Auth cookie -> Convex JWT exchange and every consumer sees the same
 * identity. The first caller's input wins; every caller reads the same request,
 * so its cookie and config are identical.
 */
export function resolveRequestAuthSnapshot(
  event: ConvexServerEvent,
  input: RequestAuthSnapshotInput,
): Promise<ServerAuthSnapshot> {
  let snapshot = requestSnapshots.get(event.context)
  if (!snapshot) {
    snapshot = resolveServerAuthSnapshot({
      event,
      siteUrl: input.siteUrl,
      publicOrigin: input.publicOrigin,
      cookieHeader: input.cookieHeader,
      requestId: input.requestId ?? crypto.randomUUID(),
      trackWaterfall: input.trackWaterfall ?? Boolean(import.meta.dev),
      trustedClientIpHeader: input.trustedClientIpHeader,
    })
    requestSnapshots.set(event.context, snapshot)
  }
  return snapshot
}
