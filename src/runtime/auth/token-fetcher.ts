import {
  AUTH_UNAVAILABLE_MESSAGE,
  decodeUserFromJwt,
  getJwtLifetimeMs,
  TOKEN_EXPIRY_SAFETY_BUFFER_MS,
} from '../utils/convex-shared'
import type { ConvexUser } from '../utils/types'

/**
 * Better Auth Convex-plugin surface used to exchange the session for a JWT.
 * `convex.token()` returns `{ data: { token } | null, error }` and, with
 * `fetchOptions.throw = false`, resolves rather than throwing on HTTP failure.
 * Better Fetch calls `fetchOptions.onError` with the raw failed response.
 */
export interface ConvexTokenSource {
  convex: {
    token: (options?: { fetchOptions?: Record<string, unknown> }) => Promise<{
      data?: { token: string | null } | null
      error?: unknown
    }>
  }
}

/** A confirmed candidate identity produced by a successful token exchange. */
export interface FetchedIdentity {
  token: string
  user: ConvexUser
}

export { TOKEN_EXPIRY_SAFETY_BUFFER_MS }

/** Transient-retry attempts, with backoff, bounded by one fixed exchange deadline. */
export const MAX_FETCH_ATTEMPTS = 4

/** First backoff step between transient retries inside one exchange. */
const TRANSIENT_RETRY_BASE_DELAY_MS = 100
/** Upper bound for a server's Retry-After, so a bad header cannot park the client. */
const MAX_RETRY_AFTER_MS = 60_000

/** Total browser budget for one Better Auth -> Convex token exchange cycle. */
const TOKEN_EXCHANGE_TIMEOUT_MS = 5_000
const TOKEN_EXCHANGE_TIMED_OUT = Symbol('TOKEN_EXCHANGE_TIMED_OUT')
const TOKEN_EXCHANGE_CANCELLED = Symbol('TOKEN_EXCHANGE_CANCELLED')
const TOKEN_EXCHANGE_TIMEOUT_MESSAGE = 'Convex authentication token exchange timed out'
const TOKEN_EXCHANGE_CANCELLED_MESSAGE = 'Convex authentication token exchange was cancelled'
const TOKEN_EXCHANGE_FAILURE_MESSAGE = AUTH_UNAVAILABLE_MESSAGE

/**
 * A fetched token's lifetime, read from its own `iat` and `exp`. The browser
 * clock may be minutes or hours off; Convex checks the token's times against
 * its own clock and corrects for the difference, so judging a fresh token by
 * the local clock would reject valid tokens. Null when the token has no valid
 * lifetime beyond the safety buffer.
 */
export function usableTokenLifetimeMs(token: string): number | null {
  const lifetimeMs = getJwtLifetimeMs(token)
  return lifetimeMs !== null && lifetimeMs > TOKEN_EXPIRY_SAFETY_BUFFER_MS ? lifetimeMs : null
}

/**
 * A settled token WITHOUT a non-empty Better Auth `user.id` is an authentication
 * error : decode returns null and the token is discarded, never
 * installed. Returns `null` for a token that decodes to no usable user.
 */
export function decodeFetchedIdentity(token: string): FetchedIdentity | null {
  const user = decodeUserFromJwt(token)
  if (!user || typeof user.id !== 'string' || user.id.length === 0) return null
  return { token, user }
}

/**
 * The outcome of one total token fetch. `identity: null` with `authError: null`
 * is a clean anonymous result when the exchange succeeds with no token. A
 * definitive 401/403 means presented credentials were rejected and is reported
 * as an authentication error. `authError` is also set when a token has no
 * usable lifetime or decodes without a stable user id, or a transient transport
 * failure exhausts the retry loop. `definitive` distinguishes such a transient
 * (non-definitive) failure — over which a usable identity is retained — from
 * the definitive verdicts above. Never rejects.
 */
