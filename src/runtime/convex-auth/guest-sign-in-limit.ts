import { normalizeIP } from '@better-auth/core/utils/ip'
import type { BetterAuthPlugin } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'

import { VERIFIED_CLIENT_IP_HEADER } from '../shared/client-ip'

type ConsumeRateLimit = (
  key: string,
  rule: { window: number; max: number },
) => Promise<{ allowed: boolean; retryAfter: number | null }>

export interface GuestSignInLimit {
  /** Seconds. */
  readonly window: number
  readonly max: number
}

/** A bucket of ten new guests per client address, refilled one every 6 minutes. */
export const GUEST_SIGN_IN_LIMIT_DEFAULT: GuestSignInLimit = Object.freeze({
  window: 3600,
  max: 10,
})

/** Reviewed bounds for `experimental.anonymous.rateLimit`, inclusive. */
export const GUEST_SIGN_IN_LIMIT_BOUNDS = Object.freeze({
  window: Object.freeze({ min: 60, max: 24 * 60 * 60 }),
  max: Object.freeze({ min: 1, max: 1000 }),
})

/**
 * Better Auth limits `/sign-in*` to 3 requests per 10 seconds per address, so
 * one address can still create about 1,000 guest users an hour, each a user
 * row and a session. This adds a longer budget for new guests per verified
 * client address. Like Better Auth's own limits, it covers HTTP requests, not
 * `auth.api` calls from server code. The library sets the verified address on
 * every auth route; a request without one shares a single bucket. IPv6
 * addresses share a bucket per /64 network.
 */
export function createGuestSignInLimitPlugin(
  rule: GuestSignInLimit,
  consume: () => ConsumeRateLimit,
): BetterAuthPlugin {
  return {
    id: 'better-convex-guest-sign-in-limit',
    hooks: {
      before: [
        {
          matcher: (context) => context.path === '/sign-in/anonymous',
          handler: createAuthMiddleware(async (context) => {
            if (!context.request) return
            const verified = context.request.headers.get(VERIFIED_CLIENT_IP_HEADER)
            // An IPv6 address counts by its /64 network, the grouping of Better Auth's own
            // limits (the library allows only `ipv6Subnet: 64`): one connection owns a whole /64.
            const address = verified ? normalizeIP(verified, { ipv6Subnet: 64 }) : 'unknown'
            const decision = await consume()(`guest-sign-in:${address}`, {
              window: rule.window,
              max: rule.max,
            })
            if (decision.allowed) return
            const retryAfter = String(Math.max(1, decision.retryAfter ?? rule.window))
            throw new APIError(
              'TOO_MANY_REQUESTS',
              { message: 'Too many requests. Please try again later.' },
              { 'X-Retry-After': retryAfter },
            )
          }),
        },
      ],
    },
  }
}
