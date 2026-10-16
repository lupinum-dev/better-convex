import type { ConvexClient } from 'convex/browser'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import type { AuthenticationManager as ConvexAuthenticationManager } from '../../node_modules/convex/dist/esm-types/browser/sync/authentication_manager.js'
import {
  createAuthAdapterIdentityPort,
  type AuthAdapterIdentityPort,
} from '../../packages/vue/src/internal/auth-adapter'
import type { ClientIdentitySnapshot } from '../../packages/vue/src/internal/identity-port'
import { createBetterAuthBrowserAdapter } from '../../src/runtime/auth/better-auth-browser-adapter'

// The installed Convex client's own token state machine: when it fetches,
// refreshes, and reports a session as signed out. It is not a public entry
// point, so it is loaded from the package build by path.
const { AuthenticationManager } = (await import(
  /* @vite-ignore */ new URL(
    '../../node_modules/convex/dist/esm/browser/sync/authentication_manager.js',
    import.meta.url,
  ).href
)) as { AuthenticationManager: typeof ConvexAuthenticationManager }

const SESSION_JWT_SECONDS = 900

function jwt(sub: string, lifetimeSeconds = SESSION_JWT_SECONDS) {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const iat = Math.floor(Date.now() / 1_000)
  return `${encode({ alg: 'none' })}.${encode({ sub, iat, exp: iat + lifetimeSeconds })}.signature`
}

type ExchangeAnswer = { data: { token: string } | null; error?: { status: number } }
const ok = (): ExchangeAnswer => ({ data: { token: jwt('alice') } })
const failing = (status: number): ExchangeAnswer => ({ data: null, error: { status } })

/**
 * Better Auth reporting alice's session. `exchange` answers each
 * `/convex/token` request from the milliseconds since the page loaded.
 */
function betterAuth(exchange: (elapsedMs: number) => ExchangeAnswer) {
  const loadedAt = Date.now()
  const session = ref({
    isPending: false,
    isRefetching: false,
    data: { session: { token: 'session-a' }, user: { id: 'alice' } } as {
      session: { token: string }
      user: { id: string }
    } | null,
    error: null as unknown,
    refetch: vi.fn(async () => {}),
  })
  const token = vi.fn(async () => exchange(Date.now() - loadedAt))
  return { session, token, client: { useSession: () => session, convex: { token } } }
}

/**
 * A ConvexClient whose `setAuth` runs Convex's AuthenticationManager. The
 * server confirms every token it receives.
 */
function convexClient(leewaySeconds = 10): ConvexClient & { stop(): void } {
  const sync = {
    identityVersion: 0,
    auth: undefined as { value: string } | undefined,
    isCurrentOrNewerAuthVersion(version: number) {
      return version >= this.identityVersion
    },
    markAuthCompletion() {},
    getAuth() {
      return this.auth
    },
    setAuth(value: string) {
      this.auth = { value }
      return this.identityVersion++
    },
    clearAuth() {
      this.auth = undefined
      this.identityVersion += 1
    },
    hasAuth() {
      return this.auth !== undefined
    },
    isNewAuth(value: string) {
      return this.auth?.value !== value
    },
  }
  const manager: ConvexAuthenticationManager = new AuthenticationManager(
    sync as never,
    {
      authenticate(token: string) {
        const base = sync.setAuth(token)
        setTimeout(() =>
          manager.onTransition({
            startVersion: { identity: base },
            endVersion: { identity: base + 1 },
            clientClockSkew: 0,
          } as never),
        )
        return base
      },
      stopSocket: async () => {},
      tryRestartSocket: () => {},
      pauseSocket: () => {},
      resumeSocket: () => {},
      clearAuth: () => sync.clearAuth(),
    },
    {
      // What the runtime passes as `authRefreshTokenLeewaySeconds` (Convex's default is 10).
      refreshTokenLeewaySeconds: leewaySeconds,
      initialAuthTokenReuse: true,
      logger: { logVerbose() {}, log() {}, warn() {}, error() {} } as never,
    },
  )
  return {
    setAuth(fetchToken: Parameters<ConvexClient['setAuth']>[0], onChange: (ok: boolean) => void) {
      void manager.setConfig(fetchToken, onChange)
    },
    stop: () => manager.stop(),
  } as unknown as ConvexClient & { stop(): void }
}

/** Builds a new client for each identity generation, as the client owner does. */
function attachClients(
  port: AuthAdapterIdentityPort,
  leewaySeconds: number | undefined,
): ClientIdentitySnapshot[] {
  const published: ClientIdentitySnapshot[] = []
  let generation = port.snapshot().identityGeneration
  let current: ReturnType<typeof convexClient> | null = null
  const start = () => {
    current?.stop()
    current = convexClient(leewaySeconds)
    void port.initializePrimary(current).catch(() => {})
  }
  port.subscribe(() => {
    published.push(port.snapshot())
    if (port.snapshot().identityGeneration === generation) return
    generation = port.snapshot().identityGeneration
    start()
  })
  start()
  return published
}

