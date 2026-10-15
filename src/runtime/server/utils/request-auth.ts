import { filterBetterAuthCookies } from '../../utils/shared-helpers'
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
//
// An entry also records the filtered Better Auth cookie it was resolved for.
// Nitro 2's route cache re-renders on a new event that shares the request's
// `context` but has lost the Cookie header; that caller must not inherit a
// signed-in snapshot, so a different cookie resolves its own (uncached) one.
const requestSnapshots = new WeakMap<
  object,
  { cookie: string | null; snapshot: Promise<ServerAuthSnapshot> }
>()

/**
 * The request's one auth snapshot. SSR hydration, the Nitro user helpers, and
 * the cookie path of `serverConvex` share it, so a request performs at most one
 * Better Auth cookie -> Convex JWT exchange and every consumer sees the same
 * identity. The first caller's snapshot is reused only by callers whose
 * filtered Better Auth cookie is identical; a caller with a different cookie
 * (a route-cached render that lost the Cookie header) gets its own snapshot
 * and leaves the cached one untouched.
 */
export function resolveRequestAuthSnapshot(
  event: ConvexServerEvent,
  input: RequestAuthSnapshotInput,
): Promise<ServerAuthSnapshot> {
  const cookie = filterBetterAuthCookies(input.cookieHeader)
  const cached = requestSnapshots.get(event.context)
  if (cached && cached.cookie === cookie) return cached.snapshot
  const snapshot = resolveServerAuthSnapshot({
    event,
    siteUrl: input.siteUrl,
    publicOrigin: input.publicOrigin,
    cookieHeader: input.cookieHeader,
    requestId: input.requestId ?? crypto.randomUUID(),
    trackWaterfall: input.trackWaterfall ?? Boolean(import.meta.dev),
    trustedClientIpHeader: input.trustedClientIpHeader,
  })
  if (!cached) requestSnapshots.set(event.context, { cookie, snapshot })
  return snapshot
}
