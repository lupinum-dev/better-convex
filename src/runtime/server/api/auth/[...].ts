import { createError } from 'nuxt/server'

import type { AuthProxyRequest } from '../../../devtools/types'
import { getAuthCookieFlagViolation } from '../../../shared/auth-cookie'
import { normalizeClientIp, requireProxyIpSecret } from '../../../shared/client-ip'
import {
  buildAuthProxyUnreachableMessage,
  buildAuthProxyUpstreamStatusMessage,
  buildBlockedOriginMessage,
  buildMissingPublicOriginMessage,
  buildMissingSiteUrlMessage,
} from '../../../utils/auth-errors'
import { createLogger, type AuthEvent } from '../../../utils/logger'
import {
  deduplicateSetCookies,
  getSetCookieName,
  hasSetCookieDomainAttribute,
  isBetterAuthSetCookie,
} from '../../../utils/shared-helpers'
import {
  eventAbortSignal,
  eventHeadersSent,
  eventNodeRequest,
  eventNodeResponse,
  eventRequestHeaders,
  eventRequestMethod,
  eventRequestUrl,
  eventResponseHeaders,
  eventResponseHeaderTargets,
  type ConvexServerEvent,
} from '../../utils/event'
import { DEFAULT_SERVER_FETCH_TIMEOUT_MS } from '../../utils/http'
import { readServerConvexConfig } from '../../utils/server-config'
import {
  cancelResponseBody,
  DEFAULT_MAX_PROXY_REQUEST_BODY_BYTES,
  DEFAULT_MAX_PROXY_RESPONSE_BODY_BYTES,
  getRequestBodySizeError,
  getResponseBodySizeError,
  hasDeclaredRequestBody,
  readRequestBodyWithLimit,
  readResponseBodyWithLimit,
} from './body-size'
import {
  buildAuthProxyForwardHeaders,
  isSupportedProxyResponseContentEncoding,
  shouldSkipProxyResponseHeader,
} from './headers'
import { authProxyFetchMode } from './response-mode'
import {
  OAUTH_TOKEN_CORS_MAX_BODY_BYTES,
  hasPublicMetadataCredentials,
  isAllowedPublicOAuthTokenCorsPost,
  isAllowedPublicOAuthTokenCorsPreflight,
  isCrossOriginAuthRequest,
} from './security'

const AUTH_ROUTE = '/api/auth'
const ALLOWED_METHODS = new Set(['GET', 'POST'])
const PRIVATE_NO_STORE = 'private, no-store'
/** Statuses whose Response must have a null body. */
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304])
const SAFE_CAUGHT_PROXY_FAILURES = new Map<string, number>([
  ['BCN_AUTH_PROXY_COOKIE_DOMAIN_UNSUPPORTED', 502],
  ['BCN_AUTH_PROXY_COOKIE_FLAGS_UNSUPPORTED', 502],
  ['BCN_AUTH_PROXY_COOKIE_NAME_UNSUPPORTED', 502],
  ['BCN_AUTH_PROXY_METADATA_COOKIE_REJECTED', 502],
  ['BCN_AUTH_PROXY_REQUEST_BODY_CONSUMED', 500],
  ['BCN_AUTH_PROXY_REQUEST_BODY_TOO_LARGE', 413],
  ['BCN_AUTH_PROXY_TOKEN_COOKIE_REJECTED', 502],
  ['BCN_AUTH_PROXY_UPSTREAM_BODY_TOO_LARGE', 502],
  ['BCN_AUTH_PROXY_UPSTREAM_ENCODING_UNSUPPORTED', 502],
  ['BCN_AUTH_PROXY_UPSTREAM_STATUS', 502],
])

export interface AuthProxyHandlerOptions {
  allowedMethods?: readonly string[]
  /** Fixed issuer-relative path for a standards-defined public alias. */
  fixedAuthPath?: string
  /** Expose a standards-defined, credential-free metadata document to browsers. */
  publicMetadataCors?: boolean
}

