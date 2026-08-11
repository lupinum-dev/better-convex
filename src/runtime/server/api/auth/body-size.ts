import type { H3Event } from 'h3'
import { getRequestWebStream } from 'h3'

import { bodyChunkBytes, readStreamWithByteLimit } from '../../../shared/bounded-stream'
import { CONVEX_MODULE_DEFAULTS } from '../../../utils/config-defaults'

const H3_RAW_BODY = Symbol.for('h3RawBody')

export const DEFAULT_MAX_PROXY_REQUEST_BODY_BYTES =
  CONVEX_MODULE_DEFAULTS.authProxy.maxRequestBodyBytes
export const DEFAULT_MAX_PROXY_RESPONSE_BODY_BYTES =
  CONVEX_MODULE_DEFAULTS.authProxy.maxResponseBodyBytes

export interface ProxyBodySizeErrorShape {
  statusCode: 413 | 502
  code: 'BCN_AUTH_PROXY_REQUEST_BODY_TOO_LARGE' | 'BCN_AUTH_PROXY_UPSTREAM_BODY_TOO_LARGE'
  message: string
  contentLengthBytes: number
  maxBytes: number
}

class ProxyBodySizeLimitError extends Error implements ProxyBodySizeErrorShape {
  readonly statusCode: 413 | 502
  readonly code: ProxyBodySizeErrorShape['code']
  readonly contentLengthBytes: number
  readonly maxBytes: number
  readonly data: {
    code: ProxyBodySizeErrorShape['code']
    contentLengthBytes: number
    maxBytes: number
  }

  constructor(shape: ProxyBodySizeErrorShape) {
    super(shape.message)
    this.name = 'ProxyBodySizeLimitError'
    this.statusCode = shape.statusCode
    this.code = shape.code
    this.contentLengthBytes = shape.contentLengthBytes
    this.maxBytes = shape.maxBytes
    this.data = {
      code: shape.code,
      contentLengthBytes: shape.contentLengthBytes,
      maxBytes: shape.maxBytes,
    }
  }
}

function parseContentLengthBytes(contentLengthHeader: string | null): number | null {
  if (!contentLengthHeader) return null
  const parsed = Number(contentLengthHeader)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return Math.trunc(parsed)
}

export function getRequestBodySizeError(
  contentLengthHeader: string | null,
  maxBytes: number = DEFAULT_MAX_PROXY_REQUEST_BODY_BYTES,
): ProxyBodySizeErrorShape | null {
  const contentLengthBytes = parseContentLengthBytes(contentLengthHeader)
  if (contentLengthBytes === null || contentLengthBytes <= maxBytes) {
    return null
  }
  return {
    statusCode: 413,
    code: 'BCN_AUTH_PROXY_REQUEST_BODY_TOO_LARGE',
    message: `Auth proxy request body too large (${contentLengthBytes} bytes). Maximum allowed is ${maxBytes} bytes.`,
    contentLengthBytes,
    maxBytes,
  }
}

export function getResponseBodySizeError(
  contentLengthHeader: string | null,
  maxBytes: number = DEFAULT_MAX_PROXY_RESPONSE_BODY_BYTES,
): ProxyBodySizeErrorShape | null {
  const contentLengthBytes = parseContentLengthBytes(contentLengthHeader)
  if (contentLengthBytes === null || contentLengthBytes <= maxBytes) {
    return null
  }
  return {
    statusCode: 502,
    code: 'BCN_AUTH_PROXY_UPSTREAM_BODY_TOO_LARGE',
    message: `Auth proxy upstream response body too large (${contentLengthBytes} bytes). Maximum allowed is ${maxBytes} bytes.`,
    contentLengthBytes,
    maxBytes,
  }
}

function createRequestBodySizeError(
  observedBytes: number,
  maxBytes: number,
): ProxyBodySizeErrorShape {
  return new ProxyBodySizeLimitError({
    statusCode: 413,
    code: 'BCN_AUTH_PROXY_REQUEST_BODY_TOO_LARGE',
    message: `Auth proxy request body too large (${observedBytes} bytes read). Maximum allowed is ${maxBytes} bytes.`,
    contentLengthBytes: observedBytes,
    maxBytes,
  })
}

