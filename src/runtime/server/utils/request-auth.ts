import type { H3Event } from 'h3'

import { resolveServerAuthSnapshot, type ServerAuthSnapshot } from './auth-snapshot'

export interface RequestAuthSnapshotInput {
  siteUrl: string
  trustedClientIpHeader: string
  cookieHeader: string | null
  /** Correlates the devtools waterfall; generated when omitted. */
  requestId?: string
  /** Record the devtools auth waterfall; defaults to development builds. */
  trackWaterfall?: boolean
}

// Keyed by the request event, so an entry lives exactly as long as its request
// and is invisible to handler code (nothing is stored on `event.context`).
const requestSnapshots = new WeakMap<H3Event, Promise<ServerAuthSnapshot>>()

/**
 * The request's one auth snapshot. SSR hydration, the Nitro user helpers, and
 * the cookie path of `serverConvex` share it, so a request performs at most one
 * Better Auth cookie -> Convex JWT exchange and every consumer sees the same
 * identity. The first caller's input wins; every caller reads the same event,
 * so its cookie and config are identical.
 */
export function resolveRequestAuthSnapshot(
  event: H3Event,
  input: RequestAuthSnapshotInput,
): Promise<ServerAuthSnapshot> {
  let snapshot = requestSnapshots.get(event)
  if (!snapshot) {
    snapshot = resolveServerAuthSnapshot({
      event,
      siteUrl: input.siteUrl,
      cookieHeader: input.cookieHeader,
      requestId: input.requestId ?? crypto.randomUUID(),
      trackWaterfall: input.trackWaterfall ?? Boolean(import.meta.dev),
      trustedClientIpHeader: input.trustedClientIpHeader,
    })
    requestSnapshots.set(event, snapshot)
  }
  return snapshot
}
