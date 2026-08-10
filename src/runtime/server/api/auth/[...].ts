import type { H3Event } from 'h3'
import {
  appendResponseHeader,
  createError,
  defineEventHandler,
  getRequestURL,
  send,
  setHeaders,
  setResponseStatus,
} from 'h3'

import type { AuthProxyRequest } from '../../../devtools/types'
import { normalizeClientIp } from '../../../shared/client-ip'
import {
  getPackedRuntimeFingerprint,
  PACKED_RUNTIME_FINGERPRINT_HEADER,
} from '../../../shared/release-fingerprint'
import {
  buildAuthProxyUnreachableMessage,
  buildAuthProxyUpstreamStatusMessage,
  buildBlockedOriginMessage,
  buildMissingPublicOriginMessage,
  buildMissingSiteUrlMessage,
} from '../../../utils/auth-errors'
import { createLogger } from '../../../utils/logger'
import { getConvexRuntimeConfig } from '../../../utils/runtime-config'
import { hasSetCookieDomainAttribute, isBetterAuthSetCookie } from '../../../utils/shared-helpers'
import { normalizeConvexSiteUrl } from '../../../utils/site-url'
import { DEFAULT_SERVER_FETCH_TIMEOUT_MS } from '../../utils/http'
import {
  cancelResponseBody,
  DEFAULT_MAX_PROXY_REQUEST_BODY_BYTES,
  DEFAULT_MAX_PROXY_RESPONSE_BODY_BYTES,
  getRequestBodySizeError,
  getResponseBodySizeError,
  readRequestBodyWithLimit,
  readResponseBodyWithLimit,
} from './body-size'
import {
  buildAuthProxyForwardHeaders,
  isSupportedProxyResponseContentEncoding,
  shouldSkipProxyResponseHeader,
} from './headers'
import {
  OAUTH_TOKEN_CORS_MAX_BODY_BYTES,
  hasPublicAuthCorsCredentials,
  isAllowedPublicOAuthTokenCorsPost,
  isAllowedPublicOAuthTokenCorsPreflight,
  isCrossOriginAuthRequest,
} from './security'