function createResponseBodySizeError(
  observedBytes: number,
  maxBytes: number,
): ProxyBodySizeErrorShape {
  return new ProxyBodySizeLimitError({
    statusCode: 502,
    code: 'BCN_AUTH_PROXY_UPSTREAM_BODY_TOO_LARGE',
    message: `Auth proxy upstream response body too large (${observedBytes} bytes read). Maximum allowed is ${maxBytes} bytes.`,
    contentLengthBytes: observedBytes,
    maxBytes,
  })
}

function createNodeRequestBodyStream(event: H3Event): ReadableStream<Uint8Array> {
  const request = event.node.req
  let cancel: () => void = () => {
    request.pause()
  }

  return new ReadableStream({
    start(controller) {
      let settled = false
      const cleanup = () => {
        request.off('data', onData)
        request.off('end', onEnd)
        request.off('error', onError)
        request.off('aborted', onAborted)
        request.off('close', onClose)
      }
      const finish = () => {
        if (settled) return
        settled = true
        cleanup()
        controller.close()
      }
      const fail = (error: unknown) => {
        if (settled) return
        settled = true
        cleanup()
        controller.error(error)
      }
      const onData = (value: unknown) => {
        try {
          controller.enqueue(bodyChunkBytes(value))
        } catch (error) {
          fail(error)
        }
      }
      const onEnd = () => finish()
      const onError = (error: Error) => fail(error)
      const onAborted = () => fail(new Error('Auth proxy client disconnected during upload'))
      const onClose = () => {
        if (!request.complete) onAborted()
      }

      cancel = () => {
        if (settled) return
        settled = true
        cleanup()
        // The route answers with `Connection: close`, so pausing bounds work
        // without destroying the socket before Nitro can send the error.
        request.pause()
      }

      if (request.readableEnded) {
        finish()
        return
      }
      request.on('data', onData)
      request.once('end', onEnd)
      request.once('error', onError)
      request.once('aborted', onAborted)
      request.once('close', onClose)
    },
    cancel() {
      cancel()
    },
  })
}

export async function readRequestBodyWithLimit(
  event: H3Event,
  maxBytes: number = DEFAULT_MAX_PROXY_REQUEST_BODY_BYTES,
  signal?: AbortSignal,
): Promise<Uint8Array | undefined> {
  const webBody = event.web?.request?.body
  if (webBody) {
    return await readStreamWithByteLimit(webBody, maxBytes, createRequestBodySizeError, signal)
  }

  const request = event.node.req as H3Event['node']['req'] & Record<PropertyKey, unknown>
  const hasH3Body =
    Boolean(event._requestBody) ||
    H3_RAW_BODY in request ||
    'rawBody' in request ||
    'body' in request ||
    '__unenv__' in request
  if (hasH3Body) {
    return await readStreamWithByteLimit(
      getRequestWebStream(event),
      maxBytes,
      createRequestBodySizeError,
      signal,
    )
  }

  // H3 1.15's Node request WebStream does not detach its anonymous IncomingMessage
  // listeners when cancelled. Read the real Node stream directly so a deadline or
  // limit can remove this handler's listeners before Nitro writes the error response.
  if (request.socket) {
    return await readStreamWithByteLimit(
      createNodeRequestBodyStream(event),
      maxBytes,
      createRequestBodySizeError,
      signal,
    )
  }

  return await readStreamWithByteLimit(
    getRequestWebStream(event),
    maxBytes,
    createRequestBodySizeError,
    signal,
  )
}

export async function readResponseBodyWithLimit(
  response: Response,
  maxBytes: number = DEFAULT_MAX_PROXY_RESPONSE_BODY_BYTES,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  return (
    (await readStreamWithByteLimit(response.body, maxBytes, createResponseBodySizeError, signal)) ??
    new Uint8Array()
  )
}

export function cancelResponseBody(response: Response | undefined, reason: unknown): void {
  const body = response?.body
  if (!body || body.locked) return

  try {
    void body.cancel(reason).catch(() => {})
  } catch {
    // Cancellation is best effort once the upstream stream itself has failed.
  }
}
