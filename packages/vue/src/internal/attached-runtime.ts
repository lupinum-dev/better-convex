import type { ConnectionState } from 'convex/browser'
import { readonly, shallowRef, type Ref } from 'vue'

import { ConvexCallError } from '../errors'
import type { ConvexClientHandle } from './client-owner'
import type { ClientIdentityObserver, ClientIdentitySnapshot } from './identity-port'

export interface AttachedClientRuntime {
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
    error: snapshot.error
      ? new ConvexCallError({
          kind: snapshot.error.kind,
          message: snapshot.error.message,
          code: snapshot.error.code,
          status: snapshot.error.status,
          data: snapshot.error.data,
        })
      : null,
  })
}

/** Build the opaque, stable cross-bundle boundary without refs, tokens, or a raw client. */
export function createAttachedClientRuntime(input: {
  client: ConvexClientHandle
  anonymousClient?: ConvexClientHandle
  identity: ClientIdentityObserver
  connection?: AttachedClientRuntime['connection']
}): AttachedClientRuntime {
  const projectClient = (source: ConvexClientHandle): ConvexClientHandle =>
    Object.freeze({
      query: source.query,
      mutation: source.mutation,
      action: source.action,
      onUpdate: source.onUpdate,
    })
  const client = projectClient(input.client)
  const anonymousClient = projectClient(input.anonymousClient ?? input.client)

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
        snapshot: () => ({ ...input.connection!.snapshot() }),
        subscribe: (listener: (state: ConnectionState) => void) =>
          input.connection!.subscribe((state) => listener({ ...state })),
      })
    : undefined
  return Object.freeze({ client, anonymousClient, identity, connection })
}

/** Convert an attached plain-object observer to refs owned by the consuming Vue copy. */
export function attachClientIdentity(runtime: AttachedClientRuntime): AttachedClientIdentityState {
  const snapshot = shallowRef(projectIdentitySnapshot(runtime.identity.snapshot()))
  let disposed = false
  const stop = runtime.identity.subscribe(() => {
    if (!disposed) snapshot.value = projectIdentitySnapshot(runtime.identity.snapshot())
  })
  // Close the snapshot-before-subscribe race without polling.
  snapshot.value = projectIdentitySnapshot(runtime.identity.snapshot())

  return {
    snapshot: readonly(snapshot),
    async waitForInitialSettlement() {
      await runtime.identity.waitForInitialSettlement()
      if (!disposed) snapshot.value = projectIdentitySnapshot(runtime.identity.snapshot())
    },
    dispose() {
      if (disposed) return
      disposed = true
      stop()
    },
  }
}
