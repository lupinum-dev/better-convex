export const maximumMcpRequestBytes = 64 * 1024
export const maximumMcpResponseBytes = 1024 * 1024
const mcpRequestTimeoutMs = 30_000
/**
 * A refused upload up to this size is read to its end before the 413 goes out. Convex's edge
 * answers 520 instead of the 413 when the action answers while the client still uploads, or with
 * an empty body (cloud smoke, 2026-10-07). Larger uploads are refused at once: reading them would
 * let a client keep the action busy.
 */
const maximumMcpRefusedUploadBytes = 4 * 1024 * 1024

export class McpTransportFailure extends Error {
  readonly status: 400 | 413 | 502 | 504

  constructor(status: McpTransportFailure['status']) {
    super('MCP transport request failed')
    this.name = 'McpTransportFailure'
    this.status = status
  }
}

export async function prepareBoundedMcpRequest(
  request: Request,
  signal: AbortSignal,
): Promise<Request> {
  const declaredLength = request.headers.get('content-length')
  if (declaredLength !== null) {
    const bytes = Number(declaredLength)
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new McpTransportFailure(400)
    if (bytes > maximumMcpRequestBytes) {
      if (request.body !== null && bytes <= maximumMcpRefusedUploadBytes) {
        await discard(request.body.getReader(), signal)
      }
      throw new McpTransportFailure(413)
    }
  }
  const headers = allowlistedMcpHeaders(request.headers)
  if (request.body === null) {
    return new Request(request.url, {
      headers,
      method: request.method,
      signal,
    })
  }

  const body = await readBoundedBody(request.body, maximumMcpRequestBytes, 413, signal)
  return new Request(request.url, {
    body,
    headers,
    method: request.method,
    signal,
  })
}

export async function boundMcpResponse(
  response: Response,
  signal?: AbortSignal,
): Promise<Response> {
  if (response.body === null) return response
  if (
    response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !==
    'application/json'
  ) {
    await response.body.cancel().catch(() => undefined)
    throw new McpTransportFailure(502)
  }
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null) {
    const bytes = Number(declaredLength)
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new McpTransportFailure(502)
    if (bytes > maximumMcpResponseBytes) throw new McpTransportFailure(502)
  }
  const body = await readBoundedBody(response.body, maximumMcpResponseBytes, 502, signal)
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  return new Response(hasNoResponseBody(response.status) ? null : body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  })
}

export async function runMcpRequestDeadline(
  requestSignal: AbortSignal,
  operation: (signal: AbortSignal) => Promise<Response>,
): Promise<Response> {
  if (requestSignal.aborted) throw requestSignal.reason
  const controller = new AbortController()
  let timedOut = false
  const abort = () => controller.abort(requestSignal.reason)
  requestSignal.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort(new McpTransportFailure(504))
  }, mcpRequestTimeoutMs)

  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<Response>((_resolve, reject) => {
        controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
          once: true,
        })
      }),
    ])
  } catch (error) {
    if (timedOut) throw new McpTransportFailure(504)
    throw error
  } finally {
    clearTimeout(timer)
    requestSignal.removeEventListener('abort', abort)
  }
}

const transportFailureMessages = {
  400: 'The request is not valid.',
  413: `The request body is larger than ${maximumMcpRequestBytes / 1024} KiB.`,
  502: 'The MCP server gave an answer that cannot be sent.',
  504: 'The MCP server did not answer in time.',
} as const

/** A JSON-RPC error with a short body: Convex's edge replaces an empty error response with a 520. */
export function mcpTransportFailureResponse(error: McpTransportFailure): Response {
  return Response.json(
    {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: transportFailureMessages[error.status] },
    },
    { headers: { 'cache-control': 'no-store' }, status: error.status },
  )
}

/** Reads a refused upload to its end, up to `maximumMcpRefusedUploadBytes`, and drops it. */
async function discard(reader: ReadableStreamDefaultReader<Uint8Array>, signal?: AbortSignal) {
  const cancel = () => void reader.cancel(signal?.reason).catch(() => undefined)
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    let total = 0
    while (total <= maximumMcpRefusedUploadBytes && !signal?.aborted) {
      const { done, value } = await reader.read()
      if (done) return
      total += value.byteLength
    }
    await reader.cancel().catch(() => undefined)
  } finally {
    signal?.removeEventListener('abort', cancel)
  }
}

async function readBoundedBody(
  stream: ReadableStream<Uint8Array>,
  maximumBytes: number,
  failureStatus: 413 | 502,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  const cancel = () => void reader.cancel(signal?.reason).catch(() => undefined)
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    while (true) {
      if (signal?.aborted) throw signal.reason
      const { done, value } = await reader.read()
      if (signal?.aborted) throw signal.reason
      if (done) break
      total += value.byteLength
      if (total > maximumBytes) {
        if (failureStatus === 413) await discard(reader, signal)
        else await reader.cancel()
        throw new McpTransportFailure(failureStatus)
      }
      chunks.push(value)
    }
  } finally {
    signal?.removeEventListener('abort', cancel)
    reader.releaseLock()
  }

  const buffer = new ArrayBuffer(total)
  const body = new Uint8Array(buffer)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return buffer
}

function allowlistedMcpHeaders(input: Headers): Headers {
  const headers = new Headers()
  for (const [name, value] of input) {
    const normalized = name.toLowerCase()
    if (
      normalized === 'accept' ||
      normalized === 'content-type' ||
      normalized === 'mcp-method' ||
      normalized === 'mcp-name' ||
      normalized === 'mcp-protocol-version' ||
      normalized.startsWith('mcp-param-')
    ) {
      headers.append(name, value)
    }
  }
  return headers
}

function hasNoResponseBody(status: number): boolean {
  return status === 204 || status === 205 || status === 304
}
