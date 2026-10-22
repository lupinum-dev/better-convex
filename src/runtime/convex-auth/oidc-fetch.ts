/**
 * The one fetch path for every call to the OIDC identity provider: one
 * deadline per operation, no redirects, a response size limit, JSON only.
 */
import { readStreamWithByteLimit } from '../shared/bounded-stream'

export type OidcErrorCode =
  | 'AUTH_OIDC_TRANSPORT'
  | 'AUTH_OIDC_DISCOVERY_FAILED'
  | 'AUTH_OIDC_DISCOVERY_INVALID'
  | 'AUTH_OIDC_ISSUER_MISMATCH'
  | 'AUTH_OIDC_JWKS_FAILED'
  | 'AUTH_OIDC_TOKEN_REQUEST_FAILED'
  | 'AUTH_OIDC_ID_TOKEN_INVALID'
  | 'AUTH_OIDC_LOGOUT_TOKEN_INVALID'
  | 'AUTH_OIDC_LOGOUT_REPLAYED'
  | 'AUTH_OIDC_LOGOUT_REVOKE_FAILED'
  | 'AUTH_OIDC_REFRESH_FAILED'
  | 'AUTH_OIDC_GRANT_ENDED'
  | 'AUTH_OIDC_CLIENT_REJECTED'
  | 'AUTH_OIDC_REFRESH_DELEGATED'
  | 'AUTH_OIDC_ACCOUNT_CONFLICT'

/** A log-only OIDC failure. The message (`CODE` or `CODE:detail`) never holds a secret. */
export class OidcError extends Error {
  constructor(
    readonly code: OidcErrorCode,
    readonly detail?: string,
  ) {
    super(detail === undefined ? code : `${code}:${detail}`)
  }
}

const OIDC_DEADLINE_MS = 10_000
/** The size limit for discovery, JWKS and token responses. */
export const OIDC_MAX_RESPONSE_BYTES = 65_536
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

/** The deadline for one operation that touches the IdP. */
export function oidcDeadline(): number {
  return Date.now() + OIDC_DEADLINE_MS
}

/** Read a body as text. The shared reader stops at `maxBytes` and cancels the stream. */
async function readCapped(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<string> {
  const bytes = await readStreamWithByteLimit(
    stream,
    maxBytes,
    () => new OidcError('AUTH_OIDC_TRANSPORT', 'too_large'),
  )
  return bytes === undefined ? '' : new TextDecoder().decode(bytes)
}

function declaredLength(headers: Headers): number | null {
  const value = headers.get('content-length')
  if (value === null || !/^\d+$/u.test(value.trim())) return null
  return Number(value.trim())
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  if (text.length === 0) return null
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  return isRecord(value) ? value : null
}

async function send(
  url: string,
  init: {
    readonly method: 'GET' | 'POST'
    readonly headers?: Record<string, string>
    readonly body?: URLSearchParams
  },
  limits: { readonly maxBytes: number },
  signal: AbortSignal,
): Promise<{ readonly status: number; readonly json: Record<string, unknown> | null }> {
  let response: Response
  try {
    response = await fetch(url, {
      method: init.method,
      headers: { ...init.headers, accept: 'application/json' },
      body: init.body,
      redirect: 'manual',
      signal,
    })
  } catch {
    throw new OidcError('AUTH_OIDC_TRANSPORT', 'network')
  }
  if (response.type === 'opaqueredirect' || REDIRECT_STATUSES.has(response.status))
    throw new OidcError('AUTH_OIDC_TRANSPORT', 'redirect')
  const length = declaredLength(response.headers)
  if (length !== null && length > limits.maxBytes) {
    response.body?.cancel().catch(() => {})
    throw new OidcError('AUTH_OIDC_TRANSPORT', 'too_large')
  }
  let text: string
  try {
    text = await readCapped(response.body, limits.maxBytes)
  } catch (error) {
    if (error instanceof OidcError) throw error
    throw new OidcError('AUTH_OIDC_TRANSPORT', 'network')
  }
  return { status: response.status, json: parseJsonObject(text) }
}

/**
 * Send one request to the IdP. Throws `OidcError('AUTH_OIDC_TRANSPORT', detail)`
 * for `timeout`, `redirect`, `too_large` and `network`. The caller decides about
 * the status. An empty, non-JSON or array body gives `json: null`.
 */
export async function idpFetch(
  url: string,
  init: {
    readonly method: 'GET' | 'POST'
    readonly headers?: Record<string, string>
    readonly body?: URLSearchParams
  },
  limits: { readonly deadline: number; readonly maxBytes: number },
): Promise<{ readonly status: number; readonly json: Record<string, unknown> | null }> {
  const controller = new AbortController()
  let fail: (error: OidcError) => void = () => {}
  const expired = new Promise<never>((_resolve, reject) => {
    fail = (error) => {
      controller.abort()
      reject(error)
    }
  })
  // The timer races the fetch, so the deadline holds even if the runtime ignores `signal`.
  const timer = setTimeout(
    () => fail(new OidcError('AUTH_OIDC_TRANSPORT', 'timeout')),
    Math.max(0, limits.deadline - Date.now()),
  )
  const sent = send(url, init, limits, controller.signal)
  // A request that loses the race rejects later; nobody waits for it.
  sent.catch(() => {})
  try {
    return await Promise.race([sent, expired])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Read a request body as text, at most `maxBytes`. Returns `null` when the body
 * is larger, without reading past the limit.
 */
export async function readBodyCapped(request: Request, maxBytes: number): Promise<string | null> {
  const length = declaredLength(request.headers)
  if (length !== null && length > maxBytes) return null
  try {
    return await readCapped(request.body, maxBytes)
  } catch (error) {
    if (error instanceof OidcError && error.detail === 'too_large') return null
    throw error
  }
}
