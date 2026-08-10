// @vitest-environment happy-dom
import type { ConnectionState } from 'convex/browser'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h } from 'vue'

import { createBetterConvex, useConvex, useConvexConnectionState } from '../../packages/vue/src'
import { createBetterConvexAttachment } from '../../packages/vue/src/embedded'
import { ConvexCallError } from '../../packages/vue/src/errors'
import { attachClientIdentity } from '../../packages/vue/src/internal/attached-runtime'
import type { ClientIdentitySnapshot } from '../../packages/vue/src/internal/identity-port'

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

function identitySnapshot(
  identityKey: ClientIdentitySnapshot['identityKey'],
  identityGeneration: number,
): ClientIdentitySnapshot {
  return {
    authEnabled: true,
    settled: true,
    identityKey,
    identityGeneration,
    error: null,
  }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('opaque Better Convex attachment', () => {
  it('projects and freezes only token-free, non-owning capabilities', async () => {
    const secret = 'attachment-private-token'
    const sourceClient = {
      label: 'host-receiver',
      query: vi.fn(async function (this: { label: string }) {
        return this.label
      }),
      mutation: vi.fn(),
      action: vi.fn(),
      onUpdate: vi.fn(),
      rawClient: { token: secret },
      close: vi.fn(),
      dispose: vi.fn(),
      setAuth: vi.fn(),
    }
    const sourceSnapshot = {
      ...identitySnapshot('user:alice', 1),
      token: secret,
      error: Object.assign(
        new ConvexCallError({
          kind: 'authentication',
          message: 'Authentication failed',
        }),
        { cause: new Error(secret) },
      ),
    }
    const anonymousSourceClient = {
      ...sourceClient,
      label: 'anonymous-receiver',
      query: vi.fn(async function (this: { label: string }) {
        return this.label
      }),
    }

    const attachment = createBetterConvexAttachment({
      client: sourceClient as never,
      anonymousClient: anonymousSourceClient as never,
      identity: {
        snapshot: () => sourceSnapshot,
        waitForInitialSettlement: async () => {},
        subscribe: () => () => {},
      },
    })

    expect(Object.isFrozen(attachment)).toBe(true)
    expect(Object.isFrozen(attachment.client)).toBe(true)
    expect(Object.isFrozen(attachment.anonymousClient)).toBe(true)
    expect(Object.isFrozen(attachment.identity)).toBe(true)
    expect(Object.keys(attachment).sort()).toEqual([
      'anonymousClient',
      'client',
      'connection',
      'identity',
    ])
    expect(Object.keys(attachment.client).sort()).toEqual([
      'action',
      'mutation',
      'onUpdate',
      'query',
    ])
    expect(attachment).not.toHaveProperty('token')
    expect(attachment).not.toHaveProperty('dispose')
    expect(attachment.client).not.toHaveProperty('rawClient')
    expect(attachment.client).not.toHaveProperty('close')
    expect(attachment.client).not.toHaveProperty('setAuth')
    const projectedQuery = attachment.client.query as unknown as (
      reference: unknown,
      args: unknown,
    ) => Promise<string>
    await expect(projectedQuery(null, {})).resolves.toBe('host-receiver')
    const projectedAnonymousQuery = attachment.anonymousClient.query as unknown as (
      reference: unknown,
      args: unknown,
    ) => Promise<string>
    await expect(projectedAnonymousQuery(null, {})).resolves.toBe('anonymous-receiver')
    expect(attachment.identity.snapshot()).toEqual({
      ...identitySnapshot('user:alice', 1),
      error: expect.objectContaining({
        kind: 'authentication',
        message: 'Authentication failed',
      }),
    })
    expect(attachment.identity.snapshot().error?.cause).toBeUndefined()
    expect(JSON.stringify(attachment)).not.toContain(secret)
  })

  it('closes the snapshot-before-subscribe race and ignores events after local disposal', () => {
    let current = identitySnapshot('user:alice', 1)
    const listeners = new Set<() => void>()
    const client = {
      query: vi.fn() as never,
      mutation: vi.fn() as never,
      action: vi.fn() as never,
      onUpdate: vi.fn() as never,
    }
    const attachment = createBetterConvexAttachment({
      client,
      anonymousClient: client,
      identity: {
        snapshot: () => current,
        waitForInitialSettlement: async () => {},
        subscribe(listener) {
          listeners.add(listener)
          current = identitySnapshot('user:bob', 2)
          return () => listeners.delete(listener)
        },
      },
    })

    const local = attachClientIdentity(attachment)
    expect(local.snapshot.value.identityKey).toBe('user:bob')
    expect(local.snapshot.value.identityGeneration).toBe(2)
    expect(listeners.size).toBe(1)

    current = identitySnapshot('user:carol', 3)
    for (const listener of [...listeners]) listener()
    expect(local.snapshot.value.identityKey).toBe('user:carol')

    local.dispose()
    expect(listeners.size).toBe(0)
    current = identitySnapshot('user:dana', 4)
    expect(local.snapshot.value.identityKey).toBe('user:carol')
  })

  it('disposes child projections and subscriptions without transferring host ownership', () => {
    let state = DISCONNECTED
    const identityListeners = new Set<() => void>()
    const connectionListeners = new Set<(next: ConnectionState) => void>()
    const ownerControls = {
      close: vi.fn(),
      dispose: vi.fn(),
      setAuth: vi.fn(),
    }
    const client = {
      query: vi.fn(),
      mutation: vi.fn(),
      action: vi.fn(),
      onUpdate: vi.fn(),
      ...ownerControls,
    } as never
    const attachment = createBetterConvexAttachment({
      client,
      anonymousClient: client,
      identity: {
        snapshot: () => identitySnapshot('user:alice', 1),
        waitForInitialSettlement: async () => {},
        subscribe(listener) {
          identityListeners.add(listener)
          return () => identityListeners.delete(listener)
        },
      },
      connection: {
        snapshot: () => state,
        subscribe(listener) {
          connectionListeners.add(listener)
          return () => connectionListeners.delete(listener)
        },
      },
    })

    let isConnected: { readonly value: boolean } | undefined
    const Child = defineComponent({
      setup() {
        useConvex()
        isConnected = useConvexConnectionState().isConnected
        return () => h('div')
      },
    })
    const mountChild = () => {
      const plugin = createBetterConvex({ attachment })
      expect(Object.keys(plugin).sort()).toEqual(['attachment', 'install'])
      const app = createApp(Child)
      app.use(plugin)
      const root = document.createElement('div')
      document.body.appendChild(root)
      app.mount(root)
      expect(plugin.attachment()).toBe(attachment)
      return app
    }

    const first = mountChild()
    expect(identityListeners.size).toBe(1)
    expect(connectionListeners.size).toBe(1)
    state = { ...state, isWebSocketConnected: true, hasEverConnected: true }
    for (const listener of [...connectionListeners]) listener(state)
    expect(isConnected?.value).toBe(true)

    first.unmount()
    expect(identityListeners.size).toBe(0)
    expect(connectionListeners.size).toBe(0)
    expect(ownerControls.close).not.toHaveBeenCalled()
    expect(ownerControls.dispose).not.toHaveBeenCalled()
    expect(ownerControls.setAuth).not.toHaveBeenCalled()

    const second = mountChild()
    expect(identityListeners.size).toBe(1)
    expect(connectionListeners.size).toBe(1)
    second.unmount()
    expect(identityListeners.size).toBe(0)
    expect(connectionListeners.size).toBe(0)
    expect(ownerControls.close).not.toHaveBeenCalled()
    expect(ownerControls.dispose).not.toHaveBeenCalled()
    expect(ownerControls.setAuth).not.toHaveBeenCalled()
  })
})
