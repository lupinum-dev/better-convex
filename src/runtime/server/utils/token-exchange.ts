import { appendResponseHeader, type H3Event } from 'h3'

import { ConvexCallError } from '../../errors'
import { getSessionCookieFlagViolation } from '../../shared/auth-cookie'
import {
  deduplicateSetCookies,
  filterBetterAuthCookies,
  getBetterAuthSessionToken,
  getSetCookieName,
  hasSetCookieDomainAttribute,
  isBetterAuthSetCookie,
} from '../../utils/shared-helpers'
import { normalizeConvexSiteUrl } from '../../utils/site-url'
import { readEventConvexConfig } from './event-context'
import { fetchWithTimeout, MAX_SERVER_AUTH_RESPONSE_BODY_BYTES, readBoundedJson } from './http'
import type { ConvexCredential } from './server-convex-options'
import {
  assertConvexCredentialShape,
  assertCredentialValueSafe,
  ServerConvexValidationError,
} from './server-convex-options'
import { buildSignedClientIpHeaders, buildSignedPublicOriginHeaders } from './signed-client-ip'
import { applyConvexAuthSsrHeaders } from './ssr-auth-headers'

/** Better Auth HTTP endpoint that mints a Convex JWT from a session cookie. */
const TOKEN_EXCHANGE_PATH = '/api/auth/convex/token'

/** Default timeout for the credential -> JWT exchange. */
const DEFAULT_TOKEN_EXCHANGE_TIMEOUT_MS = 5_000

/**
 * The never-throwing result of a cookie -> Convex JWT exchange
 * (architecture invariant).
 *
 * Success returns a non-null `token`, a 2xx `status`, and `error: null`.
 * A network/HTTP failure returns `token: null`, exactly one `error`, and the
 * upstream `status` when one exists. This is intentionally NOT an
 * `ok`-discriminated union; the invariants above are pinned by tests.
 */
export interface ConvexTokenExchangeResult {
  token: string | null
  status: number | undefined
  error: ConvexCallError | null
}

interface RequestBoundTokenExchangeInput {
  event: H3Event
  siteUrl: string
  credential: ConvexCredential
  trustedClientIpHeader: string
  timeoutMs?: number
  /**
   * The credential is the cookie this event's own request presented, so a
   * session renewal the exchange triggers belongs on this event's response.
   */
  renewsRequestSession?: boolean
}

/** Extract a non-empty string `token` field from a parsed exchange body. */
function readToken(body: unknown): string | null {
  if (body && typeof body === 'object') {
    const token = (body as { token?: unknown }).token
    if (typeof token === 'string' && token.length > 0) return token
  }
  return null
}

// ---------------------------------------------------------------------------
// exchangeConvexToken (request-bound, never-throwing exchange primitive)
// ---------------------------------------------------------------------------

/**
 * Exchange a Better Auth cookie credential for a Convex JWT.
 *
 * This never throws for an exchange OUTCOME: every network, HTTP, timeout,
 * oversized, malformed, missing-token, or redirect failure is returned as a
 * {@link ConvexTokenExchangeResult} with a single {@link ConvexCallError}.
 *
 * It DOES throw synchronously — before any network access — for a malformed
 * credential discriminant, an empty/control-bearing value, or a cookie
 * credential without a non-empty supported Better Auth session cookie. These
 * are caller-contract violations, not exchange outcomes. The guards use
 * {@link ServerConvexValidationError}.
 *
 * `redirect: 'error'` guarantees the credential is never delivered to a redirect
 * target: the fetch rejects before following, and that rejection surfaces through
 * the generic catch as `kind: 'transport'`. The security property is
 * zero-delivery, not the error label — the catch never inspects message text.
 */
function validateTokenExchangeCredential(credential: ConvexCredential): string {
  // Synchronous, pre-network validation. A control-character or empty credential
  // is refused before it can reach a request header or the network.
  assertConvexCredentialShape(credential)
  assertCredentialValueSafe(credential.value, 'credential value')
  const cookieHeader = filterBetterAuthCookies(credential.value)
  const sessionToken = getBetterAuthSessionToken(cookieHeader)
  if (!cookieHeader || !sessionToken) {
    throw new ServerConvexValidationError(
      'credential must contain a non-empty supported Better Auth session cookie',
    )
  }
  return cookieHeader
}

