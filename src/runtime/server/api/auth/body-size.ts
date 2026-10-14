import type { IncomingMessage } from 'node:http'

import { bodyChunkBytes, readStreamWithByteLimit } from '../../../shared/bounded-stream'
import { CONVEX_MODULE_DEFAULTS } from '../../../utils/config-defaults'
import { eventNodeRequest, eventWebRequest, type ConvexServerEvent } from '../../utils/event'

export const DEFAULT_MAX_PROXY_REQUEST_BODY_BYTES =
  CONVEX_MODULE_DEFAULTS.authProxy.maxRequestBodyBytes
export const DEFAULT_MAX_PROXY_RESPONSE_BODY_BYTES =
  CONVEX_MODULE_DEFAULTS.authProxy.maxResponseBodyBytes

export interface ProxyBodySizeErrorShape {
  status: 413 | 502
  code: 'BCN_AUTH_PROXY_REQUEST_BODY_TOO_LARGE' | 'BCN_AUTH_PROXY_UPSTREAM_BODY_TOO_LARGE'
  message: string
  contentLengthBytes: number
  maxBytes: number
}

class ProxyBodySizeLimitError extends Error implements ProxyBodySizeErrorShape {
  readonly status: 413 | 502
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
    this.status = shape.status
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
    status: 413,
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
    status: 502,
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
    status: 413,
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
    status: 502,
    code: 'BCN_AUTH_PROXY_UPSTREAM_BODY_TOO_LARGE',
    message: `Auth proxy upstream response body too large (${observedBytes} bytes read). Maximum allowed is ${maxBytes} bytes.`,
    contentLengthBytes: observedBytes,
    maxBytes,
  })
}

function createNodeRequestBodyStream(request: IncomingMessage): ReadableStream<Uint8Array> {
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

const H3_RAW_BODY = Symbol.for('h3RawBody')

/**
 * TEMPORARY (Nuxt 4 only, internals/migrations.md "Raw h3 v1 events (Nuxt 4)"):
 * the body of a Nuxt 4 in-process request. Nitro 2's `localFetch`/`$fetch`
 * hands h3 an unenv mock request (`__unenv__`) whose body sits on `body`, and
 * h3 1.x may already hold a body (`event._requestBody` from its web adapter,
 * or a buffered `h3RawBody`, `rawBody` or `body`). This reads those bytes the
 * way h3 1.15 `getRequestWebStream`/`readRawBody` did, without importing h3.
 * Returns `undefined` when the request is not an in-process one.
 */
function inProcessRequestBodyStream(
  event: ConvexServerEvent,
  request: IncomingMessage,
): ReadableStream<unknown> | undefined {
  const fields = request as unknown as Record<PropertyKey, unknown>
  const value =
    ('_requestBody' in event ? event._requestBody : undefined) ||
    fields[H3_RAW_BODY] ||
    fields.rawBody ||
    fields.body
  // h3 1.x read a live request when none of these held a body; an unenv mock
  // request has no live stream, so its missing body is an empty one.
  if (!value && !('__unenv__' in request)) return undefined
  if (value instanceof ReadableStream) return value
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const bytes = await inProcessBodyBytes(await value)
        if (bytes.byteLength > 0) controller.enqueue(bytes)
        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  })
}

/** One buffered in-process body value as bytes (h3 1.15 `readRawBody` conversions). */
async function inProcessBodyBytes(value: unknown): Promise<Uint8Array> {
  if (!value) return new Uint8Array()
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }
  if (typeof value === 'string') return new TextEncoder().encode(value)
  if (value instanceof ReadableStream) return await new Response(value).bytes()
  if (value instanceof URLSearchParams) return new TextEncoder().encode(value.toString())
  if (value instanceof FormData) return await new Response(value).bytes()
  if (isNodeReadable(value)) return await readNodeReadable(value)
  if (typeof value === 'object' && value.constructor === Object) {
    return new TextEncoder().encode(JSON.stringify(value))
  }
  throw new TypeError('[better-convex-nuxt] In-process request body has an unsupported type.')
}

interface NodeReadable {
  on(event: 'data', listener: (chunk: unknown) => void): unknown
  once(event: 'end', listener: () => void): unknown
  once(event: 'error', listener: (error: Error) => void): unknown
}

function isNodeReadable(value: unknown): value is NodeReadable {
  return (
    typeof value === 'object' &&
    value !== null &&
    'pipe' in value &&
    typeof value.pipe === 'function' &&
    'on' in value &&
    typeof value.on === 'function'
  )
}

function readNodeReadable(stream: NodeReadable): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []
    stream.on('data', (chunk) => {
      try {
        chunks.push(bodyChunkBytes(chunk))
      } catch (error) {
        reject(error)
      }
    })
    stream.once('end', () => resolve(concatBytes(chunks)))
    stream.once('error', reject)
  })
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0))
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

/**
 * The request body as a stream, from exactly one source:
 *
 * 1. a Nuxt 4 in-process request (see {@link inProcessRequestBodyStream});
 * 2. a Node network request (a Node request with a socket): the live
 *    `IncomingMessage`, read directly so a limit or deadline can detach this
 *    handler's listeners before the error response is written;
 * 3. everything else (a web-shaped event without Node, for example Nitro 3
 *    `serverFetch` or an edge preset): the web `Request` body.
 */
function requestBodyStream(event: ConvexServerEvent): ReadableStream<unknown> | null | undefined {
  const nodeRequest = eventNodeRequest(event)
  if (nodeRequest) {
    const inProcess = inProcessRequestBodyStream(event, nodeRequest)
    if (inProcess) return inProcess
    if (nodeRequest.socket) return createNodeRequestBodyStream(nodeRequest)
  }
  return eventWebRequest(event)?.body
}

export async function readRequestBodyWithLimit(
  event: ConvexServerEvent,
  maxBytes: number = DEFAULT_MAX_PROXY_REQUEST_BODY_BYTES,
  signal?: AbortSignal,
): Promise<Uint8Array | undefined> {
  return await readStreamWithByteLimit(
    requestBodyStream(event),
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
