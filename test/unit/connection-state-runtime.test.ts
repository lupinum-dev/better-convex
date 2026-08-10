import type { ConnectionState } from 'convex/browser'
import { describe, expect, it, vi } from 'vitest'
import { createApp, effectScope } from 'vue'

import { createBetterConvex, useConvexConnectionState } from '../../packages/vue/src'
import { createBetterConvexAttachment } from '../../packages/vue/src/embedded'

const DISCONNECTED: ConnectionState = {
  hasInflightRequests: false,
  isWebSocketConnected: false,
  timeOfOldestInflightRequest: null,
  hasEverConnected: false,
  connectionCount: 0,
  connectionRetries: 0,
  inflightMutations: 0,
  inflightActions: 0,
}

function connectionRuntime() {
  let state = DISCONNECTED
  const listeners = new Set<(next: ConnectionState) => void>()
  const client = {
    query: vi.fn(),
    mutation: vi.fn(),
    action: vi.fn(),
    onUpdate: vi.fn(),
  }
  const attachment = createBetterConvexAttachment({
    client: client as never,
    identity: {
      snapshot: () => ({
        authEnabled: false,
        settled: true,
        identityKey: 'anonymous',
        identityGeneration: 0,
        error: null,
      }),
      waitForInitialSettlement: async () => {},
      subscribe: () => () => {},
    },
    connection: {
      snapshot: () => state,
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
  })

  return {
    attachment,
    listenerCount: () => listeners.size,
    emit(patch: Partial<ConnectionState>) {
      state = { ...state, ...patch }
      for (const listener of [...listeners]) listener(state)
    },
  }
}

describe('useConvexConnectionState (Vue runtime)', () => {
  it('owns one live subscription in a plain effect scope and retires it with that scope', () => {
    const host = connectionRuntime()
    const app = createApp({})
    app.use(createBetterConvex({ runtime: host.attachment }))
    const scope = effectScope()

    const connection = app.runWithContext(() => scope.run(() => useConvexConnectionState()))!

    expect(Object.isFrozen(connection)).toBe(true)
    expect(host.listenerCount()).toBe(1)
    expect(connection.isConnected.value).toBe(false)

    host.emit({
      isWebSocketConnected: true,
      hasEverConnected: true,
      connectionCount: 1,
      inflightMutations: 1,
    })
    expect(connection.isConnected.value).toBe(true)
    expect(connection.isReconnecting.value).toBe(false)
    expect(connection.pendingMutations.value).toBe(1)

    host.emit({ isWebSocketConnected: false, connectionRetries: 1, inflightActions: 2 })
    expect(connection.isConnected.value).toBe(false)
    expect(connection.isReconnecting.value).toBe(true)
    expect(connection.pendingActions.value).toBe(2)

    scope.stop()
    expect(host.listenerCount()).toBe(0)

    host.emit({ isWebSocketConnected: true, inflightMutations: 0, inflightActions: 0 })
    expect(connection.isConnected.value).toBe(false)
    expect(connection.pendingMutations.value).toBe(1)
    expect(connection.pendingActions.value).toBe(2)
  })
})
