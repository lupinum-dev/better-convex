import type { ConvexClient } from 'convex/browser'

import type { ConvexCallError } from '../errors'
import type { ConvexIdentityKey } from './identity-key'

/** Token-free identity observation used by every browser lifecycle controller. */
export interface ClientIdentityObserver {
  snapshot(): ClientIdentitySnapshot
  waitForInitialSettlement(): Promise<void>
  subscribe(listener: () => void): () => void
}

/**
 * Private owner-control extension implemented by an authentication adapter.
 * Browser controllers receive only {@link ClientIdentityObserver}; the client
 * owner additionally needs candidate initialization and fail-closed reporting.
 */
export interface ClientIdentityPort extends ClientIdentityObserver {
  initializePrimary(candidate: ConvexClient): Promise<void>
  failPrimary(identityGeneration: number, error: unknown): void
}

export interface ClientIdentitySnapshot {
  readonly authEnabled: boolean
  readonly settled: boolean
  readonly identityKey: ConvexIdentityKey | null
  /** Monotonic credential generation; same-subject session replacement also changes it. */
  readonly identityGeneration: number
  /** Non-null only when initial resolution failed without usable identity. */
  readonly error: ConvexCallError | null
}
