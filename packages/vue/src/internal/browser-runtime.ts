import type { ConnectionState, ConvexClient } from 'convex/browser'
import { watch } from 'vue'

import { createAttachedClientRuntime, type AttachedClientRuntime } from './attached-runtime'
import {
  createAuthAdapterIdentityPort,
  type BrowserAuthAdapter,
  type AuthAdapterIdentityPort,
} from './auth-adapter'
import {
  createConvexClientOwner,
  type ConvexClientHandle,
  type ConvexClientOwner,
  type OwnedConvexClient,
} from './client-owner'
import type { ClientIdentityObserver, ClientIdentitySnapshot } from './identity-port'

export interface BetterConvexBrowserRuntime {
  readonly handle: ConvexClientHandle
  readonly identity: ClientIdentityObserver
  readonly attachment: AttachedClientRuntime
  readonly connection: ConvexClientOwner['connection']
  /** Internal transport selection; never exposed by the public stable handle. */
  clientFor(mode: 'required' | 'optional' | 'none'): ConvexClientHandle
  ready(): Promise<void>
  refreshAuth(): Promise<void>
  dispose(): Promise<void>
}

export interface CreateBetterConvexBrowserRuntimeInput {
  clientFactory: () => OwnedConvexClient
  auth?: BrowserAuthAdapter
  onRetiredClientCloseError?: (cause: unknown) => void
}

const ANONYMOUS_SNAPSHOT: ClientIdentitySnapshot = Object.freeze({
  authEnabled: false,
  settled: true,
  identityKey: 'anonymous',
  authEpoch: 0,
  identityGeneration: 0,
  error: null,
})

const ANONYMOUS_OBSERVER: ClientIdentityObserver = Object.freeze({
  snapshot: () => ANONYMOUS_SNAPSHOT,
  waitForInitialSettlement: () => Promise.resolve(),
  subscribe: () => () => {},
})

/** Single browser-runtime constructor shared by standalone and attached Vue integrations. */
export function createBetterConvexBrowserRuntime(
  input: CreateBetterConvexBrowserRuntimeInput,
): BetterConvexBrowserRuntime {
  const authPort: AuthAdapterIdentityPort | null = input.auth
    ? createAuthAdapterIdentityPort(input.auth)
    : null
  const owner = createConvexClientOwner({
    primaryFactory: input.clientFactory,
    ...(authPort ? { anonymousFactory: input.clientFactory } : {}),
    onRetiredClientCloseError: input.onRetiredClientCloseError,
  })
  const identity = authPort ?? ANONYMOUS_OBSERVER
  let disposed = false

  if (authPort) owner.attachIdentityPort(authPort)

  const primary = owner.getPrimary()?.client
  let initial = Promise.resolve()
  if (authPort && primary && input.auth?.snapshot().status !== 'loading') {
    const initialGeneration = authPort.snapshot().identityGeneration
    initial = authPort.initializePrimary(primary as ConvexClient).catch((cause) => {
      authPort.failPrimary(initialGeneration, cause)
    })
  }

  owner.addDisposer(() => authPort?.dispose())
  const anonymousHandle: ConvexClientHandle = Object.freeze({
    query: ((...args: Parameters<ConvexClientHandle['query']>) =>
      owner.getAnonymous().query(...args)) as ConvexClientHandle['query'],
    mutation: ((...args: Parameters<ConvexClientHandle['mutation']>) =>
      owner.getAnonymous().mutation(...args)) as ConvexClientHandle['mutation'],
    action: ((...args: Parameters<ConvexClientHandle['action']>) =>
      owner.getAnonymous().action(...args)) as ConvexClientHandle['action'],
    onUpdate: ((...args: Parameters<ConvexClientHandle['onUpdate']>) =>
      owner.getAnonymous().onUpdate(...args)) as ConvexClientHandle['onUpdate'],
  }) as ConvexClientHandle
  const attachment = createAttachedClientRuntime({
    client: owner.handle,
    anonymousClient: anonymousHandle,
    identity,
    connection: {
      snapshot: () => owner.connection.state.value,
      subscribe(listener) {
        const remove = owner.connection.addConsumer()
        const stop = watch(owner.connection.state, listener, { flush: 'sync' })
        listener(owner.connection.state.value)
        return () => {
          stop()
          remove()
        }
      },
    },
  })

  return Object.freeze({
    handle: owner.handle,
    identity,
    attachment,
    connection: owner.connection,
    clientFor(mode: 'required' | 'optional' | 'none') {
      return mode === 'none' ? anonymousHandle : owner.handle
    },
    async ready() {
      await initial
      await identity.waitForInitialSettlement()
    },
    async refreshAuth() {
      await authPort?.refresh()
    },
    async dispose() {
      if (disposed) return
      disposed = true
      await owner.dispose()
    },
  })
}

export type { ConnectionState }
