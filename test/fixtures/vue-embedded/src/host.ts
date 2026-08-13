import {
  createBetterConvexAttachment,
  type BetterConvexAttachment,
} from '@lupinum/better-convex-vue/embedded'
import { ConvexCallError } from '@lupinum/better-convex-vue/errors'
import type { ConnectionState } from 'convex/browser'
import { shallowRef } from 'vue'

import type { EmbeddedHostProof, SafeIdentityInput } from './proof-window'

type HostIdentitySnapshot = ReturnType<BetterConvexAttachment['identity']['snapshot']>

let secret = ''
let snapshot: HostIdentitySnapshot & { token: string } = {
  authEnabled: true,
  settled: true,
  identityKey: 'user:alice',
  identityGeneration: 1,
  error: null,
  token: '',
}
const listeners = new Set<() => void>()
let detachCount = 0
let attachment: BetterConvexAttachment | null = null
const clientSubscriptions: Array<{ active: boolean }> = []
let stoppedClientSubscriptions = 0
let ownerCloseCalls = 0
let ownerDisposeCalls = 0
let ownerSetAuthCalls = 0
let connectionState: ConnectionState = {
  hasInflightRequests: false,
  isWebSocketConnected: false,
  timeOfOldestInflightRequest: null,
  hasEverConnected: false,
  connectionCount: 0,
  connectionRetries: 0,
  inflightMutations: 0,
  inflightActions: 0,
}
const connectionListeners = new Set<(state: ConnectionState) => void>()

function requireAttachment(): BetterConvexAttachment {
  if (!attachment) throw new Error('Host attachment is not initialized')
  return attachment
}

const proof: EmbeddedHostProof = {
  vueIdentity: shallowRef,
  initialize(nextSecret: string) {
    if (attachment) throw new Error('Host attachment is already initialized')
    secret = nextSecret
    snapshot = {
      ...snapshot,
      error: new ConvexCallError({
        kind: 'authentication',
        message: 'Identity unavailable',
      }),
      token: secret,
    }
    const sourceClient = {
      query: async () => 'query',
      mutation: async () => 'mutation',
      action: async () => 'action',
      onUpdate: () => {
        const subscription = { active: true }
        clientSubscriptions.push(subscription)
        return () => {
          if (!subscription.active) return
          subscription.active = false
          stoppedClientSubscriptions += 1
        }
      },
      rawClient: { token: secret },
      close: () => {
        ownerCloseCalls += 1
      },
      dispose: () => {
        ownerDisposeCalls += 1
      },
      setAuth: () => {
        ownerSetAuthCalls += 1
      },
    } as unknown as BetterConvexAttachment['client']
    attachment = createBetterConvexAttachment({
      client: sourceClient,
      anonymousClient: sourceClient,
      identity: {
        snapshot: () => snapshot,
        waitForInitialSettlement: async () => {},
        subscribe(listener) {
          listeners.add(listener)
          return () => {
            if (!listeners.delete(listener)) return
            detachCount += 1
          }
        },
      },
      connection: {
        snapshot: () => connectionState,
        subscribe(listener) {
          connectionListeners.add(listener)
          return () => connectionListeners.delete(listener)
        },
      },
    })
  },
  attachment: requireAttachment,
  snapshot: () => requireAttachment().identity.snapshot(),
  emit(next: SafeIdentityInput) {
    snapshot = { ...next, token: secret }
    for (const listener of [...listeners]) listener()
  },
  emitConnection(connected: boolean) {
    connectionState = {
      ...connectionState,
      isWebSocketConnected: connected,
      hasEverConnected: connectionState.hasEverConnected || connected,
      connectionCount: connectionState.connectionCount + (connected ? 1 : 0),
    }
    for (const listener of [...connectionListeners]) listener(connectionState)
  },
  listenerCount: () => listeners.size,
  connectionListenerCount: () => connectionListeners.size,
  detachCount: () => detachCount,
  clientStats: () => ({
    created: clientSubscriptions.length,
    active: clientSubscriptions.filter((subscription) => subscription.active).length,
    stopped: stoppedClientSubscriptions,
  }),
  ownerControlCalls: () => ({
    close: ownerCloseCalls,
    dispose: ownerDisposeCalls,
    setAuth: ownerSetAuthCalls,
  }),
}

window.__betterConvexEmbeddedHost = proof
