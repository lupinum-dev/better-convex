import { readStreamWithByteLimit } from '../../shared/bounded-stream'
import { CONVEX_MODULE_DEFAULTS } from '../../utils/config-defaults'

export const DEFAULT_SERVER_FETCH_TIMEOUT_MS = 8_000
export const MAX_SERVER_AUTH_RESPONSE_BODY_BYTES =
  CONVEX_MODULE_DEFAULTS.authProxy.maxResponseBodyBytes

interface FetchWithTimeoutOptions extends RequestInit {
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

function createTimeoutSignal(
  timeoutMs: number,
  parentSignal?: AbortSignal,
): {
  signal: AbortSignal
  cleanup: () => void
} {
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort(new Error(`Request timed out after ${timeoutMs}ms`))
  }, timeoutMs)

  const abortFromParent = () => controller.abort(parentSignal?.reason)
  if (parentSignal) {
    if (parentSignal.aborted) {
      abortFromParent()
    } else {
      parentSignal.addEventListener('abort', abortFromParent, { once: true })
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout)
      if (parentSignal) {
        parentSignal.removeEventListener('abort', abortFromParent)
      }
    },
  }
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  options: FetchWithTimeoutOptions = {},
): Promise<Response> {
  const {
    timeoutMs = DEFAULT_SERVER_FETCH_TIMEOUT_MS,
    fetchImpl = fetch,
    signal: parentSignal,
    ...init
  } = options

  const { signal, cleanup } = createTimeoutSignal(timeoutMs, parentSignal ?? undefined)
  try {
    const response = await fetchImpl(input, {
      ...init,
      signal,
    })
    if (!response.body) {
      cleanup()
      return response
    }
    const reader = response.body.getReader()
    let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined
    let settled = false
    const finish = () => {
      if (settled) return false
      settled = true
      signal.removeEventListener('abort', abortBody)
      cleanup()
      reader.releaseLock()
      return true
    }
    const cancelBody = (reason: unknown) => {
      if (settled) return
      try {
        void reader.cancel(reason).catch(() => {})
      } finally {
        finish()
      }
    }
    const abortBody = () => {
      if (settled) return
      const reason = signal.reason ?? new Error('Request was aborted')
      cancelBody(reason)
      bodyController?.error(reason)
    }
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        bodyController = controller
        signal.addEventListener('abort', abortBody, { once: true })
        if (signal.aborted) abortBody()
      },
      async pull(controller) {
        if (settled) return
        try {
          const next = await reader.read()
          if (settled) return
          if (next.done) {
            finish()
            controller.close()
          } else {
            controller.enqueue(next.value)
          }
        } catch (error) {
          if (finish()) controller.error(error)
        }
      },
      cancel(reason) {
        cancelBody(reason)
      },
    })
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  } catch (error) {
    cleanup()
    throw error
  }
}

/**
 * Consume one JSON response within an explicit byte limit.
 *
 * The caller's fetch deadline remains active while this reads the wrapped body.
 * Empty, malformed, and oversized bodies reject; oversized streams are cancelled
 * before returning control to the caller.
 */
export async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const body = await readStreamWithByteLimit(
    response.body,
    maxBytes,
    () => new Error('Response body exceeded the size limit'),
  )
  if (!body) throw new SyntaxError('Response body is empty')
  return JSON.parse(new TextDecoder().decode(body))
}