/**
 * Every error the proxy catches carries `status`: `nuxt/server` errors and the
 * body size errors alike.
 */
function caughtStatus(error: unknown): unknown {
  return error && typeof error === 'object' && 'status' in error ? error.status : undefined
}

function safeCaughtProxyFailure(
  error: unknown,
): { code: string; status: number; data: Record<string, unknown> } | null {
  if (!error || typeof error !== 'object') return null
  const status = caughtStatus(error)
  const data = 'data' in error ? error.data : undefined
  if (!data || typeof data !== 'object') return null
  const code = 'code' in data && typeof data.code === 'string' ? data.code : undefined
  if (!code || SAFE_CAUGHT_PROXY_FAILURES.get(code) !== status) return null
  const violation = 'violation' in data ? data.violation : undefined
  const safeViolation =
    code === 'BCN_AUTH_PROXY_COOKIE_FLAGS_UNSUPPORTED' &&
    (violation === 'secure-missing' ||
      violation === 'httponly-missing' ||
      violation === 'samesite-none-unsupported')
      ? violation
      : undefined
  return {
    code,
    data: { code, ...(safeViolation === undefined ? {} : { violation: safeViolation }) },
    status: status as number,
  }
}

function toError(reason: unknown, fallback: string): Error {
  return reason instanceof Error ? reason : new Error(fallback)
}

function closeRequestConnection(event: ConvexServerEvent): void {
  if (eventHeadersSent(event)) return
  const nodeResponse = eventNodeResponse(event)
  if (nodeResponse) nodeResponse.shouldKeepAlive = false
  eventResponseHeaders(event).set('connection', 'close')
}

function hasUnsupportedRequestContentEncoding(headers: Headers): boolean {
  const value = headers.get('content-encoding')
  return value !== null && value.trim().toLowerCase() !== 'identity'
}

/**
 * The request-wide deadline and the client-disconnect signal of one proxied
 * request. Both abort `controller`, which the body reads and the upstream
 * fetch observe.
 *
 * Disconnects come from the Node request and response whenever the event has
 * them (Node), plus the event's abort signal whenever it has one: a raw h3 v1
 * event and a Nuxt 4.6 portable event have no usable signal, and an edge
 * runtime has no Node objects.
 */
function createAuthProxyLifecycle(event: ConvexServerEvent, startedAt: number) {
  const controller = new AbortController()
  const abort = (reason: Error) => {
    if (!controller.signal.aborted) controller.abort(reason)
  }
  const nodeRequest = eventNodeRequest(event)
  const nodeResponse = eventNodeResponse(event)
  const clientSignal = eventAbortSignal(event)
  const onRequestAborted = () => abort(new Error('Auth proxy client disconnected'))
  const onRequestClose = () => {
    if (!nodeRequest?.complete) onRequestAborted()
  }
  const onRequestError = (error: Error) => abort(error)
  const onResponseClose = () => {
    if (!nodeResponse?.writableFinished) onRequestAborted()
  }
  const onClientAbort = () => abort(toError(clientSignal?.reason, 'Auth proxy client disconnected'))

  if (nodeRequest) {
    nodeRequest.once('aborted', onRequestAborted)
    nodeRequest.once('close', onRequestClose)
    nodeRequest.once('error', onRequestError)
  }
  nodeResponse?.once('close', onResponseClose)
  clientSignal?.addEventListener('abort', onClientAbort, { once: true })

  const remainingMs = Math.max(0, DEFAULT_SERVER_FETCH_TIMEOUT_MS - (Date.now() - startedAt))
  const timeout = setTimeout(() => abort(new Error('Auth proxy deadline exceeded')), remainingMs)
  timeout.unref?.()

  let released = false
  const onDeliveryAbort = () => {
    nodeResponse?.destroy(toError(controller.signal.reason, 'Auth proxy response was aborted'))
    cleanup()
  }
  const onDeliverySettled = () => cleanup()
  function cleanup(): void {
    if (released) return
    released = true
    clearTimeout(timeout)
    if (nodeRequest) {
      nodeRequest.off('aborted', onRequestAborted)
      nodeRequest.off('close', onRequestClose)
      nodeRequest.off('error', onRequestError)
    }
    if (nodeResponse) {
      nodeResponse.off('close', onResponseClose)
      nodeResponse.off('close', onDeliverySettled)
      nodeResponse.off('finish', onDeliverySettled)
    }
    clientSignal?.removeEventListener('abort', onClientAbort)
    controller.signal.removeEventListener('abort', onDeliveryAbort)
  }

  return {
    controller,
    cleanup,
    /**
     * The handler returned a Response that the server has not written yet.
     * On a Node network response, keep the deadline and the disconnect
     * listeners until the response finishes or closes, so a client that
     * stalls the download is cut off at the deadline: then the response is
     * destroyed. An in-process request (Nuxt 4 `$fetch` inside the server:
     * a Node response without a socket) and a runtime without Node objects
     * release everything now; off Node the platform's own timeouts bound
     * the download.
     */
    releaseAfterDelivery(): void {
      if (!nodeResponse?.socket || nodeResponse.writableFinished || nodeResponse.destroyed) {
        cleanup()
        return
      }
      if (controller.signal.aborted) {
        onDeliveryAbort()
        return
      }
      controller.signal.addEventListener('abort', onDeliveryAbort, { once: true })
      nodeResponse.once('finish', onDeliverySettled)
      nodeResponse.once('close', onDeliverySettled)
    },
  }
}

