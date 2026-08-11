import type { BetterConvexAttachment } from 'better-convex-vue/embedded'

export interface SafeIdentityInput {
  authEnabled: boolean
  settled: boolean
  identityKey: 'anonymous' | `user:${string}`
  identityGeneration: number
  error: null
}

export interface EmbeddedHostProof {
  vueIdentity: unknown
  initialize(secret: string): void
  attachment(): BetterConvexAttachment
  snapshot(): unknown
  emit(snapshot: SafeIdentityInput): void
  emitConnection(connected: boolean): void
  listenerCount(): number
  connectionListenerCount(): number
  detachCount(): number
  clientStats(): { created: number; active: number; stopped: number }
  ownerControlCalls(): { close: number; dispose: number; setAuth: number }
}

export interface EmbeddedConsumerProof {
  vueIdentity: unknown
  attach(): unknown
  snapshot(): unknown
  clientKeys(): string[]
  unmount(): unknown
}

declare global {
  interface Window {
    __betterConvexEmbeddedHost?: EmbeddedHostProof
    __betterConvexEmbeddedConsumer?: EmbeddedConsumerProof
  }
}
