import {
  authFailureOf,
  classifyAuthFailure,
  decodeUserFromJwt,
  getJwtLifetimeMs,
  TOKEN_EXPIRY_SAFETY_BUFFER_MS,
  type ClassifiedAuthFailure,
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
export const TOKEN_EXCHANGE_TIMEOUT_MS = 5_000
const TOKEN_EXCHANGE_TIMED_OUT = Symbol('TOKEN_EXCHANGE_TIMED_OUT')
const TOKEN_EXCHANGE_CANCELLED = Symbol('TOKEN_EXCHANGE_CANCELLED')
/** No answer: a network error, the deadline, or a cancelled exchange. */
const NO_ANSWER = classifyAuthFailure({ status: undefined })
const INVALID_TOKEN = classifyAuthFailure({ invalidToken: true })

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
 * The outcome of one total token fetch. Never rejects.
 *
 * - `identity` set: the exchange returned a usable token for a user.
 * - `failure` set: why not, classified by `classifyAuthFailure`. A `temporary`
 *   failure (every attempt failed for no answer, a timeout, 408, 429 or 5xx)
 *   says nothing about the session, so the caller may wait and ask again. A
 *   `rejected` one (401/403) means the server no longer accepts the session. A
 *   `setup` one is any other answer, including a 2xx without a usable token.
 */
export interface FetchOutcome {
  identity: FetchedIdentity | null
  failure: ClassifiedAuthFailure | null
  /**
   * The exchange answered 429: how long to wait before asking again, from the
   * response's Retry-After (0 when it sent none).
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
 * each returned token's lifetime and `sub`. Returns a decoded identity on
 * success and a classified failure otherwise. A 429 ends the loop at once with
 * the server's Retry-After. A rejecting or never-settling exchange is
 * totalized for the Convex caller.
 */
export async function fetchConvexToken(
  source: ConvexTokenSource,
  options: { maxAttempts?: number; signal?: AbortSignal } = {},
): Promise<FetchOutcome> {
  if (options.signal?.aborted) return { identity: null, failure: NO_ANSWER }
  const maxAttempts = options.maxAttempts ?? MAX_FETCH_ATTEMPTS
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
      if (externallyCancelled) break
      if (attempt > 1) {
        const paused = await pause(
          retryDelayMs(attempt - 2, {
            baseMs: TRANSIENT_RETRY_BASE_DELAY_MS,
            maxMs: TOKEN_EXCHANGE_TIMEOUT_MS,
          }),
        )
        if (paused === TOKEN_EXCHANGE_CANCELLED || paused === TOKEN_EXCHANGE_TIMED_OUT) break
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
        if (response === TOKEN_EXCHANGE_CANCELLED || response === TOKEN_EXCHANGE_TIMED_OUT) break
        if (response.error) {
          const reported = authFailureOf(response.error)
          const failure = classifyAuthFailure(reported)
          if (failure.class !== 'temporary') return { identity: null, failure }
          // Asking again before Retry-After only refills the limiter's bucket.
          if (reported.status === 429) {
            return { identity: null, failure, retryAfterMs }
          }
          continue
        }
        // The server answered. A token that is missing, short-lived or names no
        // user breaks the token contract: no earlier token may stand in for it.
        const token = response.data?.token
        const identity =
          token && usableTokenLifetimeMs(token) !== null ? decodeFetchedIdentity(token) : null
        if (!identity) return { identity: null, failure: INVALID_TOKEN }
        return { identity, failure: null }
      } catch {
        if (externallyCancelled || timedOut) break
      }
    }
  } finally {
    removeExternalAbort()
    if (timeout !== null) clearTimeout(timeout)
    if (backoff !== null) clearTimeout(backoff)
  }

  // Every attempt failed without an answer about the session.
  return { identity: null, failure: NO_ANSWER }
}
