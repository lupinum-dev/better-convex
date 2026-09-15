const maximumMcpRequestBytes = 64 * 1024
const maximumMcpResponseBytes = 1024 * 1024
const mcpRequestTimeoutMs = 30_000

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
    if (bytes > maximumMcpRequestBytes) throw new McpTransportFailure(413)
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

/** SDK 2.0.0 accepts body-only versions; the 2026-07-28 HTTP binding requires this header. */
export async function missingMcpProtocolHeaderResponse(
  boundedRequest: Request,
): Promise<Response | undefined> {
  if (boundedRequest.headers.get('mcp-protocol-version')) return undefined
  // Read only the already bounded body, and only to correlate this rejection.
  // The official SDK still owns version support, envelope validation and dispatch.
  let id: string | number | null = null
  try {
    const body: unknown = await boundedRequest.json()
    if (body && typeof body === 'object' && !Array.isArray(body) && 'id' in body) {
      if (
        typeof body.id === 'string' ||
        (typeof body.id === 'number' && Number.isFinite(body.id))
      ) {
        id = body.id
      }
    }
  } catch {
    // An unparseable request has no safe correlation ID.
  }
  return Response.json(
    {
      jsonrpc: '2.0',
      id,
      error: { code: -32020, message: 'Required MCP-Protocol-Version header is missing' },
    },
    { headers: { 'cache-control': 'no-store' }, status: 400 },
  )
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

export function mcpTransportFailureResponse(error: McpTransportFailure): Response {
  return new Response(null, {
    headers: { 'cache-control': 'no-store' },
    status: error.status,
  })
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
        await reader.cancel()
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
