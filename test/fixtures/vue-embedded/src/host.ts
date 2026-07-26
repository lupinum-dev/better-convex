import {
  createBetterConvexAttachment,
  type BetterConvexAttachedRuntime,
  type BetterConvexIdentitySnapshot,
  type ConvexClientHandle,
} from 'better-convex-vue/embedded'
import { ConvexCallError } from 'better-convex-vue/errors'
import { shallowRef } from 'vue'

import type { EmbeddedHostProof, SafeIdentityInput } from './proof-window'

let secret = ''
let snapshot: BetterConvexIdentitySnapshot & { token: string } = {
  authEnabled: true,
  settled: true,
  identityKey: 'user:alice',
  identityGeneration: 1,
  error: null,
  token: '',
}
const listeners = new Set<() => void>()
let detachCount = 0
let runtime: BetterConvexAttachedRuntime | null = null
const clientSubscriptions: Array<{ active: boolean }> = []
let stoppedClientSubscriptions = 0

function requireRuntime(): BetterConvexAttachedRuntime {
  if (!runtime) throw new Error('Host runtime is not initialized')
  return runtime
}

const proof: EmbeddedHostProof = {
  vueIdentity: shallowRef,
  initialize(nextSecret: string) {
    if (runtime) throw new Error('Host runtime is already initialized')
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
    } as unknown as ConvexClientHandle
    runtime = createBetterConvexAttachment({
      client: sourceClient,
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
    })
  },
  runtime: requireRuntime,
  snapshot: () => requireRuntime().identity.snapshot(),
  emit(next: SafeIdentityInput) {
    snapshot = { ...next, token: secret }
    for (const listener of [...listeners]) listener()
  },
  listenerCount: () => listeners.size,
  detachCount: () => detachCount,
  clientStats: () => ({
    created: clientSubscriptions.length,
    active: clientSubscriptions.filter((subscription) => subscription.active).length,
    stopped: stoppedClientSubscriptions,
  }),
}

window.__betterConvexEmbeddedHost = proof
