import type { AuthTokenFetcher } from 'convex/browser'
import { describe, expect, it, vi } from 'vitest'

import type {
  BrowserAuthAdapter,
  BrowserAuthSnapshot,
} from '../../packages/vue/src/internal/auth-adapter'
import { createBetterConvexBrowserRuntime } from '../../packages/vue/src/internal/browser-runtime'
import type { OwnedConvexClient } from '../../packages/vue/src/internal/client-owner'

class Adapter implements BrowserAuthAdapter {
  private listeners = new Set<() => void>()
  readonly fetchToken = vi.fn<AuthTokenFetcher>(async () => 'private-token')
  readonly refreshSession = vi.fn(async () => {})
  constructor(private value: BrowserAuthSnapshot) {}
  snapshot = () => this.value
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  emit(value: BrowserAuthSnapshot) {
    this.value = value
    for (const listener of [...this.listeners]) listener()
  }
  listenerCount = () => this.listeners.size
}

interface Client extends OwnedConvexClient {
  setAuthCalls: number
  confirm(value: boolean): void
}

function client(): Client {
  let authChange: ((value: boolean) => void) | null = null
  const result = {
    query: vi.fn(async () => 'query'),
    mutation: vi.fn(async () => 'mutation'),
    action: vi.fn(async () => 'action'),
    onUpdate: vi.fn(() => Object.assign(() => {}, { unsubscribe() {}, getCurrentValue() {} })),
    connectionState: () => ({
      hasInflightRequests: false,
      isWebSocketConnected: false,
      timeOfOldestInflightRequest: null,
      hasEverConnected: false,
      connectionCount: 0,
      connectionRetries: 0,
      inflightMutations: 0,
      inflightActions: 0,
    }),
    subscribeToConnectionState: () => () => {},
    close: vi.fn(async () => {}),
    setAuthCalls: 0,
    setAuth(_fetch: AuthTokenFetcher, onChange: (value: boolean) => void) {
      result.setAuthCalls += 1
      authChange = onChange
    },
    confirm(value: boolean) {
      authChange?.(value)
    },
  }
  return result as unknown as Client
}

