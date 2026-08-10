import type { ConnectionState } from 'convex/browser'
import { readonly, shallowRef, type Ref } from 'vue'

import { ConvexCallError } from '../errors'
import type { ConvexClientHandle } from './client-owner'
import type { ClientIdentityObserver, ClientIdentitySnapshot } from './identity-port'

export interface BetterConvexAttachment {
  readonly client: ConvexClientHandle
  /** Stable anonymous transport used by `auth: 'none'`. */
  readonly anonymousClient: ConvexClientHandle
  readonly identity: ClientIdentityObserver
  readonly connection?: {
    snapshot(): ConnectionState
    subscribe(listener: (state: ConnectionState) => void): () => void
  }
}

export interface AttachedClientIdentityState {
  readonly snapshot: Readonly<Ref<ClientIdentitySnapshot>>
  waitForInitialSettlement(): Promise<void>
  dispose(): void
}

function projectIdentitySnapshot(snapshot: ClientIdentitySnapshot): ClientIdentitySnapshot {
  return Object.freeze({
    authEnabled: snapshot.authEnabled,
    settled: snapshot.settled,
    identityKey: snapshot.identityKey,
    identityGeneration: snapshot.identityGeneration,
    error: snapshot.error ? new ConvexCallError(snapshot.error.toJSON()) : null,
  })
}

/** Build the opaque, stable cross-bundle boundary without refs, tokens, or a raw client. */
export function createBetterConvexAttachment(input: {
  client: ConvexClientHandle
  anonymousClient: ConvexClientHandle
  identity: ClientIdentityObserver
  connection?: BetterConvexAttachment['connection']
}): BetterConvexAttachment {
  const projectClient = (source: ConvexClientHandle): ConvexClientHandle =>
    Object.freeze({
      query: ((...args: Parameters<ConvexClientHandle['query']>) =>
        source.query(...args)) as ConvexClientHandle['query'],
      mutation: ((...args: Parameters<ConvexClientHandle['mutation']>) =>
        source.mutation(...args)) as ConvexClientHandle['mutation'],
      action: ((...args: Parameters<ConvexClientHandle['action']>) =>
        source.action(...args)) as ConvexClientHandle['action'],
      onUpdate: ((...args: Parameters<ConvexClientHandle['onUpdate']>) =>
        source.onUpdate(...args)) as ConvexClientHandle['onUpdate'],
    })
  const client = projectClient(input.client)
  const anonymousClient = projectClient(input.anonymousClient)

  const identity: ClientIdentityObserver = Object.freeze({
    snapshot: () => projectIdentitySnapshot(input.identity.snapshot()),
    waitForInitialSettlement: () => input.identity.waitForInitialSettlement(),
    subscribe(listener: () => void) {
      let active = true
      const stop = input.identity.subscribe(() => {
        if (active) listener()
      })
      return () => {
        if (!active) return
        active = false
        stop()
      }
    },
  })

  const connection = input.connection
    ? Object.freeze({
        snapshot: () => Object.freeze({ ...input.connection!.snapshot() }),
        subscribe: (listener: (state: ConnectionState) => void) =>
          input.connection!.subscribe((state) => listener(Object.freeze({ ...state }))),
      })
    : undefined
  return Object.freeze({ client, anonymousClient, identity, connection })
}

/** Convert an attached plain-object observer to refs owned by the consuming Vue copy. */
export function attachClientIdentity(
  attachment: BetterConvexAttachment,
): AttachedClientIdentityState {
  const snapshot = shallowRef(projectIdentitySnapshot(attachment.identity.snapshot()))
  let disposed = false
  const stop = attachment.identity.subscribe(() => {
    if (!disposed) snapshot.value = projectIdentitySnapshot(attachment.identity.snapshot())
  })
  // Close the snapshot-before-subscribe race without polling.
  snapshot.value = projectIdentitySnapshot(attachment.identity.snapshot())

  return {
    snapshot: readonly(snapshot),
    async waitForInitialSettlement() {
      await attachment.identity.waitForInitialSettlement()
      if (!disposed) snapshot.value = projectIdentitySnapshot(attachment.identity.snapshot())
    },
    dispose() {
      if (disposed) return
      disposed = true
      stop()
    },
  }
}