/** Request-aware exchange used by every shipped Nitro auth path. */
export function exchangeConvexToken(
  input: RequestBoundTokenExchangeInput,
): Promise<ConvexTokenExchangeResult> {
  const cookieHeader = validateTokenExchangeCredential(input.credential)
  return (async () => {
    try {
      const clientIpHeaders = await buildSignedClientIpHeaders(input.event, {
        trustedClientIpHeader: input.trustedClientIpHeader,
      })
      const auth = readEventConvexConfig(input.event).auth
      const originHeaders = auth ? await buildSignedPublicOriginHeaders(auth.origin) : {}
      return await runTokenExchange(
        input,
        { ...clientIpHeaders, ...originHeaders, Cookie: cookieHeader },
        input.renewsRequestSession
          ? (setCookies) => forwardSessionRenewal(input.event, setCookies)
          : undefined,
      )
    } catch {
      return tokenExchangeTransportFailure()
    }
  })()
}

function tokenExchangeTransportFailure(): ConvexTokenExchangeResult {
  return {
    token: null,
    status: undefined,
    error: new ConvexCallError({
      kind: 'transport',
      code: 'NETWORK_ERROR',
      message: 'Convex token exchange could not complete',
    }),
  }
}

/**
 * Carry the Better Auth cookies of an exchange response to the browser. The
 * token route extends a session past its update age and renews the session
 * cookie; without this the browser cookie keeps its old expiry and lapses while
 * the stored session lives on. Only supported host-only Better Auth cookies with
 * the required flags pass, and a response carrying them is private to its
 * cookie holder. Prerendering has no request cookie, and Nitro's route cache
 * drops it unless a rule varies on Cookie, so neither runs an exchange; a cache
 * that varies on Cookie replays the renewal only to the same cookie holder.
 */
function forwardSessionRenewal(event: H3Event, setCookies: readonly string[]): void {
  const cookies = deduplicateSetCookies(setCookies).filter(
    (cookie) =>
      isBetterAuthSetCookie(cookie) &&
      !hasSetCookieDomainAttribute(cookie) &&
      getSessionCookieFlagViolation(cookie, getSetCookieName(cookie) ?? '') === null,
  )
  if (cookies.length === 0 || event.node.res.headersSent) return
  for (const cookie of cookies) appendResponseHeader(event, 'set-cookie', cookie)
  applyConvexAuthSsrHeaders(event, { hasBetterAuthCookie: true, rendersUser: false })
}

async function runTokenExchange(
  input: { siteUrl: string; timeoutMs?: number },
  headers: Record<string, string>,
  onSetCookies?: (setCookies: readonly string[]) => void,
): Promise<ConvexTokenExchangeResult> {
  try {
    const response = await fetchWithTimeout(
      `${normalizeConvexSiteUrl(input.siteUrl)}${TOKEN_EXCHANGE_PATH}`,
      {
        method: 'GET',
        headers,
        redirect: 'error',
        timeoutMs: input.timeoutMs ?? DEFAULT_TOKEN_EXCHANGE_TIMEOUT_MS,
      },
    )
    onSetCookies?.(response.headers.getSetCookie())
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      const rejected = response.status === 401 || response.status === 403
      return {
        token: null,
        status: response.status,
        error: new ConvexCallError({
          kind: rejected ? 'authentication' : 'transport',
          code: rejected ? 'UNAUTHENTICATED' : 'UPSTREAM_ERROR',
          message: `Convex token exchange failed with HTTP ${response.status}`,
          status: response.status,
        }),
      }
    }

    const parsed = await readBoundedJson(response, MAX_SERVER_AUTH_RESPONSE_BODY_BYTES)
    const token = readToken(parsed)
    if (!token) {
      return {
        token: null,
        status: response.status,
        error: new ConvexCallError({
          kind: 'transport',
          code: 'INVALID_RESPONSE',
          message: 'Convex token exchange response did not include a token',
          status: response.status,
        }),
      }
    }
    return { token, status: response.status, error: null }
  } catch {
    return tokenExchangeTransportFailure()
  }
}