function signedInPage(exchange: (elapsedMs: number) => ExchangeAnswer) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] })
  const provider = betterAuth(exchange)
  // The server rendered the page for alice.
  const adapter = createBetterAuthBrowserAdapter(provider.client, undefined, {
    initialIdentityKey: 'alice',
  })
  const port = createAuthAdapterIdentityPort(adapter)
  const published = attachClients(port, adapter.tokenRefreshLeewaySeconds)
  return { provider, adapter, port, published }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('Better Auth token lifecycle with the Convex client', () => {
  it.each([
    // The fetcher alone gives up after 5 seconds.
    [
      'a 503 that lasts 8 seconds',
      (elapsedMs: number) => (elapsedMs < 8_000 ? failing(503) : ok()),
    ],
    // Longer than the 10 seconds in which Convex must confirm a token.
    [
      'a 429 that lasts 15 seconds',
      (elapsedMs: number) => (elapsedMs < 15_000 ? failing(429) : ok()),
    ],
  ])('keeps a signed-in page signed in through %s on its first token', async (_case, exchange) => {
    const { provider, port, published } = signedInPage(exchange)

    await vi.advanceTimersByTimeAsync(40_000)

    expect(published.map((snapshot) => snapshot.identityKey)).not.toContain('anonymous')
    expect(port.snapshot()).toMatchObject({
      identityKey: 'user:alice',
      settled: true,
      error: null,
    })
    // It waited between attempts instead of asking again at once.
    expect(provider.token.mock.calls.length).toBeLessThan(15)
  })

  it('keeps refreshing through a failure at the scheduled refresh', async () => {
    // From before the refresh (60 s before expiry) for longer than the 30 s
    // retry budget, while the current token still works.
    const outageStart = (SESSION_JWT_SECONDS - 70) * 1_000
    const outageEnd = outageStart + 40_000
    const { provider, port, published } = signedInPage((elapsedMs) =>
      elapsedMs >= outageStart && elapsedMs < outageEnd ? failing(503) : ok(),
    )
    await vi.advanceTimersByTimeAsync(1_000)
    const tokensBeforeOutage = provider.token.mock.calls.length

    // Two more token lifetimes: the refresh during the outage and the one after it.
    await vi.advanceTimersByTimeAsync(2 * SESSION_JWT_SECONDS * 1_000)

    expect(published.map((snapshot) => snapshot.identityKey)).not.toContain('anonymous')
    expect(port.snapshot()).toMatchObject({ identityKey: 'user:alice', settled: true, error: null })
    const lastRequest = provider.token.mock.results.length
    // Convex asked again after the outage and keeps scheduling refreshes.
    expect(lastRequest).toBeGreaterThan(tokensBeforeOutage + 2)
    expect(await provider.token.mock.results.at(-1)?.value).toMatchObject({
      data: { token: expect.any(String) },
    })
    await vi.advanceTimersByTimeAsync(SESSION_JWT_SECONDS * 1_000)
    expect(provider.token.mock.calls.length).toBeGreaterThan(lastRequest)
  })

  it('reports a long outage as temporarily unavailable and recovers on its own', async () => {
    const { provider, port } = signedInPage((elapsedMs) =>
      elapsedMs < 90_000 ? failing(503) : ok(),
    )
    // The retry budget is 30 seconds.
    for (let second = 0; second < 40 && port.snapshot().identityKey !== 'anonymous'; second++) {
      await vi.advanceTimersByTimeAsync(1_000)
    }
    expect(port.snapshot()).toMatchObject({
      identityKey: 'anonymous',
      settled: true,
      error: { code: 'AUTH_UNAVAILABLE', message: 'Authentication is temporarily unavailable' },
    })

    // Better Auth re-reads the unchanged session on focus, on reconnect and for
    // other tabs, each time as a new object.
    const generation = port.snapshot().identityGeneration
    const requests = provider.token.mock.calls.length
    for (let refetch = 0; refetch < 3; refetch += 1) {
      provider.session.value = {
        ...provider.session.value,
        data: { session: { token: 'session-a' }, user: { id: 'alice' } },
      }
    }
    expect(port.snapshot().identityGeneration).toBe(generation)
    expect(provider.token.mock.calls.length).toBe(requests)

    await vi.advanceTimersByTimeAsync(120_000)
    expect(port.snapshot()).toMatchObject({ identityKey: 'user:alice', settled: true, error: null })
  })
})
