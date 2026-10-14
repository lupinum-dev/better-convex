// One adapter for every server event shape the module receives. The SSR plugin
// (`plugin.server.ts`), app code (`query-foundation.ts`) and Nitro code all
// import this file, so it must not import `h3`, `nitropack*`, `nitro*`,
// `#imports` or `nuxt/server` at runtime: Nuxt's import protection fails the
// app build when app code imports `nuxt/server`.
import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * A Nuxt server event. The server helpers accept every shape a supported Nuxt
 * version passes:
 *
 * - Nuxt 5 (h3 v2), `nuxt/server` handlers on Nuxt 4.6, and `RequestEvent`
 *   from `nuxt/schema`: `req` is a web `Request`, `res.headers` holds the
 *   response headers.
 * - Nuxt 4 routes that use h3's auto-imported `defineEventHandler`, and the
 *   Nuxt 4 server-rendering event (`useRequestEvent()`): the raw h3 v1 event,
 *   with the Node request and response on `node`.
 *
 * The type is structural on purpose, so it names no h3 version.
 */
export interface ConvexServerEvent {
  readonly context: object
  readonly req?: object | undefined
  readonly res?: object | undefined
  readonly node?: object | undefined
}

/** The response headers of an event, as {@link eventResponseHeaders} returns them. */
export interface EventResponseHeaders {
  get(name: string): string | null
  has(name: string): boolean
  set(name: string, value: string): void
  append(name: string, value: string): void
  delete(name: string): void
  getSetCookie(): string[]
  /** Lower-case header names; a web `Headers` repeats `set-cookie` once per cookie. */
  keys(): Iterable<string>
}

/** What the accessors read of a web-shaped event. */
interface WebShapedEvent {
  readonly req: Request
  readonly res: { readonly headers: EventResponseHeaders }
}

/** What the accessors read of a raw h3 v1 event (h3 1.x `H3Event`). */
interface H3V1Event {
  readonly node: {
    readonly req: IncomingMessage & { originalUrl?: string }
    readonly res: ServerResponse
  }
  readonly headers: Headers
  readonly method: string
  readonly path: string
  readonly web?: { readonly request?: Request }
}

/**
 * The one discriminator: an event whose `req` is a web `Request` is
 * web-shaped. Every other supported event is a raw h3 v1 event, whose `req`
 * is the Node `IncomingMessage` (its `headers` is a plain object).
 *
 * TEMPORARY: the raw h3 v1 branch of each accessor below exists only while
 * the peer range includes Nuxt 4 (internals/migrations.md). Delete it, and
 * `H3V1Event`, when Nuxt 4 support ends; the web-shaped branch then stays.
 */
function isWebShaped(event: ConvexServerEvent): event is ConvexServerEvent & WebShapedEvent {
  const req = event.req
  return (
    typeof req === 'object' &&
    req !== null &&
    'headers' in req &&
    typeof req.headers === 'object' &&
    req.headers !== null &&
    'get' in req.headers &&
    typeof req.headers.get === 'function'
  )
}

function hasNodeContext(
  event: ConvexServerEvent,
): event is ConvexServerEvent & Pick<H3V1Event, 'node'> {
  const node = event.node
  return typeof node === 'object' && node !== null && 'req' in node && 'res' in node
}

function isRawH3V1(event: ConvexServerEvent): event is ConvexServerEvent & H3V1Event {
  return hasNodeContext(event) && 'headers' in event
}

/** Nuxt 4.6 marks the event it hands `nuxt/server` handlers `~portable`. */
function isPortable(event: ConvexServerEvent): boolean {
  return (event as { readonly '~portable'?: unknown })['~portable'] === true
}

/**
 * The real Node request and response, or `undefined` off Node.
 *
 * On a web-shaped event they come only from `event.req.runtime.node`, which srvx sets only
 * when the request arrived over Node's HTTP server. `event.node` is not read there: Nuxt 5's
 * Nitro v2 compatibility layer (switched on by any installed module that imports h3 or
 * nitropack) defines it as a plain bridge object without stream methods on edge runtimes and
 * for in-process requests. The raw h3 v1 event and the Nuxt 4.6 portable event carry the real
 * pair on `event.node`.
 */
function nodeContext(event: ConvexServerEvent): H3V1Event['node'] | undefined {
  if (isWebShaped(event) && !isPortable(event)) {
    const node = (
      event.req as {
        readonly runtime?: { readonly node?: Partial<H3V1Event['node']> }
      }
    ).runtime?.node
    return node?.req && node.res ? { req: node.req, res: node.res } : undefined
  }
  // TEMPORARY (Nuxt 4, internals/migrations.md): the raw h3 v1 and Nuxt 4.6 portable events.
  return hasNodeContext(event) ? event.node : undefined
}

