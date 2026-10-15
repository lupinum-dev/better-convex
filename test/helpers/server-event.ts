import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'

import { createEvent, type H3Event } from 'h3'

import type { ConvexServerEvent } from '../../src/runtime/server/utils/event'

/**
 * A web-shaped server event with the given request headers: the shape of a
 * Nuxt 5 (h3 v2) event, a Nuxt 4.6 `nuxt/server` handler event and
 * `RequestEvent`.
 */
export function webServerEvent(
  headers: HeadersInit = {},
  url = 'https://app.example.test/api/auth/test',
  init: RequestInit = {},
): ConvexServerEvent {
  return {
    req: new Request(url, { ...init, headers }),
    res: { headers: new Headers() },
    context: {},
  }
}

export interface RawH3V1Request {
  method?: string
  /** Path and query, as the browser sent them. */
  path?: string
  headers?: Record<string, string>
  /** Bytes the client sends; the request then ends. */
  body?: Uint8Array
  /** Keep the request body open (nothing more arrives until the test pushes it). */
  open?: boolean
  /** Whether Node has parsed the whole request. */
  complete?: boolean
}

/**
 * A raw h3 v1 event, as Nuxt 4 routes, SSR and the auth proxy receive it, over
 * real `node:http` objects: the request has a socket, so the proxy reads its
 * live body. The response has no socket, like a Nuxt 4 in-process request; a
 * test that needs a network response assigns `res.socket`.
 */
export function rawH3V1Event({
  method = 'GET',
  path = '/api/auth/get-session',
  headers = {},
  body,
  open = false,
  complete = true,
}: RawH3V1Request = {}): { event: H3Event; req: IncomingMessage; res: ServerResponse } {
  const req = new IncomingMessage(new Socket())
  // An HTTP/1.1 request, so the response starts with keep-alive on and a test
  // can see the proxy turn it off.
  req.httpVersionMajor = 1
  req.httpVersionMinor = 1
  req.httpVersion = '1.1'
  req.method = method
  req.url = path
  req.headers = { host: 'app.example.test', ...headers }
  req.complete = complete
  if (body) req.push(Buffer.from(body))
  if (!open) req.push(null)
  const res = new ServerResponse(req)
  return { event: createEvent(req, res), req, res }
}
