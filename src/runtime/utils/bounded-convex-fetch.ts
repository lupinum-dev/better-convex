import { ConvexCallError } from '../errors'

export const CONVEX_HTTP_QUERY_TIMEOUT_MS = 8_000
export const CONVEX_HTTP_MUTATION_TIMEOUT_MS = 15_000
export const CONVEX_HTTP_ACTION_TIMEOUT_MS = 60_000
export const CONVEX_HTTP_MAX_RESPONSE_BYTES = 1024 * 1024

const CONVEX_UDF_FAILED_STATUS = 560
const CONVEX_HTTP_UPSTREAM_FAILURE_MESSAGE =
  'The request to Convex failed before a usable response was received.'

interface BoundedConvexFetchOptions {
  fetchImpl?: typeof fetch
  maxResponseBytes?: number
  signal?: AbortSignal
  /** Test-only fixed deadline override; production derives it from the endpoint. */
  timeoutMs?: number
}

function operationTimeoutMs(input: RequestInfo | URL): number {
  let pathname: string
  try {
    pathname = new URL(input instanceof Request ? input.url : String(input)).pathname
  } catch {
    return CONVEX_HTTP_QUERY_TIMEOUT_MS
  }
  if (pathname.endsWith('/api/action')) return CONVEX_HTTP_ACTION_TIMEOUT_MS
  if (pathname.endsWith('/api/mutation')) return CONVEX_HTTP_MUTATION_TIMEOUT_MS
  return CONVEX_HTTP_QUERY_TIMEOUT_MS
}

function transportError(message: string, status?: number): ConvexCallError {
  return new ConvexCallError({ kind: 'transport', message, status })
}

function boundedResponse(
  response: Response,
  maximum: number,
  signal: AbortSignal,
  cleanup: () => void,
): Response {
  const declared = response.headers.get('content-length')
  if (declared !== null) {
    const length = Number(declared)
    if (!Number.isSafeInteger(length) || length < 0 || length > maximum) {
      cleanup()
      void response.body?.cancel().catch(() => {})
      throw transportError('Convex HTTP response exceeded the size limit', response.status)
    }
  }
  if (!response.body) {
    cleanup()
    return response
  }

  const reader = response.body.getReader()
  let total = 0
  let finished = false
  let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined
  const abortBody = () => {
    if (finished) return
    const reason =
      signal.reason instanceof ConvexCallError
        ? signal.reason
        : transportError('Convex HTTP request was aborted')
    void reader.cancel(reason).catch(() => {})
    finish()
    bodyController?.error(reason)
  }
  const finish = () => {
    if (finished) return
    finished = true
    signal.removeEventListener('abort', abortBody)
    cleanup()
    reader.releaseLock()
  }
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      bodyController = controller
      signal.addEventListener('abort', abortBody, { once: true })
      if (signal.aborted) abortBody()
    },
    async pull(controller) {
      try {
        const next = await reader.read()
        if (next.done) {
          finish()
          controller.close()
          return
        }
        total += next.value.byteLength
        if (total > maximum) {
          const error = transportError(
            'Convex HTTP response exceeded the size limit',
            response.status,
          )
          await reader.cancel(error)
          finish()
          controller.error(error)
          return
        }
        controller.enqueue(next.value)
      } catch (error) {
        finish()
        controller.error(error)
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason)
      } finally {
        finish()
      }
    },
  })
  return new Response(body, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  })
}

/**
 * One bounded Convex HTTP transport for SSR queries and request-scoped public
 * server calls. Convex owns value/protocol encoding; this boundary owns abort,
 * operation deadlines, opaque non-UDF failures, and response bytes.
 */
export function createBoundedConvexFetch(options: BoundedConvexFetchOptions = {}): typeof fetch {
  const {
    fetchImpl = fetch,
    maxResponseBytes = CONVEX_HTTP_MAX_RESPONSE_BYTES,
    signal: parentSignal,
    timeoutMs: fixedTimeoutMs,
  } = options
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) {
    throw new TypeError('CONVEX_HTTP_RESPONSE_LIMIT_INVALID')
  }
  if (fixedTimeoutMs !== undefined && (!Number.isFinite(fixedTimeoutMs) || fixedTimeoutMs <= 0)) {
    throw new TypeError('CONVEX_HTTP_TIMEOUT_INVALID')
  }

  return async (input, init) => {
    const timeoutMs = fixedTimeoutMs ?? operationTimeoutMs(input)
    const controller = new AbortController()
    const abortFromParent = () => controller.abort(parentSignal?.reason)
    if (parentSignal?.aborted) abortFromParent()
    else parentSignal?.addEventListener('abort', abortFromParent, { once: true })
    const timeout = setTimeout(
      () => controller.abort(transportError('Convex HTTP request timed out')),
      timeoutMs,
    )
    const cleanup = () => {
      clearTimeout(timeout)
      parentSignal?.removeEventListener('abort', abortFromParent)
    }

    try {
      const response = await fetchImpl(input, {
        ...init,
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!response.ok && response.status !== CONVEX_UDF_FAILED_STATUS) {
        cleanup()
        void response.body?.cancel().catch(() => {})
        throw transportError(CONVEX_HTTP_UPSTREAM_FAILURE_MESSAGE, response.status)
      }
      return boundedResponse(response, maxResponseBytes, controller.signal, cleanup)
    } catch (error) {
      cleanup()
      if (error instanceof ConvexCallError) throw error
      if (controller.signal.aborted) {
        throw transportError(
          parentSignal?.aborted
            ? 'Convex HTTP request was aborted'
            : 'Convex HTTP request timed out',
        )
      }
      throw transportError('Convex HTTP request could not complete')
    }
  }
}