const AUTH_ROUTE = '/api/auth'
const ALLOWED_METHODS = new Set(['GET', 'POST'])
const SAFE_CAUGHT_PROXY_FAILURES = new Map<string, number>([
  ['BCN_AUTH_PROXY_COOKIE_DOMAIN_UNSUPPORTED', 502],
  ['BCN_AUTH_PROXY_COOKIE_NAME_UNSUPPORTED', 502],
  ['BCN_AUTH_PROXY_METADATA_COOKIE_REJECTED', 502],
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

function safeCaughtProxyFailure(error: unknown): { code: string; statusCode: number } | null {
  if (!error || typeof error !== 'object') return null
  const statusCode = 'statusCode' in error ? error.statusCode : undefined
  const data = 'data' in error ? error.data : undefined
  const code =
    data && typeof data === 'object' && 'code' in data && typeof data.code === 'string'
      ? data.code
      : undefined
  if (!code || SAFE_CAUGHT_PROXY_FAILURES.get(code) !== statusCode) return null
  return { code, statusCode: statusCode as number }
}

function toError(reason: unknown, fallback: string): Error {
  return reason instanceof Error ? reason : new Error(fallback)
}

function closeRequestConnection(event: H3Event): void {
  if (event.node.res.headersSent) return
  event.node.res.shouldKeepAlive = false
  setHeaders(event, { connection: 'close' })
}

function hasFramedGetBody(headers: Headers): boolean {
  if (headers.has('transfer-encoding')) return true
  const contentLength = headers.get('content-length')
  if (contentLength === null) return false
  try {
    return BigInt(contentLength.trim()) !== 0n
  } catch {
    return true
  }
}

function hasUnsupportedRequestContentEncoding(headers: Headers): boolean {
  const value = headers.get('content-encoding')
  return value !== null && value.trim().toLowerCase() !== 'identity'
}

function createAuthProxyLifecycle(event: H3Event, startedAt: number) {
  const controller = new AbortController()
  const abort = (reason: Error) => {
    if (!controller.signal.aborted) controller.abort(reason)
  }
  const onRequestAborted = () => abort(new Error('Auth proxy client disconnected'))
  const onRequestClose = () => {
    if (!event.node.req.complete) onRequestAborted()
  }
  const onRequestError = (error: Error) => abort(error)
  const onResponseClose = () => {
    if (!event.node.res.writableFinished) onRequestAborted()
  }
  const onWebAbort = () =>
    abort(toError(event.web?.request?.signal.reason, 'Auth proxy client disconnected'))

  event.node.req.once('aborted', onRequestAborted)
  event.node.req.once('close', onRequestClose)
  event.node.req.once('error', onRequestError)
  event.node.res.once('close', onResponseClose)
  event.web?.request?.signal.addEventListener('abort', onWebAbort, { once: true })

  const remainingMs = Math.max(0, DEFAULT_SERVER_FETCH_TIMEOUT_MS - (Date.now() - startedAt))
  const timeout = setTimeout(() => abort(new Error('Auth proxy deadline exceeded')), remainingMs)
  timeout.unref?.()

  return {
    controller,
    cleanup() {
      clearTimeout(timeout)
      event.node.req.off('aborted', onRequestAborted)
      event.node.req.off('close', onRequestClose)
      event.node.req.off('error', onRequestError)
      event.node.res.off('close', onResponseClose)
      event.web?.request?.signal.removeEventListener('abort', onWebAbort)
    },
  }
}

async function sendAuthProxyBody(
  event: H3Event,
  body: Uint8Array,
  signal: AbortSignal,
): Promise<void> {
  if (!event.node.res.socket) {
    await send(event, body)
    return
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort)
      event.node.res.off('finish', onFinish)
      event.node.res.off('close', onClose)
      event.node.res.off('error', onError)
    }
    const succeed = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve()
    }
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(toError(error, 'Auth proxy response failed'))
    }
    const onFinish = () => succeed()
    const onClose = () => {
      if (event.node.res.writableFinished) succeed()
      else fail(new Error('Auth proxy client disconnected during download'))
    }
    const onError = (error: Error) => fail(error)
    const onAbort = () => {
      const error = toError(signal.reason, 'Auth proxy response was aborted')
      fail(error)
      event.node.res.destroy(error)
    }

    event.node.res.once('finish', onFinish)
    event.node.res.once('close', onClose)
    event.node.res.once('error', onError)
    signal.addEventListener('abort', onAbort, { once: true })

    if (signal.aborted) {
      onAbort()
      return
    }
    try {
      event.node.res.end(body)
    } catch (error) {
      fail(error)
    }
  })
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

  return defineEventHandler(async (event: H3Event) => {
    setHeaders(event, { 'cache-control': 'private, no-store' })
    const runtimeFingerprint = getPackedRuntimeFingerprint()
    if (runtimeFingerprint) {
      setHeaders(event, { [PACKED_RUNTIME_FINGERPRINT_HEADER]: runtimeFingerprint })
    }
    if (publicMetadataCors) setHeaders(event, { 'access-control-allow-origin': '*' })
    const startedAt = Date.now()
    const requestUrl = getRequestURL(event)
    const config = getConvexRuntimeConfig()
    const auth = config.auth

    if (auth === false) {
      if (event.method !== 'GET' || !event.node.req.complete) closeRequestConnection(event)
      throw createError({ statusCode: 404, message: 'Authentication is disabled' })
    }
    const traceEnabled = config.logging === 'debug'
    const requestId = import.meta.dev || traceEnabled ? crypto.randomUUID() : ''
    const logger = createLogger(traceEnabled ? 'debug' : false)
    const trace = (
      phase: string,
      outcome: 'success' | 'error' | 'skip' | 'miss',
      details: Record<string, boolean | number | string> = {},
    ) => {
      if (!traceEnabled) return
      logger.auth({
        phase,
        outcome,
        details: { component: 'auth-proxy', requestId, method: event.method, ...details },
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
      if (event.method === 'POST') closeRequestConnection(event)
      rejected('BCN_AUTH_PROXY_PUBLIC_ORIGIN_MISSING', 500)
      throw createError({
        statusCode: 500,
        message: buildMissingPublicOriginMessage(),
        data: { code: 'BCN_AUTH_PROXY_PUBLIC_ORIGIN_MISSING' },
      })
    }
    // Standards-defined metadata is intentionally credential-free and fetched
    // by servers (including Convex's JWT verifier), so it has no browser ingress
    // address to sign. Every credentialed/session route keeps the strict IP
    // requirement below.
    const trustedClientIpHeader = publicMetadataCors ? null : auth.trustedClientIpHeader
    if (trustedClientIpHeader && !normalizeClientIp(event.headers.get(trustedClientIpHeader))) {
      if (event.method === 'POST') closeRequestConnection(event)
      rejected('BCN_AUTH_PROXY_CLIENT_IP_INVALID', 400)
      throw createError({
        statusCode: 400,
        message: 'Auth proxy request is missing a valid ingress-owned client IP',
        data: { code: 'BCN_AUTH_PROXY_CLIENT_IP_INVALID' },
      })
    }
    if (publicMetadataCors && hasPublicAuthCorsCredentials(event.headers)) {
      rejected('BCN_AUTH_PROXY_METADATA_CREDENTIAL_REJECTED', 403)
      throw createError({
        statusCode: 403,
        message: 'Public auth metadata does not accept credentials',
        data: { code: 'BCN_AUTH_PROXY_METADATA_CREDENTIAL_REJECTED' },
      })
    }
    if ((event.method === 'GET' || event.method === 'HEAD') && hasFramedGetBody(event.headers)) {
      closeRequestConnection(event)
      rejected('BCN_AUTH_PROXY_GET_BODY_REJECTED', 400)
      throw createError({
        statusCode: 400,
        message: 'Auth proxy GET requests must not contain a body',
        data: { code: 'BCN_AUTH_PROXY_GET_BODY_REJECTED' },
      })
    }

    if (fixedAuthPath !== undefined && (requestUrl.search || requestUrl.hash)) {
      rejected('BCN_AUTH_PROXY_METADATA_QUERY_REJECTED', 400)
      throw createError({ statusCode: 400, message: 'Auth metadata does not accept a query' })
    }
    const path =
      fixedAuthPath ??
      (requestUrl.pathname.startsWith(AUTH_ROUTE)
        ? requestUrl.pathname.slice(AUTH_ROUTE.length) || '/'
        : '/')
    const normalizedPath = path.startsWith('/') ? path : `/${path}`
    const hasQuery = Boolean(requestUrl.search || requestUrl.hash)
    const isPublicTokenCorsPreflight = isAllowedPublicOAuthTokenCorsPreflight(
      event.headers,
      event.method,
      publicOrigin,
      normalizedPath,
      hasQuery,
    )
    if (isPublicTokenCorsPreflight) {
      setResponseStatus(event, 204)
      setHeaders(event, {
        'access-control-allow-headers': 'content-type',
        'access-control-allow-methods': 'POST',
        'access-control-allow-origin': '*',
        'access-control-max-age': 300,
      })
      trace('auth-proxy.request.completed', 'success', {
        durationMs: Date.now() - startedAt,
        status: 204,
      })
      await send(event, '')
      return
    }
    if (!allowedMethods.has(event.method)) {
      closeRequestConnection(event)
      rejected('BCN_AUTH_PROXY_METHOD_REJECTED', 405)
      throw createError({ statusCode: 405, message: 'Auth proxy method is not permitted' })
    }

    const isPublicTokenCorsPost = isAllowedPublicOAuthTokenCorsPost(
      event.headers,
      event.method,
      publicOrigin,
      normalizedPath,
      hasQuery,
    )
    if (
      !isPublicTokenCorsPost &&
      !publicMetadataCors &&
      isCrossOriginAuthRequest(event.headers, event.method, publicOrigin, normalizedPath)
    ) {
      if (event.method === 'POST') closeRequestConnection(event)
      rejected('BCN_AUTH_PROXY_ORIGIN_BLOCKED', 403)
      throw createError({
        statusCode: 403,
        message: buildBlockedOriginMessage(),
        data: { code: 'BCN_AUTH_PROXY_ORIGIN_BLOCKED' },
      })
    }
    if (isPublicTokenCorsPost) setHeaders(event, { 'access-control-allow-origin': '*' })
    if (event.method === 'POST' && hasUnsupportedRequestContentEncoding(event.headers)) {
      closeRequestConnection(event)
      rejected('BCN_AUTH_PROXY_REQUEST_ENCODING_UNSUPPORTED', 415)
      throw createError({
        statusCode: 415,
        message: 'Auth proxy accepts only identity-encoded request bodies',
        data: { code: 'BCN_AUTH_PROXY_REQUEST_ENCODING_UNSUPPORTED' },
      })
    }

    if (!config.siteUrl) {
      if (event.method === 'POST') closeRequestConnection(event)
      rejected('BCN_AUTH_PROXY_SITE_URL_MISSING', 500)
      throw createError({
        statusCode: 500,
        message: buildMissingSiteUrlMessage(),
        data: { code: 'BCN_AUTH_PROXY_SITE_URL_MISSING' },
      })
    }

    let siteUrl: string
    try {
      siteUrl = normalizeConvexSiteUrl(config.siteUrl)
    } catch {
      if (event.method === 'POST') closeRequestConnection(event)
      rejected('BCN_AUTH_PROXY_SITE_URL_INVALID', 500)
      throw createError({
        statusCode: 500,
        message: 'Auth proxy site URL configuration is invalid',
        data: { code: 'BCN_AUTH_PROXY_SITE_URL_INVALID' },
      })
    }
    const target = `${siteUrl}${AUTH_ROUTE}${normalizedPath}${fixedAuthPath ? '' : requestUrl.search}`
    const lifecycle = createAuthProxyLifecycle(event, startedAt)
    const { controller } = lifecycle
    let response: Response | undefined
    let requestBodyBytes = 0

    try {
      const forwardHeaders = await buildAuthProxyForwardHeaders(event, {
        trustedClientIpHeader,
      })
      if (isPublicTokenCorsPost) {
        // Convex receives the proxy as the OAuth endpoint. Preserve Better
        // Auth's static trusted-origin boundary after the outer proxy has
        // admitted this one credential-free browser exchange.
        forwardHeaders.origin = publicOrigin
        delete forwardHeaders.referer
        delete forwardHeaders['sec-fetch-site']
      }
      let body: Uint8Array | undefined
      if (event.method === 'POST') {
        const requestBodyLimit = isPublicTokenCorsPost
          ? Math.min(DEFAULT_MAX_PROXY_REQUEST_BODY_BYTES, OAUTH_TOKEN_CORS_MAX_BODY_BYTES)
          : DEFAULT_MAX_PROXY_REQUEST_BODY_BYTES
        const sizeError = getRequestBodySizeError(
          event.headers.get('content-length'),
          requestBodyLimit,
        )
        if (sizeError)
          throw createError({ statusCode: 413, message: sizeError.message, data: sizeError })
        const requestBody = await readRequestBodyWithLimit(
          event,
          requestBodyLimit,
          controller.signal,
        )
        body = requestBody
        requestBodyBytes = requestBody?.byteLength ?? 0
      }

      response = await fetch(target, {
        method: event.method,
        // Node fetch synthesizes `sec-fetch-mode: cors` from RequestInit.mode and
        // overwrites the forwarded browser header. Better Auth uses that header
        // to distinguish fetch calls (JSON redirects) from navigations (HTTP
        // redirects), so preserve the only classification it consumes.
        mode: event.headers.get('sec-fetch-mode') === 'cors' ? 'cors' : 'same-origin',
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
          statusCode: 502,
          message: 'Public auth metadata responses must not set cookies',
          data: { code: 'BCN_AUTH_PROXY_METADATA_COOKIE_REJECTED' },
        })
      }
      if (isPublicTokenCorsPost && responseCookies.length > 0) {
        throw createError({
          statusCode: 502,
          message: 'Public OAuth token responses must not set cookies',
          data: { code: 'BCN_AUTH_PROXY_TOKEN_COOKIE_REJECTED' },
        })
      }
      for (const cookie of responseCookies) {
        if (!isBetterAuthSetCookie(cookie)) {
          throw createError({
            statusCode: 502,
            message: 'Auth proxy upstream returned a cookie outside the supported namespace',
            data: { code: 'BCN_AUTH_PROXY_COOKIE_NAME_UNSUPPORTED' },
          })
        }
        if (hasSetCookieDomainAttribute(cookie)) {
          throw createError({
            statusCode: 502,
            message: 'Auth proxy does not support Domain-scoped Better Auth cookies',
            data: { code: 'BCN_AUTH_PROXY_COOKIE_DOMAIN_UNSUPPORTED' },
          })
        }
      }

      if (!isSupportedProxyResponseContentEncoding(response.headers.get('content-encoding'))) {
        throw createError({
          statusCode: 502,
          message: 'Auth proxy upstream returned an unsupported content encoding',
          data: { code: 'BCN_AUTH_PROXY_UPSTREAM_ENCODING_UNSUPPORTED' },
        })
      }

      const critical = normalizedPath === '/convex/token' || normalizedPath === '/get-session'
      if (critical && (response.status === 404 || response.status >= 500)) {
        throw createError({
          statusCode: 502,
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
          statusCode: 502,
          message: responseSizeError.message,
          data: responseSizeError,
        })
      }
      const responseBody = await readResponseBodyWithLimit(
        response,
        DEFAULT_MAX_PROXY_RESPONSE_BODY_BYTES,
        controller.signal,
      )

      setResponseStatus(event, response.status, response.statusText)
      for (const cookie of responseCookies) {
        appendResponseHeader(event, 'set-cookie', cookie)
      }
      const responseConnection = response.headers.get('connection')
      for (const [key, value] of response.headers.entries()) {
        if (!shouldSkipProxyResponseHeader(key, responseConnection)) {
          setHeaders(event, { [key]: value })
        }
      }
      await recordAuthProxyRequestInDev({
        id: requestId,
        path: normalizedPath,
        method: event.method,
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
      await sendAuthProxyBody(event, responseBody, controller.signal)
    } catch (error) {
      cancelResponseBody(response, error)
      if (
        event.method === 'POST' &&
        (!event.node.req.complete ||
          (error &&
            typeof error === 'object' &&
            'statusCode' in error &&
            error.statusCode === 413)) &&
        !event.node.res.headersSent
      ) {
        closeRequestConnection(event)
      }
      const safeFailure = safeCaughtProxyFailure(error)
      trace('auth-proxy.request.failed', 'error', {
        code: safeFailure?.code ?? 'BCN_AUTH_PROXY_UNREACHABLE',
        durationMs: Date.now() - startedAt,
        requestBodyBytes,
        status: safeFailure?.statusCode ?? 502,
      })
      if (safeFailure) {
        throw createError({
          statusCode: safeFailure.statusCode,
          message: 'Auth proxy request failed',
          data: { code: safeFailure.code },
        })
      }
      await recordAuthProxyRequestInDev({
        id: requestId,
        path: normalizedPath,
        method: event.method,
        timestamp: startedAt,
        status: 502,
        duration: Date.now() - startedAt,
        success: false,
      })
      throw createError({
        statusCode: 502,
        message: buildAuthProxyUnreachableMessage(),
        data: { code: 'BCN_AUTH_PROXY_UNREACHABLE' },
      })
    } finally {
      lifecycle.cleanup()
    }
  })
}

export default createAuthProxyHandler()
