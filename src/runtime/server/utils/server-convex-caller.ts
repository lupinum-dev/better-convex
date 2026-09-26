import { ConvexHttpClient } from 'convex/browser'
import {
  getFunctionName,
  type FunctionReference,
  type FunctionReturnType,
  type OptionalRestArgs,
} from 'convex/server'
import type { H3Event } from 'h3'

import { ConvexCallError, normalizeConvexError } from '../../errors'
import { createBoundedConvexFetch } from '../../utils/bounded-convex-fetch'
import { filterBetterAuthCookies, getBetterAuthSessionToken } from '../../utils/shared-helpers'
import { readEventConvexConfig, readEventCookieHeader } from './event-context'
import { resolveRequestAuthSnapshot } from './request-auth'
import {
  validateServerConvexOptions,
  type NormalizedServerConvexOptions,
  type ServerConvexOptions,
} from './server-convex-options'
import { exchangeConvexToken, type ConvexTokenExchangeResult } from './token-exchange'

export type { ServerConvexOptions }

/**
 * One request-scoped server caller ("Caller-owned token promise").
 *
 * A caller owns exactly one lazy authentication token promise and one lazy
 * `ConvexHttpClient`; `setAuth` runs at most once, when a token exists. The
 * operation methods use Convex's native optional-rest-args contract, so exact
 * no-argument references omit the artificial `{}` argument while references
 * with declared arguments remain required and inferred.
 */
export interface ServerConvexCaller {
  getToken(): Promise<string | null>
  query<Query extends FunctionReference<'query'>>(
    query: Query,
    ...args: OptionalRestArgs<Query>
  ): Promise<FunctionReturnType<Query>>
  mutation<Mutation extends FunctionReference<'mutation'>>(
    mutation: Mutation,
    ...args: OptionalRestArgs<Mutation>
  ): Promise<FunctionReturnType<Mutation>>
  action<Action extends FunctionReference<'action'>>(
    action: Action,
    ...args: OptionalRestArgs<Action>
  ): Promise<FunctionReturnType<Action>>
}

function readRequiredConvexUrl(url: string | undefined): string {
  if (!url) {
    throw new ConvexCallError({
      kind: 'unknown',
      code: 'CONVEX_URL_MISSING',
      message: 'Convex URL is not configured for serverConvex',
    })
  }
  return url
}

// ---------------------------------------------------------------------------
// Token resolution ("Cookie resolution").
// ---------------------------------------------------------------------------

function authenticationRequiredError(status = 401): ConvexCallError {
  return new ConvexCallError({
    kind: 'authentication',
    code: 'UNAUTHENTICATED',
    message: 'Convex authentication is required for this server call',
    status,
  })
}

/** Convert a never-throwing exchange failure into the thrown boundary error. */
function throwExchangeFailure(result: ConvexTokenExchangeResult): never {
  throw (
    result.error ??
    new ConvexCallError({
      kind: 'transport',
      code: 'NETWORK_ERROR',
      message: 'Convex token exchange could not complete',
    })
  )
}

async function resolveServerToken(
  event: H3Event,
  normalized: NormalizedServerConvexOptions,
): Promise<string | null> {
  // Explicit opaque token: the caller's chosen snapshot. No exchange.
  if (normalized.authToken) {
    return normalized.authToken
  }

  const config = readEventConvexConfig(event)
  const required = normalized.auth === 'required'

  if (config.auth === false) {
    if (normalized.credential || required) throw authenticationRequiredError()
    return null
  }

  // Explicit cookie credential: always exchanged, always `required`. A 401/403
  // always throws authentication and never falls back to anonymous.
  if (normalized.credential) {
    if (!config.siteUrl) throw authenticationRequiredError()
    const result = await exchangeConvexToken({
      event,
      siteUrl: config.siteUrl,
      credential: normalized.credential,
      trustedClientIpHeader: config.auth.trustedClientIpHeader,
    })
    if (result.token) return result.token
    throwExchangeFailure(result)
  }

  // Cookie-based event resolution.
  if (normalized.auth === 'none') return null

  const cookieHeader = readEventCookieHeader(event)
  const sessionToken = getBetterAuthSessionToken(cookieHeader)
  const authCookieHeader = filterBetterAuthCookies(cookieHeader)

  if (!authCookieHeader || !sessionToken) {
    if (required) throw authenticationRequiredError()
    return null
  }

  if (!config.siteUrl) {
    if (required) throw authenticationRequiredError()
    return null
  }

  // The request's shared snapshot: one exchange per request, and the identity
  // Convex authorizes is the one getConvexUser/requireConvexUser display.
  const snapshot = await resolveRequestAuthSnapshot(event, {
    siteUrl: config.siteUrl,
    trustedClientIpHeader: config.auth.trustedClientIpHeader,
    cookieHeader,
  })

  if (snapshot.token) return snapshot.token

  // No token and no failure is a definitive miss (no usable session, or an
  // exchange 401/403): anonymous for optional, authentication for required.
  // Every other failure (transport, 5xx, oversized, malformed, unusable token)
  // throws transport in both modes.
  if (snapshot.authError === null) {
    if (required) throw authenticationRequiredError(snapshot.exchangeStatus === 403 ? 403 : 401)
    return null
  }
  throw new ConvexCallError({
    kind: 'transport',
    code: 'AUTH_UNAVAILABLE',
    message: 'Convex authentication is temporarily unavailable',
  })
}

