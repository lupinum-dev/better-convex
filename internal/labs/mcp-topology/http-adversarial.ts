import { connect } from 'node:net'

export interface RawHttpExchangeResult {
  readonly responseText: string
  readonly status: number | null
}

export interface RawHttpRequestInput {
  readonly body?: string
  readonly headers?: readonly (readonly [name: string, value: string])[]
  readonly method?: string
  readonly path?: string
}

export function rcDiscoverBody(id: number | string = 1): string {
  return JSON.stringify({
    id,
    jsonrpc: '2.0',
    method: 'server/discover',
    params: {
      _meta: {
        'io.modelcontextprotocol/clientCapabilities': {},
        'io.modelcontextprotocol/clientInfo': {
          name: 'better-convex-http-lab',
          version: '0.0.0',
        },
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
      },
    },
  })
}

export function chunkedBody(chunks: readonly string[]): string {
  return `${chunks.map((chunk) => `${Buffer.byteLength(chunk).toString(16)}\r\n${chunk}\r\n`).join('')}0\r\n\r\n`
}

export function rawHttpRequest(url: URL, input: RawHttpRequestInput): string {
  if (url.protocol !== 'http:') throw new Error('The private raw-wire lab supports HTTP only')
  const body = input.body ?? ''
  const headers = [['Host', url.host], ...(input.headers ?? [])] as const
  return `${input.method ?? 'POST'} ${input.path ?? url.pathname} HTTP/1.1\r\n${headers
    .map(([name, value]) => `${name}: ${value}\r\n`)
    .join('')}\r\n${body}`
}

function statusFromResponse(responseText: string): number | null {
  const match = /^HTTP\/1\.[01] (\d{3})(?: |\r?$)/mu.exec(responseText)
  return match?.[1] ? Number(match[1]) : null
}

/** Low-level test harness only. It never participates in either candidate runtime. */
export async function exchangeRawHttp(
  url: URL,
  request: string,
  options: { readonly keepWriteOpen?: boolean; readonly timeoutMs?: number } = {},
): Promise<RawHttpExchangeResult> {
  const port = Number(url.port || 80)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Invalid private-lab port')
  }

  return await new Promise<RawHttpExchangeResult>((resolve, reject) => {
    const socket = connect({ host: url.hostname, port })
    const chunks: Buffer[] = []
    let settled = false
    let responseTimer: ReturnType<typeof setTimeout> | undefined

    const finish = () => {
      if (settled) return
      settled = true
      if (responseTimer !== undefined) clearTimeout(responseTimer)
      socket.destroy()
      const responseText = Buffer.concat(chunks).toString('utf8')
      resolve({ responseText, status: statusFromResponse(responseText) })
    }
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      if (responseTimer !== undefined) clearTimeout(responseTimer)
      socket.destroy()
      reject(error)
    }

    socket.setTimeout(options.timeoutMs ?? 3_000, () =>
      fail(new Error('Raw HTTP exchange timed out')),
    )
    socket.on('error', fail)
    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
      if (statusFromResponse(Buffer.concat(chunks).toString('utf8')) !== null) {
        if (responseTimer !== undefined) clearTimeout(responseTimer)
        responseTimer = setTimeout(finish, 50)
      }
    })
    socket.on('end', finish)
    socket.on('close', finish)
    socket.on('connect', () => {
      if (options.keepWriteOpen) socket.write(request)
      else socket.end(request)
    })
  })
}

export async function abortRawHttp(url: URL, request: string): Promise<void> {
  const port = Number(url.port || 80)
  await new Promise<void>((resolve, reject) => {
    const socket = connect({ host: url.hostname, port })
    socket.setTimeout(2_000, () => {
      socket.destroy()
      reject(new Error('Raw HTTP abort setup timed out'))
    })
    socket.once('error', reject)
    socket.once('connect', () => {
      socket.write(request, () => {
        socket.destroy()
        resolve()
      })
    })
  })
}
