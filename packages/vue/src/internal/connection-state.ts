import type { ConnectionState } from 'convex/browser'

/** Transport facts before the first browser connection, and for every SSR render. */
export const DISCONNECTED_CONNECTION_STATE: Readonly<ConnectionState> = Object.freeze({
  hasInflightRequests: false,
  isWebSocketConnected: false,
  timeOfOldestInflightRequest: null,
  hasEverConnected: false,
  connectionCount: 0,
  connectionRetries: 0,
  inflightMutations: 0,
  inflightActions: 0,
})
