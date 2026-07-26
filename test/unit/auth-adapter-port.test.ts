import type { AuthTokenFetcher, ConvexClient } from 'convex/browser'
import { describe, expect, it, vi } from 'vitest'

import {
  createAuthAdapterIdentityPort,
  type BrowserAuthAdapter,
  type BrowserAuthSnapshot,
} from '../../packages/vue/src/internal/auth-adapter'
import {
  createConvexClientOwner,
  type OwnedConvexClient,
} from '../../packages/vue/src/internal/client-owner'

class FakeAdapter implements BrowserAuthAdapter {
  private listeners = new Set<() => void>()
  readonly fetchToken = vi.fn<AuthTokenFetcher>(async () => 'token-secret-sentinel')

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

  listenerCount() {
    return this.listeners.size
  }
}

function authSnapshot(identityKey: string, sessionGeneration: number): BrowserAuthSnapshot {
  return {
    status: 'authenticated',
    identityKey,
    sessionGeneration,
    error: null,
  }
}

function anonymousSnapshot(sessionGeneration: number): BrowserAuthSnapshot {
  return {
    status: 'anonymous',
    identityKey: null,
    sessionGeneration,
    error: null,
  }
}

interface FakeClient extends OwnedConvexClient {
  confirm(value: boolean): Promise<void>
  authChange(value: boolean): void
  setAuthCalls: number
}

function fakeClient(): FakeClient {
  let confirmation: ((value: boolean) => void) | null = null
  let authListener: ((value: boolean) => void) | null = null
  const client: FakeClient = {
    query: vi.fn(async () => 'query') as never,
    mutation: vi.fn(async () => 'mutation') as never,
    action: vi.fn(async () => 'action') as never,
    onUpdate: vi.fn(() =>
      Object.assign(() => {}, { unsubscribe() {}, getCurrentValue() {} }),
    ) as never,
    connectionState: () => ({
      hasInflightRequests: false,
      isWebSocketConnected: true,
      timeOfOldestInflightRequest: null,
      hasEverConnected: true,
      connectionCount: 1,
      connectionRetries: 0,
      inflightMutations: 0,
      inflightActions: 0,
    }),
    subscribeToConnectionState: () => () => {},
    close: vi.fn(async () => {}),
    setAuthCalls: 0,
    confirm: async (value) => {
      confirmation?.(value)
      await vi.waitFor(() => expect(confirmation).toBeNull())
    },
    authChange: (value) => authListener?.(value),
  }
  Object.assign(client, {
    setAuth(_fetchToken: AuthTokenFetcher, onChange: (value: boolean) => void) {
      client.setAuthCalls += 1
      authListener = onChange
      confirmation = (value: boolean) => {
        confirmation = null
        onChange(value)
      }
    },
  })
  return client
}

