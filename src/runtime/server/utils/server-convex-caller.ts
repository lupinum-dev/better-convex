import { ConvexHttpClient } from 'convex/browser'
import type { FunctionReference, FunctionReturnType, OptionalRestArgs } from 'convex/server'
import type { H3Event } from 'h3'

import { ConvexCallError, normalizeConvexError } from '../../errors'
import { createBoundedConvexFetch } from '../../utils/bounded-convex-fetch'
import { normalizeConvexRuntimeConfig } from '../../utils/runtime-config-normalize'
import { filterBetterAuthCookies, getBetterAuthSessionToken } from '../../utils/shared-helpers'
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

// ---------------------------------------------------------------------------
// Private per-caller configuration and cookie access.
// ---------------------------------------------------------------------------

function readCallerConfig(event: H3Event) {
  const context = event.context as {
    nitro?: { runtimeConfig?: { public?: { convex?: unknown } } }
  }
  const runtimeConfig = context.nitro?.runtimeConfig
  return normalizeConvexRuntimeConfig(runtimeConfig?.public?.convex)
}

function readRequiredConvexUrl(event: H3Event): string {
  const url = readCallerConfig(event).url
  if (!url) {
    throw new ConvexCallError({
      kind: 'unknown',
      message: 'Convex URL is not configured for serverConvex',
    })
  }
  return url
}

function readCookieHeader(event: H3Event): string | null {
  const directHeader = (event as { headers?: { get?: (name: string) => string | null } }).headers
  if (directHeader?.get) {
    return directHeader.get('cookie')
  }
  const nodeHeaders = (
    event as {
      node?: {
        req?: { headers?: Record<string, string | string[] | undefined> }
      }
    }
  ).node?.req?.headers
  const raw = nodeHeaders?.cookie
  if (Array.isArray(raw)) return raw.join('; ')
  return typeof raw === 'string' ? raw : null
}

// ---------------------------------------------------------------------------
// Token resolution ("Cookie resolution").
// ---------------------------------------------------------------------------

function authenticationRequiredError(status = 401): ConvexCallError {
  return new ConvexCallError({
    kind: 'authentication',
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

  const config = readCallerConfig(event)
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
      trustedClientIpHeader: config.auth.proxy.trustedClientIpHeader,
    })
    if (result.token) return result.token
    throwExchangeFailure(result)
  }

  // Cookie-based event resolution.
  if (normalized.auth === 'none') return null

  const cookieHeader = readCookieHeader(event)
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

  const result = await exchangeConvexToken({
    event,
    siteUrl: config.siteUrl,
    credential: { type: 'cookie', value: authCookieHeader },
    trustedClientIpHeader: config.auth.proxy.trustedClientIpHeader,
  })

  if (result.token) return result.token

  // No token. 401/403 -> anonymous for optional, authentication for required.
  // Every other failure (transport, 5xx, oversized, malformed) throws transport
  // in both modes.
  if (result.status === 401 || result.status === 403) {
    if (required) throw authenticationRequiredError(result.status)
    return null
  }
  throwExchangeFailure(result)
}

// ---------------------------------------------------------------------------
// serverConvex .
// ---------------------------------------------------------------------------

/**
 * Construct a request-scoped Convex server caller .
 *
 * The caller lazily resolves one authentication token and one
 * `ConvexHttpClient` (built with `logger: false` so arbitrary Convex function
 * log lines are not re-emitted, and the shared bounded fetch so abort, deadline,
 * response-size, and transport classification remain request-scoped). A
 * rejected token or client promise stays rejected for this caller; retrying
 * requires a new caller. Neither promise is stored on the event nor keyed by
 * option hash.
 */
export function serverConvex(
  event: H3Event,
  options: ServerConvexOptions = {},
): ServerConvexCaller {
  const normalized = validateServerConvexOptions(options)
  const boundedFetch = createBoundedConvexFetch({
    signal: event.web?.request?.signal,
  })
  let tokenPromise: Promise<string | null> | null = null
  let clientPromise: Promise<ConvexHttpClient> | null = null

  const getToken = (): Promise<string | null> => {
    tokenPromise ??= resolveServerToken(event, normalized)
    return tokenPromise
  }

  const getClient = (): Promise<ConvexHttpClient> => {
    clientPromise ??= (async () => {
      const client = new ConvexHttpClient(readRequiredConvexUrl(event), {
        fetch: boundedFetch,
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

  return {
    getToken,
    async query(query, ...args) {
      const client = await prepareClient()
      try {
        return (await client.query(query, ...args)) as FunctionReturnType<typeof query>
      } catch (error) {
        throw normalizeConvexError(error)
      }
    },
    async mutation(mutation, ...args) {
      const client = await prepareClient()
      try {
        return (await client.mutation(mutation, ...args)) as FunctionReturnType<typeof mutation>
      } catch (error) {
        throw normalizeConvexError(error)
      }
    },
    async action(action, ...args) {
      const client = await prepareClient()
      try {
        return (await client.action(action, ...args)) as FunctionReturnType<typeof action>
      } catch (error) {
        throw normalizeConvexError(error)
      }
    },
  }
}
