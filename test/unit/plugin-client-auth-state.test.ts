import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ANONYMOUS_IDENTITY,
  toAuthenticatedIdentity,
  type AuthIdentity,
} from '../../src/runtime/auth/auth-identity'
import { ConvexCallError } from '../../src/runtime/errors'

const {
  adapterCallbacks,
  authErrorState,
  clearNuxtDataMock,
  createAuthClientMock,
  createBetterConvexMock,
  identityState,
  pendingState,
  runtime,
  snapshot,
  subscribers,
} = vi.hoisted(() => {
  const snapshot = {
    settled: true,
    identityKey: 'user:alice',
    identityGeneration: 1,
    error: null as unknown,
  }
  const subscribers = new Set<() => void>()
  const runtime = {
    attachment: {
      identity: {
        snapshot: () => snapshot,
        subscribe(callback: () => void) {
          subscribers.add(callback)
          return () => subscribers.delete(callback)
        },
      },
    },
    attachAuthController: vi.fn(),
    dispose: vi.fn(),
  }
  return {
    adapterCallbacks: {
      authenticated: undefined as
        | ((token: string, user: { id: string; name?: string }) => void)
        | undefined,
    },
    authErrorState: { value: null as string | null },
    clearNuxtDataMock: vi.fn(),
    createAuthClientMock: vi.fn(),
    createBetterConvexMock: vi.fn(),
    identityState: {
      value: { status: 'anonymous' } as AuthIdentity,
    },
    pendingState: { value: false },
    runtime,
    snapshot,
    subscribers,
  }
})

vi.mock('#app', () => ({
  clearNuxtData: clearNuxtDataMock,
  defineNuxtPlugin: vi.fn((plugin: unknown) => plugin),
  useRuntimeConfig: vi.fn(() => ({ public: { convex: {} } })),
  useState: vi.fn((key: string, init?: () => unknown) => {
    if (key === 'convex:authError') return authErrorState
    return { value: init?.() ?? null }
  }),
}))

vi.mock('#convex/auth-client', () => ({ default: {} }))

vi.mock('better-auth/vue', () => ({
  createAuthClient: createAuthClientMock,
}))

vi.mock('better-convex-vue', () => ({
  createBetterConvex: createBetterConvexMock,
}))

vi.mock('../../src/runtime/auth/better-auth-browser-adapter', () => ({
  createBetterAuthBrowserAdapter: vi.fn(
    (
      _client: unknown,
      callbacks: {
        authenticated(token: string, user: { id: string; name?: string }): void
      },
    ) => {
      adapterCallbacks.authenticated = callbacks.authenticated
      return {
        dispose: vi.fn(),
        failClosed: vi.fn(),
      }
    },
  ),
}))

vi.mock('../../src/runtime/auth/validate-auth-client-definition', () => ({
  validateConvexAuthClientDefinition: vi.fn(() => ({})),
}))

vi.mock('../../src/runtime/runtime-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/runtime/runtime-context')>()),
  createConvexRuntimeContext: vi.fn(() => runtime),
}))

vi.mock('../../src/runtime/utils/auth-identity-state', () => ({
  useConvexIdentityState: vi.fn(() => identityState),
}))

vi.mock('../../src/runtime/utils/auth-pending-state', () => ({
  useConvexAuthPendingState: vi.fn(() => pendingState),
}))

vi.mock('../../src/runtime/utils/runtime-config', () => ({
  getConvexRuntimeConfig: vi.fn(() => ({
    url: 'https://demo.convex.cloud',
    auth: {},
  })),
}))

describe('auth client app-facing state projection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    subscribers.clear()
    identityState.value = toAuthenticatedIdentity('alice-token', {
      id: 'alice',
      name: 'Alice',
    })
    authErrorState.value = null
    pendingState.value = false
    snapshot.settled = true
    snapshot.identityKey = 'user:alice'
    snapshot.identityGeneration = 1
    snapshot.error = null
    adapterCallbacks.authenticated = undefined

    createAuthClientMock.mockReturnValue({
      signIn: {},
      signUp: {},
      signOut: vi.fn(async () => ({ data: { success: true }, error: null })),
    })
    createBetterConvexMock.mockReturnValue({
      attachment: vi.fn(() => runtime.attachment),
      ready: vi.fn(async () => {}),
      refreshAuth: vi.fn(async () => {}),
    })
  })

  it('projects a later canonical identity failure into Nuxt auth state', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://app.example.com' } })
    const plugin = (await import('../../src/runtime/plugin.auth.client')).default as unknown as {
      setup(nuxtApp: {
        provide: ReturnType<typeof vi.fn>
        vueApp: {
          onUnmount: ReturnType<typeof vi.fn>
          use: ReturnType<typeof vi.fn>
        }
      }): void
    }
    plugin.setup({
      provide: vi.fn(),
      vueApp: {
        onUnmount: vi.fn(),
        use: vi.fn(),
      },
    })

    snapshot.identityKey = 'anonymous'
    snapshot.identityGeneration = 2
    snapshot.error = new ConvexCallError({
      kind: 'authentication',
      message: 'Authentication is temporarily unavailable',
    })
    for (const subscriber of subscribers) subscriber()

    expect(identityState.value).toBe(ANONYMOUS_IDENTITY)
    expect(authErrorState.value).toBe('Authentication is temporarily unavailable')
    expect(pendingState.value).toBe(false)

    snapshot.identityKey = 'user:alice'
    snapshot.identityGeneration = 3
    snapshot.error = null
    adapterCallbacks.authenticated?.('replacement-token', {
      id: 'alice',
      name: 'Alice',
    })
    for (const subscriber of subscribers) subscriber()

    expect(identityState.value.status).toBe('authenticated')
    expect(identityState.value.status === 'authenticated' ? identityState.value.token : null).toBe(
      'replacement-token',
    )
    expect(authErrorState.value).toBeNull()
  })
})
