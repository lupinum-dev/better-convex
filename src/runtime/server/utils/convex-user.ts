import { ConvexCallError } from '../../errors'
import { filterBetterAuthCookies } from '../../utils/shared-helpers'
import type { ConvexUser } from '../../utils/types'
import { eventRequestHeaders, type ConvexServerEvent } from './event'
import { toConvexH3Error } from './h3-error'
import { resolveRequestAuthSnapshot } from './request-auth'
import { readServerConvexConfig } from './server-config'
import { applyConvexAuthSsrHeaders } from './ssr-auth-headers'

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
 * Rejects with an HTTP error (`NuxtError`, see {@link toConvexH3Error}) when the identity
 * cannot be resolved: 502 when the auth backend fails, 500 when auth is
 * enabled without a Convex site URL.
 */
export async function getConvexUser(event: ConvexServerEvent): Promise<ConvexUser | null> {
  const config = readServerConvexConfig()
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

  const cookieHeader = eventRequestHeaders(event).get('cookie')
  // The identity depends on the request cookie, so the response must not be
  // shared between visitors by a cache.
  applyConvexAuthSsrHeaders(event, {
    hasBetterAuthCookie: filterBetterAuthCookies(cookieHeader) !== null,
    rendersUser: false,
  })
  const snapshot = await resolveRequestAuthSnapshot(event, {
    siteUrl: config.siteUrl,
    publicOrigin: config.auth.origin,
    trustedClientIpHeader: config.auth.trustedClientIpHeader,
    cookieHeader,
  })
  if (snapshot.authError !== null) {
    throw toConvexH3Error(
      new ConvexCallError({
        kind: 'transport',
        code: snapshot.authError.code,
        message: snapshot.authError.message,
      }),
    )
  }
  return snapshot.user
}

/**
 * Read the signed-in user for this request, or throw an HTTP 401 error
 * (`NuxtError`).
 *
 * The response body's `data` is a serialized `ConvexCallError` with kind
 * `authentication` and code `UNAUTHENTICATED`. Missing, invalid, and revoked
 * sessions are all 401, and a build without auth always throws it. Identity
 * resolution failures reject as {@link getConvexUser} does.
 */
export async function requireConvexUser(event: ConvexServerEvent): Promise<ConvexUser> {
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
