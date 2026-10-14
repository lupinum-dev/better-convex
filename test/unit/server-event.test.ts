import { IncomingMessage, ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import { Socket } from 'node:net'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createEvent, type H3Event } from 'h3'
import { describe, expect, it } from 'vitest'

import {
  eventAbortSignal,
  eventHeadersSent,
  eventNodeRequest,
  eventNodeResponse,
  eventRequestHeaders,
  eventRequestMethod,
  eventRequestUrl,
  eventResponseHeaders,
  eventWebRequest,
  type ConvexServerEvent,
} from '../../src/runtime/server/utils/event'

// Nuxt 4.6 hands `nuxt/server` handlers a Proxy over the raw h3 v1 event
// (`toPortableEvent`). @nuxt/nitro-server does not export it, so the test loads
// the file that the installed Nuxt runs.
const requireFromNuxt = createRequire(createRequire(import.meta.url).resolve('nuxt/package.json'))
const portableEventModule = pathToFileURL(
  join(
    dirname(requireFromNuxt.resolve('@nuxt/nitro-server/package.json')),
    'dist/runtime/utils/event.mjs',
  ),
).href
// Untyped JavaScript from the installed package; only this function is used.
const { toPortableEvent } = (await import(portableEventModule)) as {
  toPortableEvent: (event: H3Event) => ConvexServerEvent
}

const URL_STRING = 'https://example.test/api/auth/get-session?x=1'
const REQUEST_HEADERS = {
  host: 'example.test',
  'x-forwarded-proto': 'https',
  cookie: 'better-auth.session_token=abc; theme=dark',
  'cf-connecting-ip': '203.0.113.9',
}

function nodeRequestResponse() {
  const req = new IncomingMessage(new Socket())
  req.method = 'POST'
  req.url = '/api/auth/get-session?x=1'
  req.headers = { ...REQUEST_HEADERS }
  return { req, res: new ServerResponse(req) }
}

interface Shape {
  name: string
  create(): {
    event: ConvexServerEvent
    /** Ends the client connection, when the shape can. */
    disconnect?: () => void
    /** The Set-Cookie values the runtime will send. */
    sentSetCookies(): string[]
    nodeRes?: ServerResponse
    nodeReq?: IncomingMessage
  }
  signalBeforeDisconnect: boolean | undefined
  signalAfterDisconnect: boolean | undefined
  webRequestUrl: string | undefined
}

const shapes: Shape[] = [
  {
    // Nuxt 4: routes using h3's auto-imported defineEventHandler and the SSR
    // event. `event.req` is the IncomingMessage, so a reader that calls
    // `event.req.headers.get()` throws, and `event.res.headers` does not exist.
    name: 'raw h3 v1 event',
    create() {
      const { req, res } = nodeRequestResponse()
      return {
        event: createEvent(req, res),
        sentSetCookies: () => [res.getHeader('set-cookie') ?? []].flat().map(String),
        nodeReq: req,
        nodeRes: res,
      }
    },
    // On Node, h3 v1 has no request signal; disconnects arrive on the Node request.
    signalBeforeDisconnect: undefined,
    signalAfterDisconnect: undefined,
    webRequestUrl: undefined,
  },
  {
    // Nuxt 4.6 `nuxt/server` handlers: web-shaped on `req`/`res`, h3 v1 for
    // everything else. A header written to a copy instead of the node-backed
    // `res.headers` would never be sent.
    name: 'Nuxt 4.6 portable event',
    create() {
      const { req, res } = nodeRequestResponse()
      return {
        event: toPortableEvent(createEvent(req, res)),
        sentSetCookies: () => [res.getHeader('set-cookie') ?? []].flat().map(String),
        nodeReq: req,
        nodeRes: res,
      }
    },
    // Nuxt 4.6 builds its Request without a signal, so it never aborts.
    signalBeforeDisconnect: false,
    signalAfterDisconnect: false,
    webRequestUrl: URL_STRING,
  },
  {
    // Nuxt 5 (h3 v2) and RequestEvent: no `event.web`, so reading
    // `event.web.request.signal` silently loses client-disconnect aborts.
    name: 'web-shaped event (h3 v2, RequestEvent)',
    create() {
      const controller = new AbortController()
      const res = { headers: new Headers() }
      return {
        event: {
          req: new Request(URL_STRING, {
            method: 'POST',
            headers: REQUEST_HEADERS,
            signal: controller.signal,
          }),
          res,
          context: {},
        },
        disconnect: () => controller.abort(),
        sentSetCookies: () => res.headers.getSetCookie(),
      }
    },
    signalBeforeDisconnect: false,
    signalAfterDisconnect: true,
    webRequestUrl: URL_STRING,
  },
]

describe.each(shapes)('server event adapter: $name', (shape) => {
  it('reads the request headers, URL and method', () => {
    const { event } = shape.create()

    const headers = eventRequestHeaders(event)
    expect(headers.get('cookie')).toBe('better-auth.session_token=abc; theme=dark')
    expect(headers.get('cf-connecting-ip')).toBe('203.0.113.9')
    expect(eventRequestUrl(event).href).toBe(URL_STRING)
    expect(eventRequestMethod(event)).toBe('POST')
  })

  it('writes response headers that the runtime sends', () => {
    const created = shape.create()
    const headers = eventResponseHeaders(created.event)

    headers.set('Vary', 'Accept-Encoding')
    headers.append('set-cookie', 'a=1; Path=/')
    headers.append('set-cookie', 'b=2; Path=/')
    headers.set('cdn-cache-control', 'max-age=60')
    headers.delete('cdn-cache-control')

    expect(headers.get('vary')).toBe('Accept-Encoding')
    expect(headers.has('cdn-cache-control')).toBe(false)
    expect(headers.getSetCookie()).toEqual(['a=1; Path=/', 'b=2; Path=/'])
    expect([...new Set(headers.keys())].sort()).toEqual(['set-cookie', 'vary'])
    expect(created.sentSetCookies()).toEqual(['a=1; Path=/', 'b=2; Path=/'])
  })

  it('reports the Node objects and whether headers are on the wire', () => {
    const created = shape.create()

    expect(eventNodeRequest(created.event)).toBe(created.nodeReq)
    expect(eventNodeResponse(created.event)).toBe(created.nodeRes)
    expect(eventHeadersSent(created.event)).toBe(false)
    created.nodeRes?.flushHeaders()
    expect(eventHeadersSent(created.event)).toBe(created.nodeRes !== undefined)
  })

  it('returns the request abort signal', () => {
    const created = shape.create()

    expect(eventAbortSignal(created.event)?.aborted).toBe(shape.signalBeforeDisconnect)
    created.disconnect?.()
    expect(eventAbortSignal(created.event)?.aborted).toBe(shape.signalAfterDisconnect)
  })

  it('exposes the web Request only on web-shaped events', () => {
    const { event } = shape.create()

    expect(eventWebRequest(event)?.url).toBe(shape.webRequestUrl)
  })
})

describe('server event adapter: unsupported events', () => {
  // A reader that fell back to empty headers would treat the request as
  // anonymous and skip the trusted client-IP check instead of failing.
  it('throws instead of guessing', () => {
    expect(() => eventRequestHeaders({ context: {} })).toThrow(TypeError)
    expect(() => eventResponseHeaders({ context: {}, req: {} })).toThrow(TypeError)
  })
})