async function settleOwner() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('provider-neutral auth adapter identity port', () => {
  it('settles a fresh anonymous client through the exact Convex public auth surface', async () => {
    const adapter = new FakeAdapter(anonymousSnapshot(0))
    const port = createAuthAdapterIdentityPort(adapter)
    const client = fakeClient()

    await expect(port.initializePrimary(client as unknown as ConvexClient)).resolves.toBeUndefined()
    expect(client.setAuthCalls).toBe(0)
    expect(port.snapshot()).toMatchObject({
      settled: true,
      identityKey: 'anonymous',
      error: null,
    })
    port.dispose()
  })

  it('maps Better Auth-style session changes without exposing its session token', async () => {
    let session: { token: string; user: { id: string } } | null = null
    let generation = 0
    const listeners = new Set<() => void>()
    const adapter: BrowserAuthAdapter = {
      snapshot: () =>
        session ? authSnapshot(session.user.id, generation) : anonymousSnapshot(generation),
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      fetchToken: async () => 'better-auth-convex-jwt-sentinel',
    }
    const port = createAuthAdapterIdentityPort(adapter)

    session = { token: 'better-auth-session-secret', user: { id: 'alice' } }
    generation += 1
    for (const listener of [...listeners]) listener()

    expect(port.snapshot()).toMatchObject({
      identityKey: 'user:alice',
      identityGeneration: 1,
      settled: false,
    })
    expect(JSON.stringify(port.snapshot())).not.toContain('better-auth-session-secret')
    expect(JSON.stringify(port.snapshot())).not.toContain('convex-jwt-sentinel')

    session = {
      token: 'better-auth-new-session-secret',
      user: { id: 'alice' },
    }
    generation += 1
    for (const listener of [...listeners]) listener()
    expect(port.snapshot().identityGeneration).toBe(2)

    port.dispose()
  })

  it('retires the old principal synchronously and publishes only after Convex confirms', async () => {
    const adapter = new FakeAdapter(anonymousSnapshot(0))
    const clients: FakeClient[] = []
    const owner = createConvexClientOwner({
      primaryFactory: () => {
        const client = fakeClient()
        clients.push(client)
        return client
      },
      anonymousFactory: fakeClient,
    })
    const port = createAuthAdapterIdentityPort(adapter)
    owner.attachIdentityPort(port)

    const oldClient = clients[0]!
    adapter.emit(authSnapshot('alice', 1))

    expect(port.snapshot()).toMatchObject({
      settled: false,
      identityKey: 'user:alice',
      identityGeneration: 1,
    })
    expect(owner.getPrimary()).toBeNull()
    expect(oldClient.close).toHaveBeenCalledOnce()

    await settleOwner()
    const candidate = clients[1]!
    expect(candidate.setAuthCalls).toBe(1)
    await candidate.confirm(true)
    await settleOwner()

    expect(port.snapshot()).toMatchObject({
      settled: true,
      identityKey: 'user:alice',
    })
    expect(owner.getPrimary()?.client).toBe(candidate)
    await owner.dispose()
    port.dispose()
  })

  it('ignores identical provider state, preserves explicit refresh, and crosses a new session', async () => {
    const adapter = new FakeAdapter(authSnapshot('alice', 4))
    const client = fakeClient()
    const port = createAuthAdapterIdentityPort(adapter)

    const initial = port.initializePrimary(client as unknown as ConvexClient)
    await client.confirm(true)
    await initial
    const initialGeneration = port.snapshot().identityGeneration
    const notify = vi.fn()
    const stop = port.subscribe(notify)
    const timer = vi.spyOn(globalThis, 'setTimeout')

    adapter.emit(authSnapshot('alice', 4))
    const timerCalls = timer.mock.calls.length
    timer.mockRestore()
    expect(port.snapshot().identityGeneration).toBe(initialGeneration)
    expect(notify).not.toHaveBeenCalled()
    expect(client.setAuthCalls).toBe(1)
    expect(timerCalls).toBe(0)
    expect(Object.keys(port.snapshot())).not.toContain('authEpoch')

    const explicitRefresh = port.refresh()
    expect(client.setAuthCalls).toBe(2)
    await client.confirm(true)
    await explicitRefresh
    notify.mockClear()

    adapter.emit(authSnapshot('alice', 5))
    expect(port.snapshot()).toMatchObject({
      settled: false,
      identityGeneration: initialGeneration + 1,
    })
    expect(notify).toHaveBeenCalledOnce()
    expect(client.setAuthCalls).toBe(2)
    stop()
    port.dispose()
  })

  it('replaces the owned client for a same-user new session', async () => {
    const adapter = new FakeAdapter(authSnapshot('alice', 4))
    const clients: FakeClient[] = []
    const owner = createConvexClientOwner({
      primaryFactory: () => {
        const client = fakeClient()
        clients.push(client)
        return client
      },
    })
    const port = createAuthAdapterIdentityPort(adapter)
    owner.attachIdentityPort(port)
    const a = clients[0]!
    const initial = port.initializePrimary(a as unknown as ConvexClient)
    await a.confirm(true)
    await initial

    adapter.emit(authSnapshot('alice', 5))
    expect(owner.getPrimary()).toBeNull()
    expect(a.close).toHaveBeenCalledOnce()
    await settleOwner()
    const b = clients[1]!
    expect(b.setAuthCalls).toBe(1)
    await b.confirm(true)
    await settleOwner()

    expect(owner.getPrimary()).toMatchObject({
      client: b,
      identityGeneration: 1,
    })
    await owner.dispose()
    port.dispose()
  })

  it('fails closed when Convex rejects the first credential confirmation', async () => {
    const adapter = new FakeAdapter(authSnapshot('alice', 1))
    const client = fakeClient()
    const port = createAuthAdapterIdentityPort(adapter)

    const initial = port.initializePrimary(client as unknown as ConvexClient)
    await client.confirm(false)
    await expect(initial).rejects.toMatchObject({ kind: 'authentication' })
    expect(port.snapshot()).toMatchObject({
      settled: true,
      identityKey: 'anonymous',
      identityGeneration: 1,
      error: { kind: 'authentication' },
    })
    port.dispose()
  })

  it('fails closed when Convex later rejects a confirmed credential', async () => {
    const adapter = new FakeAdapter(authSnapshot('alice', 1))
    const client = fakeClient()
    const port = createAuthAdapterIdentityPort(adapter)
    const initial = port.initializePrimary(client as unknown as ConvexClient)
    await client.confirm(true)
    await initial

    client.authChange(false)
    client.authChange(false)
    expect(port.snapshot()).toMatchObject({
      settled: true,
      identityKey: 'anonymous',
      identityGeneration: 1,
      error: { kind: 'authentication' },
    })
    port.dispose()
  })

  it('fails a refresh closed once and rejects every deduplicated waiter', async () => {
    const adapter = new FakeAdapter(authSnapshot('alice', 1))
    const client = fakeClient()
    const port = createAuthAdapterIdentityPort(adapter)
    const initial = port.initializePrimary(client as unknown as ConvexClient)
    await client.confirm(true)
    await initial

    const first = port.refresh()
    const second = port.refresh()
    expect(client.setAuthCalls).toBe(2)
    await client.confirm(false)
    await expect(first).rejects.toMatchObject({ kind: 'authentication' })
    await expect(second).rejects.toMatchObject({ kind: 'authentication' })
    expect(port.snapshot()).toMatchObject({
      settled: true,
      identityKey: 'anonymous',
      identityGeneration: 1,
      error: { kind: 'authentication' },
    })
    port.dispose()
  })

  it('retires Alice for Bob and for revocation before either replacement settles', () => {
    const adapter = new FakeAdapter(authSnapshot('alice', 1))
    const port = createAuthAdapterIdentityPort(adapter)

    adapter.emit(authSnapshot('bob', 2))
    expect(port.snapshot()).toMatchObject({
      identityKey: 'user:bob',
      identityGeneration: 1,
      settled: false,
    })

    adapter.emit(anonymousSnapshot(3))
    expect(port.snapshot()).toMatchObject({
      identityKey: 'anonymous',
      identityGeneration: 2,
      settled: true,
    })
    port.dispose()
  })

  it('supports a callback-style provider without provider data entering snapshots', async () => {
    let providerState = anonymousSnapshot(0)
    const listeners = new Set<() => void>()
    const customProvider: BrowserAuthAdapter = {
      snapshot: () => providerState,
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      fetchToken: async () => 'custom-provider-token-sentinel',
    }
    const port = createAuthAdapterIdentityPort(customProvider)
    providerState = authSnapshot('custom-subject', 1)
    for (const listener of [...listeners]) listener()

    const serialized = JSON.stringify(port.snapshot())
    expect(serialized).not.toContain('token-sentinel')
    expect(serialized).not.toContain('role')
    expect(serialized).not.toContain('permission')
    expect(Object.keys(port)).not.toContain('fetchToken')
    port.dispose()
    expect(listeners).toHaveLength(0)
  })

  it('fails closed on invalid provider state and redacts the raw provider error', () => {
    const adapter = new FakeAdapter(anonymousSnapshot(0))
    const port = createAuthAdapterIdentityPort(adapter)
    adapter.emit({
      status: 'authenticated',
      identityKey: null,
      sessionGeneration: 1,
      error: new Error('provider-secret-sentinel'),
    })

    expect(port.snapshot()).toMatchObject({
      settled: true,
      identityKey: 'anonymous',
      error: {
        kind: 'authentication',
        message: 'Authentication failed',
      },
    })
    expect(JSON.stringify(port.snapshot())).not.toContain('provider-secret-sentinel')
    port.dispose()
  })

  it('contains throwing listeners and unsubscribes exactly once', () => {
    const adapter = new FakeAdapter(anonymousSnapshot(0))
    const port = createAuthAdapterIdentityPort(adapter)
    const remove = port.subscribe(() => {
      throw new Error('observer failure')
    })
    adapter.emit({
      status: 'error',
      identityKey: null,
      sessionGeneration: 1,
      error: new Error('provider failure'),
    })
    expect(port.snapshot().error?.kind).toBe('authentication')
    remove()
    remove()
    port.dispose()
    port.dispose()
    expect(adapter.listenerCount()).toBe(0)
  })
})
