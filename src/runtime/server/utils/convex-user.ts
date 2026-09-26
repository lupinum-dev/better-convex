import type { H3Event } from 'h3'

import { ConvexCallError } from '../../errors'
import type { ConvexUser } from '../../utils/types'
import { readEventConvexConfig, readEventCookieHeader } from './event-context'
import { toConvexH3Error } from './h3-error'
import { resolveRequestAuthSnapshot } from './request-auth'

/**
 * Read the signed-in user for this request, or `null` when it is anonymous.
 *
 * The request's Better Auth session cookie is exchanged for a Convex token at
 * most once per request; SSR hydration and repeated calls share that result.
 * Only the supported Better Auth cookies are forwarded. A build without auth
 * always resolves `null`.
 *
 * The user is display identity for routing and rendering. Authorize protected
 * data inside Convex functions, for example with
 * `serverConvex(event, { auth: 'required' })`.
 *
 * Rejects with an H3 error (see {@link toConvexH3Error}) when the identity
 * cannot be resolved: 502 when the auth backend fails, 500 when auth is
 * enabled without a Convex site URL.
 */
export async function getConvexUser(event: H3Event): Promise<ConvexUser | null> {
  const config = readEventConvexConfig(event)
  if (config.auth === false) return null
  if (!config.siteUrl) {
    throw toConvexH3Error(
      new ConvexCallError({
        kind: 'unknown',
        code: 'SITE_URL_MISSING',
        message: 'Convex authentication has no configured Convex site URL',
      }),
    )
  }

  const snapshot = await resolveRequestAuthSnapshot(event, {
    siteUrl: config.siteUrl,
    trustedClientIpHeader: config.auth.trustedClientIpHeader,
    cookieHeader: readEventCookieHeader(event),
  })
  if (snapshot.authError !== null) {
    throw toConvexH3Error(
      new ConvexCallError({
        kind: 'transport',
        code: 'AUTH_UNAVAILABLE',
        message: 'Convex authentication is temporarily unavailable',
      }),
    )
  }
  return snapshot.user
}

/**
 * Read the signed-in user for this request, or throw an H3 401 error.
 *
 * The response body's `data` is a serialized `ConvexCallError` with kind
 * `authentication` and code `UNAUTHENTICATED`. Missing, invalid, and revoked
 * sessions are all 401, and a build without auth always throws it. Identity
 * resolution failures reject as {@link getConvexUser} does.
 */
export async function requireConvexUser(event: H3Event): Promise<ConvexUser> {
  const user = await getConvexUser(event)
  if (user) return user
  throw toConvexH3Error(
    new ConvexCallError({
      kind: 'authentication',
      code: 'UNAUTHENTICATED',
      message: 'Authentication required',
      status: 401,
    }),
  )
}