async function recordAuthProxyRequestInDev(request: AuthProxyRequest): Promise<void> {
  if (!import.meta.dev) return
  try {
    const { recordAuthProxyRequest } = await import('../../../devtools/auth-proxy-registry')
    await recordAuthProxyRequest(request)
  } catch {
    // Development diagnostics must never change auth proxy behavior.
  }
}

/**
 * Whether the server has read the whole request. Only a Node request can
 * tell; elsewhere the runtime owns the connection, so it counts as complete.
 */
function requestComplete(event: ConvexServerEvent): boolean {
  return eventNodeRequest(event)?.complete ?? true
}

/**
 * The auth proxy handler. A plain function, not `defineEventHandler`: Nuxt 5's
 * `nuxt/server` wrapper buffers the whole request body before the handler
 * runs, which defeats the body limit. h3 1.x (Nuxt 4) and Nitro 3 (Nuxt 5)
 * both accept a plain function; it receives the raw h3 v1 event on Nuxt 4
 * and the h3 v2 event on Nuxt 5.
 */
export function createAuthProxyHandler(options: AuthProxyHandlerOptions = {}) {
  const allowedMethods = new Set(options.allowedMethods ?? ALLOWED_METHODS)
  const fixedAuthPath = options.fixedAuthPath
  const publicMetadataCors = options.publicMetadataCors === true
  if (
    fixedAuthPath !== undefined &&
    (!fixedAuthPath.startsWith('/') || fixedAuthPath.includes('?'))
  ) {
    throw new TypeError('Auth proxy fixed path must be one absolute path without a query')
  }

  return async (event: ConvexServerEvent): Promise<Response> => {
    // Errors are thrown, and the server renders them with the event's headers,
    // so the privacy headers go on the event before any check.
    const eventHeaders = eventResponseHeaders(event)
    eventHeaders.set('cache-control', PRIVATE_NO_STORE)
    if (publicMetadataCors) eventHeaders.set('access-control-allow-origin', '*')
    const startedAt = Date.now()
    const method = eventRequestMethod(event)
    const requestHeaders = eventRequestHeaders(event)
    const requestUrl = eventRequestUrl(event)
    const config = readServerConvexConfig()
    const auth = config.auth

    if (auth === false) {
      if (method !== 'GET' || !requestComplete(event)) closeRequestConnection(event)
      throw createError({ status: 404, message: 'Authentication is disabled' })
    }
    const traceEnabled = config.logging === 'debug'
    const requestId = import.meta.dev || traceEnabled ? crypto.randomUUID() : ''
    const logger = createLogger(traceEnabled ? 'debug' : false)
    const trace = (
      phase: string,
      outcome: AuthEvent['outcome'],
      details: Record<string, boolean | number | string> = {},
    ) => {
      if (!traceEnabled) return
      logger.auth({
        phase,
        outcome,
        details: { component: 'auth-proxy', requestId, method, ...details },
      })
    }
    const rejected = (code: string, status: number) =>
      trace('auth-proxy.request.rejected', 'error', {
        code,
        durationMs: Date.now() - startedAt,
        status,
      })
    trace('auth-proxy.request.started', 'success')
    const publicOrigin = auth.origin
    if (!publicOrigin) {
      if (method === 'POST') closeRequestConnection(event)
      rejected('BCN_AUTH_PROXY_PUBLIC_ORIGIN_MISSING', 500)
      throw createError({
        status: 500,
        message: buildMissingPublicOriginMessage(),
        data: { code: 'BCN_AUTH_PROXY_PUBLIC_ORIGIN_MISSING' },
      })
    }
    // Standards-defined metadata is intentionally credential-free and fetched
    // by servers (including Convex's JWT verifier), so it has no browser ingress
    // address to sign. Every credentialed/session route keeps the strict IP
    // requirement below.
    const trustedClientIpHeader = publicMetadataCors ? null : auth.trustedClientIpHeader
    if (trustedClientIpHeader && !normalizeClientIp(requestHeaders.get(trustedClientIpHeader))) {
      if (method === 'POST') closeRequestConnection(event)
      rejected('BCN_AUTH_PROXY_CLIENT_IP_INVALID', 400)
      throw createError({
        status: 400,
        message: 'Auth proxy request is missing a valid ingress-owned client IP',
        data: { code: 'BCN_AUTH_PROXY_CLIENT_IP_INVALID' },
      })
    }
    // Signing the client IP needs the shared secret. Report its absence as
    // configuration, not as an unreachable upstream.
    if (trustedClientIpHeader) {
      try {
        requireProxyIpSecret(process.env.BCN_AUTH_PROXY_IP_SECRET)
      } catch {
        if (method === 'POST') closeRequestConnection(event)
        rejected('BCN_AUTH_PROXY_IP_SECRET_INVALID', 500)
        throw createError({
          status: 500,
          message: 'Auth proxy client IP signing is not configured',
          data: { code: 'BCN_AUTH_PROXY_IP_SECRET_INVALID' },
        })
      }
    }
    if (publicMetadataCors && hasPublicMetadataCredentials(requestHeaders)) {
      rejected('BCN_AUTH_PROXY_METADATA_CREDENTIAL_REJECTED', 403)
      throw createError({
        status: 403,
        message: 'Public auth metadata does not accept credentials',
        data: { code: 'BCN_AUTH_PROXY_METADATA_CREDENTIAL_REJECTED' },
      })
    }
    if ((method === 'GET' || method === 'HEAD') && hasDeclaredRequestBody(requestHeaders)) {
      closeRequestConnection(event)
      rejected('BCN_AUTH_PROXY_GET_BODY_REJECTED', 400)
      throw createError({
        status: 400,
        message: 'Auth proxy GET requests must not contain a body',
        data: { code: 'BCN_AUTH_PROXY_GET_BODY_REJECTED' },
      })
    }

    if (fixedAuthPath !== undefined && (requestUrl.search || requestUrl.hash)) {
      rejected('BCN_AUTH_PROXY_METADATA_QUERY_REJECTED', 400)
      throw createError({
        status: 400,
        message: 'Auth metadata does not accept a query',
        data: { code: 'BCN_AUTH_PROXY_METADATA_QUERY_REJECTED' },
      })
    }
    const path =
      fixedAuthPath ??
      (requestUrl.pathname.startsWith(AUTH_ROUTE)
        ? requestUrl.pathname.slice(AUTH_ROUTE.length) || '/'
        : '/')
    const normalizedPath = path.startsWith('/') ? path : `/${path}`
    const hasQuery = Boolean(requestUrl.search || requestUrl.hash)
    const isPublicTokenCorsPreflight = isAllowedPublicOAuthTokenCorsPreflight(
      requestHeaders,
      method,
      publicOrigin,
      normalizedPath,
      hasQuery,
    )
    if (isPublicTokenCorsPreflight) {
      trace('auth-proxy.request.completed', 'success', {
        durationMs: Date.now() - startedAt,
        status: 204,
      })
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-headers': 'content-type',
          'access-control-allow-methods': 'POST',
          'access-control-allow-origin': '*',
          'access-control-max-age': '300',
          'cache-control': PRIVATE_NO_STORE,
        },
      })
    }
    if (!allowedMethods.has(method)) {
      closeRequestConnection(event)
      rejected('BCN_AUTH_PROXY_METHOD_REJECTED', 405)
      throw createError({ status: 405, message: 'Auth proxy method is not permitted' })
    }

    const isPublicTokenCorsPost = isAllowedPublicOAuthTokenCorsPost(
      requestHeaders,
      method,
      publicOrigin,
      normalizedPath,
      hasQuery,
    )
    if (
      !isPublicTokenCorsPost &&
      !publicMetadataCors &&
      isCrossOriginAuthRequest(requestHeaders, method, publicOrigin, normalizedPath)
    ) {
      if (method === 'POST') closeRequestConnection(event)
      rejected('BCN_AUTH_PROXY_ORIGIN_BLOCKED', 403)
      throw createError({
        status: 403,
        message: buildBlockedOriginMessage(),
        data: { code: 'BCN_AUTH_PROXY_ORIGIN_BLOCKED' },
      })
    }
    if (isPublicTokenCorsPost) eventHeaders.set('access-control-allow-origin', '*')
    if (method === 'POST' && hasUnsupportedRequestContentEncoding(requestHeaders)) {
      closeRequestConnection(event)
      rejected('BCN_AUTH_PROXY_REQUEST_ENCODING_UNSUPPORTED', 415)
      throw createError({
        status: 415,
        message: 'Auth proxy accepts only identity-encoded request bodies',
        data: { code: 'BCN_AUTH_PROXY_REQUEST_ENCODING_UNSUPPORTED' },
      })
    }

    if (!config.siteUrl) {
      if (method === 'POST') closeRequestConnection(event)
      rejected('BCN_AUTH_PROXY_SITE_URL_MISSING', 500)
      throw createError({
        status: 500,
        message: buildMissingSiteUrlMessage(),
        data: { code: 'BCN_AUTH_PROXY_SITE_URL_MISSING' },
      })
    }

    // readServerConvexConfig() already normalized and validated the site URL.
    const siteUrl = config.siteUrl
    const target = `${siteUrl}${AUTH_ROUTE}${normalizedPath}${fixedAuthPath ? '' : requestUrl.search}`
    const lifecycle = createAuthProxyLifecycle(event, startedAt)
    const { controller } = lifecycle
    let response: Response | undefined
    let proxyResponse: Response | undefined
    let requestBodyBytes = 0

    try {
      const forwardHeaders = await buildAuthProxyForwardHeaders(event, {
        trustedClientIpHeader,
        publicOrigin,
      })
      if (publicMetadataCors) delete forwardHeaders.cookie
      if (isPublicTokenCorsPost) {
        // Convex receives the proxy as the OAuth endpoint. Preserve Better
        // Auth's static trusted-origin boundary after the outer proxy has
        // admitted this one credential-free browser exchange.
        forwardHeaders.origin = publicOrigin
        delete forwardHeaders.referer
        delete forwardHeaders['sec-fetch-site']
      }
      let body: Uint8Array | undefined
      if (method === 'POST') {
        const requestBodyLimit = isPublicTokenCorsPost
          ? Math.min(DEFAULT_MAX_PROXY_REQUEST_BODY_BYTES, OAUTH_TOKEN_CORS_MAX_BODY_BYTES)
          : DEFAULT_MAX_PROXY_REQUEST_BODY_BYTES
        const sizeError = getRequestBodySizeError(
          requestHeaders.get('content-length'),
          requestBodyLimit,
        )
        if (sizeError)
          throw createError({ status: 413, message: sizeError.message, data: sizeError })
        const requestBody = await readRequestBodyWithLimit(
          event,
          requestBodyLimit,
          controller.signal,
        )
        body = requestBody
        requestBodyBytes = requestBody?.byteLength ?? 0
      }

      response = await fetch(target, {
        method,
        // Node fetch synthesizes `sec-fetch-mode: cors` from RequestInit.mode and
        // overwrites the forwarded browser header. Better Auth uses that header
        // to distinguish fetch calls (JSON redirects) from navigations (HTTP
        // redirects), so preserve the only classification it consumes.
        mode: authProxyFetchMode(method, normalizedPath, requestHeaders),
        headers: forwardHeaders,
        body: body
          ? (body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer)
          : undefined,
        redirect: 'manual',
        signal: controller.signal,
      })

      const responseCookies = response.headers.getSetCookie?.() ?? []
      if (publicMetadataCors && responseCookies.length > 0) {
        throw createError({
          status: 502,
          message: 'Public auth metadata responses must not set cookies',
          data: { code: 'BCN_AUTH_PROXY_METADATA_COOKIE_REJECTED' },
        })
      }
      if (isPublicTokenCorsPost && responseCookies.length > 0) {
        throw createError({
          status: 502,
          message: 'Public OAuth token responses must not set cookies',
          data: { code: 'BCN_AUTH_PROXY_TOKEN_COOKIE_REJECTED' },
        })
      }
      for (const cookie of responseCookies) {
        if (!isBetterAuthSetCookie(cookie)) {
          throw createError({
            status: 502,
            message: 'Auth proxy upstream returned a cookie outside the supported namespace',
            data: { code: 'BCN_AUTH_PROXY_COOKIE_NAME_UNSUPPORTED' },
          })
        }
        if (hasSetCookieDomainAttribute(cookie)) {
          throw createError({
            status: 502,
            message: 'Auth proxy does not support Domain-scoped Better Auth cookies',
            data: { code: 'BCN_AUTH_PROXY_COOKIE_DOMAIN_UNSUPPORTED' },
          })
        }
        const violation = getAuthCookieFlagViolation(cookie, getSetCookieName(cookie) ?? '')
        if (violation) {
          throw createError({
            status: 502,
            message: 'Auth proxy upstream returned a cookie with unsupported security flags',
            data: { code: 'BCN_AUTH_PROXY_COOKIE_FLAGS_UNSUPPORTED', violation },
          })
        }
      }

      if (!isSupportedProxyResponseContentEncoding(response.headers.get('content-encoding'))) {
        throw createError({
          status: 502,
          message: 'Auth proxy upstream returned an unsupported content encoding',
          data: { code: 'BCN_AUTH_PROXY_UPSTREAM_ENCODING_UNSUPPORTED' },
        })
      }

      const critical = normalizedPath === '/convex/token' || normalizedPath === '/get-session'
      if (critical && (response.status === 404 || response.status >= 500)) {
        throw createError({
          status: 502,
          message: buildAuthProxyUpstreamStatusMessage(response.status),
          data: { code: 'BCN_AUTH_PROXY_UPSTREAM_STATUS', upstreamStatus: response.status },
        })
      }

      const responseSizeError = getResponseBodySizeError(
        response.headers.get('content-length'),
        DEFAULT_MAX_PROXY_RESPONSE_BODY_BYTES,
      )
      if (responseSizeError) {
        throw createError({
          status: 502,
          message: responseSizeError.message,
          data: responseSizeError,
        })
      }
      const responseBody = await readResponseBodyWithLimit(
        response,
        DEFAULT_MAX_PROXY_RESPONSE_BODY_BYTES,
        controller.signal,
      )

      // Every header goes on the returned Response itself: h3 2.x (Nuxt 5)
      // merges event-level headers into a returned error-status Response only
      // through `event.res.errHeaders`, and writing to the Node response would
      // skip the headers h3 2.x keeps on `event.res`.
      const proxyHeaders = new Headers({ 'cache-control': PRIVATE_NO_STORE })
      if (publicMetadataCors || isPublicTokenCorsPost) {
        proxyHeaders.set('access-control-allow-origin', '*')
      }
      const upstreamCookies = deduplicateSetCookies(responseCookies)
      for (const cookie of upstreamCookies) {
        proxyHeaders.append('set-cookie', cookie)
      }
      dropStagedCookiesSetUpstream(event, upstreamCookies)
      const responseConnection = response.headers.get('connection')
      for (const [key, value] of response.headers.entries()) {
        if (!shouldSkipProxyResponseHeader(key, responseConnection)) {
          proxyHeaders.set(key, value)
        }
      }
      // A HEAD response carries no body, and a content-length of 0 would
      // misstate the GET length (RFC 9110 8.6), so it gets neither.
      const hasBody = method !== 'HEAD' && !NULL_BODY_STATUSES.has(response.status)
      if (hasBody) proxyHeaders.set('content-length', String(responseBody.byteLength))
      await recordAuthProxyRequestInDev({
        id: requestId,
        path: normalizedPath,
        method,
        timestamp: startedAt,
        status: response.status,
        duration: Date.now() - startedAt,
        success: response.ok,
      })
      trace('auth-proxy.request.completed', response.ok ? 'success' : 'error', {
        durationMs: Date.now() - startedAt,
        requestBodyBytes,
        responseBodyBytes: responseBody.byteLength,
        status: response.status,
      })
      proxyResponse = new Response(hasBody ? new Uint8Array(responseBody) : null, {
        status: response.status,
        statusText: response.statusText,
        headers: proxyHeaders,
      })
      return proxyResponse
    } catch (error) {
      cancelResponseBody(response, error)
      if (method === 'POST' && (!requestComplete(event) || caughtStatus(error) === 413)) {
        closeRequestConnection(event)
      }
      const safeFailure = safeCaughtProxyFailure(error)
      trace('auth-proxy.request.failed', 'error', {
        code: safeFailure?.code ?? 'BCN_AUTH_PROXY_UNREACHABLE',
        durationMs: Date.now() - startedAt,
        requestBodyBytes,
        status: safeFailure?.status ?? 502,
      })
      if (safeFailure) {
        throw createError({
          status: safeFailure.status,
          message: 'Auth proxy request failed',
          data: safeFailure.data,
        })
      }
      await recordAuthProxyRequestInDev({
        id: requestId,
        path: normalizedPath,
        method,
        timestamp: startedAt,
        status: 502,
        duration: Date.now() - startedAt,
        success: false,
      })
      throw createError({
        status: 502,
        message: buildAuthProxyUnreachableMessage(),
        data: { code: 'BCN_AUTH_PROXY_UNREACHABLE' },
      })
    } finally {
      if (proxyResponse) lifecycle.releaseAfterDelivery()
      else lifecycle.cleanup()
    }
  }
}

export default createAuthProxyHandler()

/**
 * The upstream auth response decides every cookie it sets. A cookie staged on
 * the event earlier in this request (a session renewal from a user helper)
 * would otherwise be merged after the returned Response on h3 2.x (Nuxt 5) and
 * undo a sign-out or an account switch.
 */
function dropStagedCookiesSetUpstream(
  event: ConvexServerEvent,
  upstreamCookies: readonly string[],
): void {
  const upstreamNames = new Set(upstreamCookies.map((cookie) => getSetCookieName(cookie)))
  if (upstreamNames.size === 0) return
  for (const headers of eventResponseHeaderTargets(event)) {
    const staged = headers.getSetCookie()
    const kept = staged.filter((cookie) => !upstreamNames.has(getSetCookieName(cookie)))
    if (kept.length === staged.length) continue
    headers.delete('set-cookie')
    for (const cookie of kept) headers.append('set-cookie', cookie)
  }
}
