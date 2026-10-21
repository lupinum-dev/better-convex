/**
 * OpenID Connect Back-Channel Logout 1.0: the IdP posts a signed logout token,
 * and we end the grant of the user it names. The signed token is the only gate:
 * no cookie, origin check or CSRF token applies to this route.
 */
import { logOidcFailure } from './diagnostics'
import { oidcDeadline, readBodyCapped } from './oidc-fetch'
import type { OidcClient } from './oidc-metadata'

type ConsumeRateLimit = (
  key: string,
  rule: { window: number; max: number },
) => Promise<{ allowed: boolean; retryAfter: number | null }>

export interface OidcBackchannelDeps {
  readonly client: OidcClient
  readonly consume: ConsumeRateLimit
  readonly findUserIdBySubject: (sub: string) => Promise<string | null>
  readonly endGrant: (userId: string) => Promise<void>
}

const OIDC_LOGOUT_TOKEN_MAX_AGE_SECONDS = 300
// Longer than the acceptance window (iat + 300 s + 2 × 60 s tolerance), so a
// replayed token is either still in the cache or too old.
const OIDC_LOGOUT_JTI_WINDOW_SECONDS = 600
const OIDC_LOGOUT_MAX_BODY_BYTES = 16_384
const BACKCHANNEL_LOGOUT_EVENT = 'http://schemas.openid.net/event/backchannel-logout'
const MAX_JTI_LENGTH = 256
const FORM_MEDIA_TYPE = 'application/x-www-form-urlencoded'

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function respond(status: number, body: string | null, headers: Record<string, string> = {}) {
  const init: Record<string, string> = { 'cache-control': 'no-store', ...headers }
  if (body !== null) init['content-type'] = 'application/json'
  return new Response(body, { status, headers: init })
}

/** 400. The body never names the failed check; the log does. */
function invalid(reason: string): Response {
  logOidcFailure(
    reason === 'replay' ? 'AUTH_OIDC_LOGOUT_REPLAYED' : `AUTH_OIDC_LOGOUT_TOKEN_INVALID:${reason}`,
  )
  return respond(400, '{"error":"invalid_request"}')
}

function mediaType(request: Request): string {
  return (request.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
}

/**
 * Answer one back-channel logout request. Nothing is written before the logout
 * token's signature, issuer, audience and age are verified.
 */
export async function handleOidcBackchannelLogout(
  request: Request,
  deps: OidcBackchannelDeps,
): Promise<Response> {
  const deadline = oidcDeadline()
  if (request.method !== 'POST') return respond(405, null, { allow: 'POST' })
  if (mediaType(request) !== FORM_MEDIA_TYPE) return invalid('content_type')

  const body = await readBodyCapped(request, OIDC_LOGOUT_MAX_BODY_BYTES).catch(() => null)
  if (body === null) return invalid('body')

  const tokens = new URLSearchParams(body).getAll('logout_token')
  if (tokens.length !== 1 || tokens[0] === '') return invalid('missing')

  const verified = await deps.client.verifyJwt(
    tokens[0]!,
    {
      typ: 'logout_token',
      requiredClaims: ['iss', 'aud', 'iat', 'jti', 'events'],
      maxTokenAgeSeconds: OIDC_LOGOUT_TOKEN_MAX_AGE_SECONDS,
    },
    deadline,
  )
  if (!verified.ok) {
    if (verified.reason === 'keys_unavailable') {
      // Nothing has changed yet, so the IdP's retry is safe.
      logOidcFailure('AUTH_OIDC_JWKS_FAILED')
      return respond(503, '{"error":"temporarily_unavailable"}', { 'retry-after': '30' })
    }
    return invalid(verified.reason)
  }
  const payload = verified.payload

  const events = payload.events
  if (!isPlainRecord(events) || !isPlainRecord(events[BACKCHANNEL_LOGOUT_EVENT]))
    return invalid('events')
  if ('nonce' in payload) return invalid('nonce')
  // A sid-only token is refused: sessions are not mapped to IdP session ids.
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) return invalid('sub')
  if (payload.sid !== undefined && typeof payload.sid !== 'string') return invalid('sid')
  const jti = payload.jti
  if (typeof jti !== 'string' || jti.length === 0 || jti.length > MAX_JTI_LENGTH) {
    return invalid('jti')
  }

  const replay = await deps.consume(`oidc-logout-jti:${jti}`, {
    window: OIDC_LOGOUT_JTI_WINDOW_SECONDS,
    max: 1,
  })
  if (!replay.allowed) return invalid('replay')

  const userId = await deps.findUserIdBySubject(payload.sub)
  // Nothing to end; the answer is the same for every retry.
  if (userId === null) return respond(200, null)
  try {
    await deps.endGrant(userId)
  } catch (error) {
    logOidcFailure('AUTH_OIDC_LOGOUT_REVOKE_FAILED', { cause: error })
    return respond(500, null)
  }
  return respond(200, null)
}