/** The raw h3 v1 event; anything else is not a supported server event. */
function rawH3V1(event: ConvexServerEvent): H3V1Event {
  if (isRawH3V1(event)) return event
  throw new TypeError(
    'Unsupported server event: expected a web Request on event.req or an h3 v1 event with event.node',
  )
}

/** The request headers. */
export function eventRequestHeaders(event: ConvexServerEvent): Headers {
  return isWebShaped(event) ? event.req.headers : rawH3V1(event).headers
}

/**
 * The request URL. On a raw h3 v1 event it is built the way h3 1.x
 * `getRequestURL` builds it (Host header, `x-forwarded-proto: https`, the
 * original path).
 */
export function eventRequestUrl(event: ConvexServerEvent): URL {
  if (isWebShaped(event)) return new URL(event.req.url)
  const v1 = rawH3V1(event)
  const req = v1.node.req
  const host = req.headers.host || 'localhost'
  const encrypted = (req.socket as { encrypted?: boolean } | null | undefined)?.encrypted === true
  const protocol = req.headers['x-forwarded-proto'] === 'https' || encrypted ? 'https' : 'http'
  const path = (req.originalUrl || v1.path).replace(/^[/\\]+/g, '/')
  return new URL(path, `${protocol}://${host}`)
}

/** The request method, upper case. */
export function eventRequestMethod(event: ConvexServerEvent): string {
  return isWebShaped(event) ? event.req.method : rawH3V1(event).method
}

/**
 * The signal that aborts when the client disconnects, or `undefined` when the
 * runtime gives none: a raw h3 v1 event on Node, and a Nuxt 4.6 `nuxt/server`
 * handler event (Nuxt 4.6 builds that `Request` without a signal, so its
 * signal would never abort). Code that must notice a disconnect then listens on
 * {@link eventNodeRequest} / {@link eventNodeResponse}.
 */
export function eventAbortSignal(event: ConvexServerEvent): AbortSignal | undefined {
  if (!isWebShaped(event)) return rawH3V1(event).web?.request?.signal
  // TEMPORARY (Nuxt 4.6, internals/migrations.md): the portable event's signal never aborts.
  if (isPortable(event)) return undefined
  return event.req.signal
}

/** The web `Request`, or `undefined` on a raw h3 v1 event. */
export function eventWebRequest(event: ConvexServerEvent): Request | undefined {
  return isWebShaped(event) ? event.req : undefined
}

/**
 * The response headers. On a raw h3 v1 event they are read from and written
 * to the Node response, so headers set here and headers h3 or Nuxt set are
 * the same headers.
 */
export function eventResponseHeaders(event: ConvexServerEvent): EventResponseHeaders {
  return isWebShaped(event) ? event.res.headers : nodeResponseHeaders(rawH3V1(event).node.res)
}

function nodeResponseHeaders(res: ServerResponse): EventResponseHeaders {
  return {
    get(name) {
      const value = res.getHeader(name)
      if (value === undefined) return null
      return Array.isArray(value) ? value.join(', ') : String(value)
    },
    has: (name) => res.hasHeader(name),
    set(name, value) {
      res.setHeader(name, value)
    },
    append(name, value) {
      const existing = res.getHeader(name)
      if (existing === undefined) {
        res.setHeader(name, value)
        return
      }
      res.setHeader(name, [...(Array.isArray(existing) ? existing : [String(existing)]), value])
    },
    delete(name) {
      res.removeHeader(name)
    },
    getSetCookie() {
      const value = res.getHeader('set-cookie')
      if (value === undefined) return []
      return Array.isArray(value) ? value.map(String) : [String(value)]
    },
    keys: () => res.getHeaderNames(),
  }
}

/**
 * Whether the response headers are already on the wire (streaming, SSE).
 * Only a Node response can know; elsewhere this is `false`.
 */
export function eventHeadersSent(event: ConvexServerEvent): boolean {
  return eventNodeResponse(event)?.headersSent ?? false
}

/** The Node request, or `undefined` off Node (for example edge presets). */
export function eventNodeRequest(event: ConvexServerEvent): IncomingMessage | undefined {
  return nodeContext(event)?.req
}

/** The Node response, or `undefined` off Node (for example edge presets). */
export function eventNodeResponse(event: ConvexServerEvent): ServerResponse | undefined {
  return nodeContext(event)?.res
}
