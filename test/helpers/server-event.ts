import type { ConvexServerEvent } from '../../src/runtime/server/utils/event'

/**
 * A web-shaped server event with the given request headers: the shape of a
 * Nuxt 5 (h3 v2) event, a Nuxt 4.6 `nuxt/server` handler event and
 * `RequestEvent`.
 */
export function webServerEvent(
  headers: HeadersInit = {},
  url = 'https://app.example.test/api/auth/test',
): ConvexServerEvent {
  return { req: new Request(url, { headers }), res: { headers: new Headers() }, context: {} }
}
