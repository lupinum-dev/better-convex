import type { AuthTokenFetcher } from 'convex/browser'
import { describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'

import { ConvexCallError } from '../../packages/vue/src/errors'
import { createBetterConvexBrowserRuntime } from '../../packages/vue/src/internal/browser-runtime'
import type { OwnedConvexClient } from '../../packages/vue/src/internal/client-owner'
import { createBetterAuthBrowserAdapter } from '../../src/runtime/auth/better-auth-browser-adapter'
import type { ConvexTokenSource } from '../../src/runtime/auth/token-fetcher'

type TokenResponse = Awaited<ReturnType<ConvexTokenSource['convex']['token']>>

const restricted: TokenResponse = {
  error: { status: 403, code: 'AUTH_WORKFORCE_FULL_AUTH_REQUIRED' },
}

function jwt(session: string) {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  // Synthetic transport fixture, never a server verification or signing proof.
  return `${encode({ alg: 'none' })}.${encode({ sub: 'alice', sessionId: session, exp: Math.floor(Date.now() / 1_000) + 900 })}.synthetic`
}

function transport() {
  const tokens: Array<string | null> = []
  const value = {
    query: vi.fn(async () => null),
    mutation: vi.fn(async () => null),
    action: vi.fn(async () => null),
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
    subscribeToConnectionState: vi.fn(() => () => {}),
    close: vi.fn(async () => {}),
    setAuth: vi.fn((fetch: AuthTokenFetcher, onChange: (authenticated: boolean) => void) => {
      void fetch({ forceRefreshToken: true }).then((token) => {
        tokens.push(token ?? null)
        // Deliver even after close: the real runtime must reject a retired
        // client's late confirmation rather than relying on this fake to do it.
        onChange(typeof token === 'string')
      })
    }),
  }
  return {
    client: value as unknown as OwnedConvexClient,
    setAuth: value.setAuth,
    close: value.close,
    tokens,
  }
}

function world(initialResponse: TokenResponse) {
  const refetch = vi.fn(async () => {
    // Better Auth may republish fresh objects for the unchanged cookie session.
    session.value = { ...session.value, data: { ...session.value.data } }
  })
  const session = shallowRef({
    isPending: false,
    error: null,
    data: { session: { token: 'cookie-initial' }, user: { id: 'alice' } },
    refetch,
  })
  const token = vi.fn<ConvexTokenSource['convex']['token']>().mockResolvedValue(initialResponse)
  const callbacks = {
    authenticated: vi.fn(),
    anonymous: vi.fn(),
    sessionChanged: vi.fn(),
  }
  const adapter = createBetterAuthBrowserAdapter(
    { useSession: () => session, convex: { token } },
    callbacks,
  )
  const clients: ReturnType<typeof transport>[] = []
  const runtime = createBetterConvexBrowserRuntime({
    auth: adapter,
    clientFactory: () => {
      const next = transport()
      clients.push(next)
      return next.client
    },
  })
  return {
    adapter,
    runtime,
    session,
    token,
    callbacks,
    clients,
    async dispose() {
      await runtime.dispose()
      adapter.dispose()
    },
  }
}

describe('workforce provider continuation through the real Vue browser runtime', () => {
  it('settles restricted setup anonymous without losing the provider cookie or refreshing in a loop', async () => {
    const fixture = world(restricted)
    try {
      await fixture.runtime.ready()
      expect(fixture.runtime.identity.snapshot()).toMatchObject({
        settled: true,
        identityKey: 'anonymous',
        error: null,
      })
      expect(fixture.adapter.isRestrictedSession()).toBe(true)
      expect(fixture.callbacks.sessionChanged).toHaveBeenLastCalledWith('cookie-initial', null, 1)
      expect(fixture.callbacks.anonymous).toHaveBeenLastCalledWith(null)
      expect(fixture.clients[0]!.close).toHaveBeenCalledOnce()
      expect(fixture.clients[0]!.tokens).toEqual([null])

      const generation = fixture.runtime.identity.snapshot().identityGeneration
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await expect(fixture.runtime.refreshAuth()).resolves.toBeUndefined()
      }
      expect(fixture.token).toHaveBeenCalledOnce()
      expect(fixture.clients).toHaveLength(2)
      expect(fixture.runtime.identity.snapshot()).toMatchObject({
        settled: true,
        identityKey: 'anonymous',
        identityGeneration: generation,
        error: null,
      })

      const full = jwt('full-session')
      fixture.token.mockResolvedValue({ data: { token: full } })
      fixture.session.value = {
        ...fixture.session.value,
        data: { session: { token: 'cookie-full' }, user: { id: 'alice' } },
      }
      await fixture.runtime.refreshAuth()
      expect(fixture.adapter.isRestrictedSession()).toBe(false)
      expect(fixture.runtime.identity.snapshot()).toMatchObject({
        settled: true,
        identityKey: 'user:alice',
        error: null,
      })
      expect(fixture.clients.at(-1)!.tokens).toEqual([full])
      expect(fixture.callbacks.authenticated).toHaveBeenLastCalledWith(
        full,
        expect.objectContaining({ id: 'alice' }),
      )
    } finally {
      await fixture.dispose()
    }
  })

  it('retires a previously full client during refresh and cannot retain its cached JWT', async () => {
    const full = jwt('previously-full-session')
    const fixture = world({ data: { token: full } })
    try {
      await fixture.runtime.ready()
      expect(fixture.clients[0]!.tokens).toEqual([full])
      expect(fixture.runtime.identity.snapshot()).toMatchObject({
        settled: true,
        identityKey: 'user:alice',
      })

      fixture.token.mockResolvedValue(restricted)
      // Observe the actual refresh result, with no reproduction of Nuxt's
      // restricted-generation catch. Retirement is an expected typed boundary.
      const refresh = await fixture.runtime.refreshAuth().then(
        () => ({ kind: 'completed' as const }),
        (error: unknown) => ({ kind: 'retired' as const, error }),
      )
      if (refresh.kind === 'retired') {
        expect(refresh.error).toBeInstanceOf(ConvexCallError)
        expect(refresh.error).toMatchObject({ kind: 'authentication', code: 'IDENTITY_CHANGED' })
      }
      expect(fixture.runtime.identity.snapshot()).toMatchObject({
        settled: true,
        identityKey: 'anonymous',
        error: null,
      })
      expect(fixture.clients[0]!.close).toHaveBeenCalledOnce()
      expect(fixture.clients[0]!.tokens).toEqual([full, null])
      expect(fixture.clients.at(-1)!.setAuth).not.toHaveBeenCalled()
      expect(fixture.callbacks.anonymous).toHaveBeenLastCalledWith(null)

      const fetchCount = fixture.token.mock.calls.length
      fixture.token.mockResolvedValue({ error: { status: 503 } })
      await expect(fixture.adapter.fetchToken({ forceRefreshToken: true })).resolves.toBeNull()
      await expect(fixture.runtime.refreshAuth()).resolves.toBeUndefined()
      expect(fixture.token).toHaveBeenCalledTimes(fetchCount)
      expect(fixture.callbacks.authenticated).toHaveBeenCalledOnce()
      expect(fixture.runtime.identity.snapshot().error).toBeNull()
    } finally {
      await fixture.dispose()
    }
  })
})