describe('Better Convex browser runtime', () => {
  it('owns one anonymous primary and exposes only the stable attachment', async () => {
    const clients: Client[] = []
    const runtime = createBetterConvexBrowserRuntime({
      clientFactory: () => {
        const value = client()
        clients.push(value)
        return value
      },
    })
    await runtime.ready()

    expect(runtime.identity.snapshot()).toMatchObject({
      authEnabled: false,
      settled: true,
      identityKey: 'anonymous',
    })
    expect(Object.keys(runtime.attachment.client).sort()).toEqual([
      'action',
      'mutation',
      'onUpdate',
      'query',
    ])
    expect(JSON.stringify(runtime.attachment)).not.toContain('private-token')

    await runtime.dispose()
    await runtime.dispose()
    expect(clients[0]?.close).toHaveBeenCalledOnce()
  })

  it('confirms an initially authenticated provider before readiness', async () => {
    const adapter = new Adapter({
      status: 'authenticated',
      identityKey: 'alice',
      sessionGeneration: 1,
      error: null,
    })
    const initialClient = client()
    const runtime = createBetterConvexBrowserRuntime({
      clientFactory: () => initialClient,
      auth: adapter,
    })
    const ready = runtime.ready()
    expect(runtime.identity.snapshot().settled).toBe(false)
    expect(initialClient.setAuthCalls).toBe(1)
    initialClient.confirm(true)
    await ready
    expect(runtime.identity.snapshot()).toMatchObject({
      settled: true,
      identityKey: 'user:alice',
    })
    const refresh = runtime.refreshAuth()
    await vi.waitFor(() => expect(initialClient.setAuthCalls).toBe(2))
    initialClient.confirm(true)
    await refresh
    expect(runtime.identity.snapshot().identityGeneration).toBe(0)
    await runtime.dispose()
    expect(adapter.listenerCount()).toBe(0)
  })

  it('ignores a stale initial confirmation failure after the identity changes', async () => {
    const adapter = new Adapter({
      status: 'authenticated',
      identityKey: 'alice',
      sessionGeneration: 1,
      error: null,
    })
    const clients: Client[] = []
    const runtime = createBetterConvexBrowserRuntime({
      auth: adapter,
      clientFactory: () => {
        const value = client()
        clients.push(value)
        return value
      },
    })
    const ready = runtime.ready()

    adapter.emit({
      status: 'authenticated',
      identityKey: 'bob',
      sessionGeneration: 2,
      error: null,
    })
    expect(clients).toHaveLength(2)
    clients[1]!.confirm(true)

    await ready
    expect(runtime.identity.snapshot()).toMatchObject({
      settled: true,
      identityKey: 'user:bob',
      identityGeneration: 1,
      error: null,
    })
    expect(clients).toHaveLength(2)
    await runtime.dispose()
  })

  it('still fails closed when the initial generation is rejected', async () => {
    const adapter = new Adapter({
      status: 'authenticated',
      identityKey: 'alice',
      sessionGeneration: 1,
      error: null,
    })
    const clients: Client[] = []
    const runtime = createBetterConvexBrowserRuntime({
      auth: adapter,
      clientFactory: () => {
        const value = client()
        clients.push(value)
        return value
      },
    })
    const ready = runtime.ready()

    clients[0]!.confirm(false)

    await ready
    expect(runtime.identity.snapshot()).toMatchObject({
      settled: true,
      identityKey: 'anonymous',
      identityGeneration: 1,
    })
    expect(runtime.identity.snapshot().error).not.toBeNull()
    expect(clients).toHaveLength(2)
    await runtime.dispose()
  })

  it('waits through loading and replaces before publishing a later identity', async () => {
    const adapter = new Adapter({
      status: 'loading',
      identityKey: null,
      sessionGeneration: 0,
      error: null,
    })
    const clients: Client[] = []
    const runtime = createBetterConvexBrowserRuntime({
      auth: adapter,
      clientFactory: () => {
        const value = client()
        clients.push(value)
        return value
      },
    })
    const ready = runtime.ready()
    adapter.emit({
      status: 'authenticated',
      identityKey: 'bob',
      sessionGeneration: 1,
      error: null,
    })
    expect(runtime.identity.snapshot()).toMatchObject({
      settled: false,
      identityKey: 'user:bob',
    })
    expect(clients[0]?.close).toHaveBeenCalledOnce()

    await vi.waitFor(() => expect(clients).toHaveLength(2))
    clients[1]!.confirm(true)
    await ready
    expect(runtime.identity.snapshot().settled).toBe(true)
    await runtime.dispose()
  })

  it('cancels an unconfirmed initial credential during disposal', async () => {
    const adapter = new Adapter({
      status: 'authenticated',
      identityKey: 'alice',
      sessionGeneration: 1,
      error: null,
    })
    const runtime = createBetterConvexBrowserRuntime({ clientFactory: client, auth: adapter })
    const ready = runtime.ready()

    await runtime.dispose()
    await expect(ready).resolves.toBeUndefined()
    expect(adapter.listenerCount()).toBe(0)
  })

  it('refetches a failed provider session and waits for replacement confirmation', async () => {
    const adapter = new Adapter({
      status: 'error',
      identityKey: null,
      sessionGeneration: 1,
      error: new Error('private-provider-sentinel'),
    })
    const clients: Client[] = []
    const runtime = createBetterConvexBrowserRuntime({
      auth: adapter,
      clientFactory: () => {
        const value = client()
        clients.push(value)
        return value
      },
    })
    await runtime.ready()
    adapter.refreshSession.mockImplementationOnce(async () => {
      adapter.emit({
        status: 'authenticated',
        identityKey: 'alice',
        sessionGeneration: 2,
        error: null,
      })
    })

    const refresh = runtime.refreshAuth()
    await vi.waitFor(() => expect(clients).toHaveLength(2))
    expect(adapter.refreshSession).toHaveBeenCalledOnce()
    expect(clients[1]!.setAuthCalls).toBe(1)
    clients[1]!.confirm(true)
    await refresh
    expect(runtime.identity.snapshot()).toMatchObject({
      settled: true,
      identityKey: 'user:alice',
      error: null,
    })
    await runtime.dispose()
  })
})