export interface FetchOutcome {
  identity: FetchedIdentity | null
  authError: string | null
  definitive: boolean
  /** The exchange answered 401/403: the server no longer accepts the session. */
  sessionRejected?: true
  /**
   * The exchange answered 429: how long to wait before asking again, from the
   * response's Retry-After (0 when it sent none). A rate limit says nothing
   * about the session, so the caller decides when to retry.
   */
  retryAfterMs?: number
}

/**
 * Exponential backoff with jitter that never undercuts the server's
 * Retry-After: `max(retryAfterMs, baseMs * 2^attempt)` capped at `maxMs`, then
 * stretched by up to half again at random so that tabs and clients that failed
 * together do not retry together.
 */
export function retryDelayMs(
  attempt: number,
  options: { baseMs: number; maxMs: number; retryAfterMs?: number },
): number {
  const exponential = Math.min(options.maxMs, options.baseMs * 2 ** attempt)
  const floor = Math.max(options.retryAfterMs ?? 0, exponential)
  return Math.round(floor * (1 + Math.random() / 2))
}

/** Delta-seconds or HTTP-date from Retry-After, or Better Auth's X-Retry-After seconds. */
function readRetryAfterMs(headers: Headers): number {
  const value = (headers.get('retry-after') ?? headers.get('x-retry-after'))?.trim()
  if (!value) return 0
  const milliseconds = /^\d+$/u.test(value) ? Number(value) * 1_000 : Date.parse(value) - Date.now()
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return 0
  return Math.min(milliseconds, MAX_RETRY_AFTER_MS)
}

/**
 * Total Convex-token fetch; never throws.
 *
 * Runs a bounded transient-retry loop, with exponential backoff and jitter,
 * over the Better Auth exchange within one fixed browser deadline, validating
 * each returned token's `exp`. Returns a decoded identity on success, a clean
 * anonymous outcome when the exchange reports no session, a definitive error
 * outcome when the server rejects the session or its token, and a transient
 * error outcome when every attempt fails. A 429 ends the loop at once with the
 * server's Retry-After. A rejecting or never-settling exchange is totalized for
 * the Convex caller.
 */