// ---------------------------------------------------------------------------
// serverConvex
// ---------------------------------------------------------------------------

/**
 * Construct a request-scoped Convex server caller.
 *
 * The caller lazily resolves one authentication token and one
 * `ConvexHttpClient` (built with `logger: false` so arbitrary Convex function
 * log lines are not re-emitted, and the shared bounded fetch so abort, deadline,
 * response-size, and transport classification remain request-scoped). The
 * response cap and query deadline come from the `server` module options. A
 * rejected token or client promise stays rejected for this caller; retrying
 * requires a new caller. Neither promise is stored on the event nor keyed by
 * option hash. The request-cookie path reads the request's shared auth
 * snapshot, so it reuses the exchange of SSR hydration and
 * `getConvexUser`/`requireConvexUser` and authorizes the same identity they
 * display. Failures are `ConvexCallError`s that carry the function name.
 */
export function serverConvex(
  event: H3Event,
  options: ServerConvexOptions = {},
): ServerConvexCaller {
  const normalized = validateServerConvexOptions(options)
  let tokenPromise: Promise<string | null> | null = null
  let clientPromise: Promise<ConvexHttpClient> | null = null

  const getToken = (): Promise<string | null> => {
    tokenPromise ??= resolveServerToken(event, normalized)
    return tokenPromise
  }

  const getClient = (): Promise<ConvexHttpClient> => {
    clientPromise ??= (async () => {
      const config = readEventConvexConfig(event)
      const client = new ConvexHttpClient(readRequiredConvexUrl(config.url), {
        fetch: createBoundedConvexFetch({
          signal: event.web?.request?.signal,
          maxResponseBytes: config.server.maxResponseBytes,
          queryTimeoutMs: config.server.queryTimeoutMs,
        }),
        logger: false,
      })
      const token = await getToken()
      if (token) client.setAuth(token)
      return client
    })()
    return clientPromise
  }

  const prepareClient = async (): Promise<ConvexHttpClient> => {
    const token = await getToken()
    if (normalized.auth === 'required' && !token) {
      throw authenticationRequiredError()
    }
    return getClient()
  }

  const call = async <Result>(
    reference: FunctionReference<'query' | 'mutation' | 'action'>,
    invoke: (client: ConvexHttpClient) => Promise<Result>,
  ): Promise<Result> => {
    const functionName = readFunctionName(reference)
    let client: ConvexHttpClient
    try {
      client = await prepareClient()
    } catch (error) {
      // Option and credential contract violations stay ServerConvexValidationError.
      throw error instanceof ConvexCallError ? normalizeConvexError(error, { functionName }) : error
    }
    try {
      return await invoke(client)
    } catch (error) {
      throw normalizeConvexError(error, { functionName })
    }
  }

  return {
    getToken,
    query(query, ...args) {
      return call(
        query,
        async (client) => (await client.query(query, ...args)) as FunctionReturnType<typeof query>,
      )
    },
    mutation(mutation, ...args) {
      return call(
        mutation,
        async (client) =>
          (await client.mutation(mutation, ...args)) as FunctionReturnType<typeof mutation>,
      )
    },
    action(action, ...args) {
      return call(
        action,
        async (client) =>
          (await client.action(action, ...args)) as FunctionReturnType<typeof action>,
      )
    },
  }
}

function readFunctionName(
  reference: FunctionReference<'query' | 'mutation' | 'action'>,
): string | undefined {
  try {
    return getFunctionName(reference)
  } catch {
    return undefined
  }
}
