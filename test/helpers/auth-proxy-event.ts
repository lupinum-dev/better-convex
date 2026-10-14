import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'

import { createEvent, type H3Event } from 'h3'

export interface RawProxyRequest {
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
 * The raw h3 v1 event the auth proxy receives on Nuxt 4, over real `node:http`
 * objects: the request has a socket, so the proxy reads its live body. The
 * response has no socket, like a Nuxt 4 in-process request; a test that needs
 * a network response assigns `res.socket`.
 */
export function rawProxyEvent({
  method = 'GET',
  path = '/api/auth/get-session',
  headers = {},
  body,
  open = false,
  complete = true,
}: RawProxyRequest = {}): { event: H3Event; req: IncomingMessage; res: ServerResponse } {
  const req = new IncomingMessage(new Socket())
  req.method = method
  req.url = path
  req.headers = { host: 'app.example.test', ...headers }
  req.complete = complete
  if (body) req.push(Buffer.from(body))
  if (!open) req.push(null)
  const res = new ServerResponse(req)
  return { event: createEvent(req, res), req, res }
}