export async function fetchConvexToken(
  source: ConvexTokenSource,
  options: { maxAttempts?: number; signal?: AbortSignal } = {},
): Promise<FetchOutcome> {
  if (options.signal?.aborted) {
    return {
      identity: null,
      authError: TOKEN_EXCHANGE_CANCELLED_MESSAGE,
      definitive: false,
    }
  }
  const maxAttempts = options.maxAttempts ?? MAX_FETCH_ATTEMPTS
  let lastError: string | null = null
  const controller = new AbortController()
  let timedOut = false
  let externallyCancelled = false
  let timeout: ReturnType<typeof setTimeout> | null = null
  const deadline = new Promise<typeof TOKEN_EXCHANGE_TIMED_OUT>((resolve) => {
    timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
      resolve(TOKEN_EXCHANGE_TIMED_OUT)
    }, TOKEN_EXCHANGE_TIMEOUT_MS)
  })
  let removeExternalAbort = () => {}
  const cancellation = new Promise<typeof TOKEN_EXCHANGE_CANCELLED>((resolve) => {
    const externalSignal = options.signal
    if (!externalSignal) return
    const cancel = () => {
      externallyCancelled = true
      resolve(TOKEN_EXCHANGE_CANCELLED)
      controller.abort()
    }
    externalSignal.addEventListener('abort', cancel, { once: true })
    removeExternalAbort = () => externalSignal.removeEventListener('abort', cancel)
    if (externalSignal.aborted) cancel()
  })

  let backoff: ReturnType<typeof setTimeout> | null = null
  const pause = (delayMs: number) =>
    Promise.race([
      new Promise<void>((resolve) => {
        backoff = setTimeout(resolve, delayMs)
      }),
      deadline,
      cancellation,
    ])

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (externallyCancelled) {
        lastError = TOKEN_EXCHANGE_CANCELLED_MESSAGE
        break
      }
      if (attempt > 1) {
        const paused = await pause(
          retryDelayMs(attempt - 2, {
            baseMs: TRANSIENT_RETRY_BASE_DELAY_MS,
            maxMs: TOKEN_EXCHANGE_TIMEOUT_MS,
          }),
        )
        if (paused === TOKEN_EXCHANGE_CANCELLED) {
          lastError = TOKEN_EXCHANGE_CANCELLED_MESSAGE
          break
        }
        if (paused === TOKEN_EXCHANGE_TIMED_OUT) {
          lastError = TOKEN_EXCHANGE_TIMEOUT_MESSAGE
          break
        }
      }
      try {
        let retryAfterMs = 0
        // `signal` releases the real Better Fetch request; the explicit race is
        // still required to totalize a custom/plugin source that ignores abort.
        // Better Fetch calls `onError` with the raw response before it resolves
        // the error envelope, which carries only the status.
        const exchange = source.convex.token({
          fetchOptions: {
            throw: false,
            signal: controller.signal,
            onError(context: { response?: Response }) {
              if (context.response) retryAfterMs = readRetryAfterMs(context.response.headers)
            },
          },
        })
        const response = await Promise.race([exchange, deadline, cancellation])
        if (response === TOKEN_EXCHANGE_CANCELLED) {
          lastError = TOKEN_EXCHANGE_CANCELLED_MESSAGE
          break
        }
        if (response === TOKEN_EXCHANGE_TIMED_OUT) {
          lastError = TOKEN_EXCHANGE_TIMEOUT_MESSAGE
          break
        }
        if (response.error) {
          if (isDefinitiveAuthStatus(response.error)) {
            return {
              identity: null,
              authError: 'Authentication credentials are invalid or expired',
              definitive: true,
              sessionRejected: true,
            }
          }
          if (errorStatus(response.error) === 429) {
            // Asking again before Retry-After only refills the limiter's bucket.
            return {
              identity: null,
              authError: TOKEN_EXCHANGE_FAILURE_MESSAGE,
              definitive: false,
              retryAfterMs,
            }
          }
          lastError = TOKEN_EXCHANGE_FAILURE_MESSAGE
          continue
        }
        const token = response.data?.token
        if (!token) {
          // Clean anonymous outcome: the exchange reported no session.
          return { identity: null, authError: null, definitive: true }
        }
        if (usableTokenLifetimeMs(token) === null) {
          // The server answered; a token without a usable lifetime is its verdict,
          // not an outage, so no earlier token may stand in for it.
          return {
            identity: null,
            authError: 'Convex authentication token is expired or missing a valid expiry',
            definitive: true,
          }
        }
        const identity = decodeFetchedIdentity(token)
        if (!identity) {
          // Token without a usable user id is an authentication error; discard it.
          return {
            identity: null,
            authError: 'Convex authentication token is missing a stable user id',
            definitive: true,
          }
        }
        return { identity, authError: null, definitive: false }
      } catch {
        if (externallyCancelled) {
          lastError = TOKEN_EXCHANGE_CANCELLED_MESSAGE
          break
        }
        if (timedOut) {
          lastError = TOKEN_EXCHANGE_TIMEOUT_MESSAGE
          break
        }
        lastError = TOKEN_EXCHANGE_FAILURE_MESSAGE
      }
    }
  } finally {
    removeExternalAbort()
    if (timeout !== null) clearTimeout(timeout)
    if (backoff !== null) clearTimeout(backoff)
  }

  // Exhausted transient retries: a still-usable identity may be retained.
  return {
    identity: null,
    authError: lastError ?? TOKEN_EXCHANGE_FAILURE_MESSAGE,
    definitive: false,
  }
}

function errorStatus(error: unknown): unknown {
  return error && typeof error === 'object' ? (error as { status?: unknown }).status : undefined
}

/** True when a Better Auth error envelope reports HTTP 401/403. */
function isDefinitiveAuthStatus(error: unknown): boolean {
  const status = errorStatus(error)
  return status === 401 || status === 403
}
