import { createBetterConvex } from '@lupinum/better-convex-vue'
import type { AuthTokenFetcher } from 'convex/browser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, shallowRef, type App } from 'vue'

import { createTestTransport, drainMicrotasks } from '../../packages/vue/src/test/transport'
import {
  ANONYMOUS_IDENTITY,
  toAuthenticatedIdentity,
  type AuthIdentity,
} from '../../src/runtime/auth/auth-identity'
import type { ConvexRuntimeContext } from '../../src/runtime/runtime-context'

const { clearNuxtDataMock, createAuthClientMock, state, wire } = vi.hoisted(() => ({
  clearNuxtDataMock: vi.fn(),
  createAuthClientMock: vi.fn(),
  state: {
    identity: undefined as unknown as { value: AuthIdentity },
    pending: undefined as unknown as { value: boolean },
    error: undefined as unknown as { value: string | null },
  },
  // The external Convex server decides when authentication is accepted.
  wire: { autoConfirm: true, confirmations: [] as Array<() => void> },
}))

vi.mock('#app', () => ({
  clearNuxtData: clearNuxtDataMock,
  defineNuxtPlugin: (plugin: unknown) => plugin,
  useRuntimeConfig: () => ({ public: { convex: {} } }),
  useState: (key: string) => (key === 'convex:authError' ? state.error : shallowRef(null)),
}))
vi.mock('#convex/auth-client', () => ({ default: { options: {} } }))
vi.mock('better-auth/vue', () => ({ createAuthClient: createAuthClientMock }))
vi.mock('convex/browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('convex/browser')>()),
  ConvexClient: vi.fn(function () {
    const client = createTestTransport().createClient()
    return {
      ...client,
      setAuth(fetchToken: AuthTokenFetcher, onChange: (authenticated: boolean) => void) {
        void fetchToken({ forceRefreshToken: false }).then((token) => {
          const confirm = () => onChange(Boolean(token))
          if (wire.autoConfirm) confirm()
          else wire.confirmations.push(confirm)
        })
      },
    }
  }),
}))
vi.mock('../../src/runtime/utils/auth-identity-state', () => ({
  useConvexIdentityState: () => state.identity,
}))
vi.mock('../../src/runtime/utils/auth-pending-state', () => ({
  useConvexAuthPendingState: () => state.pending,
}))
vi.mock('../../src/runtime/utils/runtime-config', () => ({
  getConvexRuntimeConfig: () => ({
    url: 'https://demo.convex.cloud',
    auth: { defaultQueryAuth: 'optional' },
    experimental: { keepAlive: { ms: 60_000, max: 30 } },
  }),
}))
// Real runtime, observed only to check the options the plugin passes in.
vi.mock('@lupinum/better-convex-vue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lupinum/better-convex-vue')>()
  return { ...actual, createBetterConvex: vi.fn(actual.createBetterConvex) }
})

// Only the Better Auth network/client state is simulated. The adapter, runtime,
// refresh seam, session synchronization and Nuxt context are real.
function provider() {
  const session = shallowRef({
    isPending: false,
    data: { session: { token: 'session-alice' }, user: { id: 'alice' } } as {
      session: { token: string }
      user: { id: string }
    } | null,
    error: null as unknown,
    refetch: vi.fn(async () => {}),
  })
  const signalListeners = new Set<() => void>()
  let signal = false
  const fire = () =>
    setTimeout(() => {
      signal = !signal
      for (const listener of signalListeners) listener()
    }, 10)
  const token = vi.fn(async () => ({ data: { token: jwt('Alice') }, error: null }))
  const client = {
    useSession: () => session,
    convex: { token },
    $store: {
      atoms: {
        $sessionSignal: {
          get: () => signal,
          listen(listener: () => void) {
            signalListeners.add(listener)
            return () => signalListeners.delete(listener)
          },
        },
      },
    },
    signIn: {
      email: vi.fn(async () => {
        fire()
        return { data: { user: { id: 'alice' } }, error: null }
      }),
    },
    signOut: vi.fn(async () => ({ data: { success: true }, error: null })),
    updateUser: vi.fn(async () => {
      fire()
      return { data: { status: true }, error: null }
    }),
    updateSession: vi.fn(async () => {
      fire()
      return { data: { ok: true }, error: null }
    }),
    twoFactor: {
      enable: vi.fn(async () => {
        fire()
        return { data: { totpURI: 'synthetic' }, error: null }
      }),
    },
    organization: {
      list: vi.fn(async () => ({ data: [{ id: 'org-1' }], error: null })),
      getFullOrganization: vi.fn(async () => {
        throw new Error('organization list unavailable')
      }),
    },
  }
  return { client, session, token, listenerCount: () => signalListeners.size }
}

function jwt(name: string) {
  const now = Math.floor(Date.now() / 1000)
  return `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: 'alice', name, iat: now, exp: now + 900 })).toString('base64url')}.signature`
}

let source: ReturnType<typeof provider>
let runtime: ConvexRuntimeContext
let app: App
let unmountCallbacks: Array<() => void> = []

async function setupPlugin(
  payload = { data: {} as Record<string, unknown>, state: {}, serverRendered: true },
) {
  const plugin = (await import('../../src/runtime/plugin.auth.client')).default
  const provide = vi.fn((key: string, value: ConvexRuntimeContext) => {
    if (key === 'convexRuntime') runtime = value
  })
  app = createApp({ render: () => null })
  // Nuxt owns mounting; drive its teardown hooks without a DOM in this unit suite.
  unmountCallbacks = []
  vi.spyOn(app, 'onUnmount').mockImplementation((callback) => {
    unmountCallbacks.push(callback)
  })
  // Nuxt calls this setup with the same payload, provide and Vue app surfaces.
  const setup = plugin.setup as unknown as (input: {
    payload: typeof payload
    provide: typeof provide
    vueApp: App
  }) => void
  setup({ payload, provide, vueApp: app })
  await drainMicrotasks()
  return provide
}
function controller() {
  return runtime.getAuthController()! as {
    client: ReturnType<typeof provider>['client']
    ready(): Promise<string>
    dispose(): void
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('window', { location: { origin: 'https://app.example.com' } })
  wire.autoConfirm = true
  wire.confirmations = []
  state.identity = shallowRef(toAuthenticatedIdentity({ id: 'alice', name: 'Alice' }))
  state.pending = shallowRef(false)
  state.error = shallowRef(null)
  source = provider()
  createAuthClientMock.mockReturnValue(source.client)
})
afterEach(async () => {
  for (const callback of unmountCallbacks) callback()
  runtime?.dispose()
  await drainMicrotasks()
})

describe('auth client app-facing state projection', () => {
  it('does not drop experimental.keepAlive when starting the authenticated runtime', async () => {
    await setupPlugin()
    expect(createBetterConvex).toHaveBeenCalledWith(
      expect.objectContaining({ experimental: { keepAlive: { ms: 60_000, max: 30 } } }),
    )
  })

  it('fails closed when the canonical refresh rejects', async () => {
    await setupPlugin()
    source.session.value.refetch.mockRejectedValueOnce(new Error('network unavailable'))
    await expect(controller().client.twoFactor.enable()).rejects.toMatchObject({
      kind: 'authentication',
    })
    expect(state.identity.value).toBe(ANONYMOUS_IDENTITY)
    expect(state.error.value).toBe('Authentication failed')
  })

  it('projects a later canonical identity failure into Nuxt auth state and recovers', async () => {
    await setupPlugin()
    expect(clearNuxtDataMock).not.toHaveBeenCalled()
    source.session.value = { ...source.session.value, error: { status: 401 }, data: null }
    await drainMicrotasks()
    expect(state.identity.value).toBe(ANONYMOUS_IDENTITY)
    expect(state.error.value).toBe('Authentication failed')
    expect(state.pending.value).toBe(false)
    expect(clearNuxtDataMock).toHaveBeenCalledTimes(1)
    source.session.value = {
      ...source.session.value,
      error: null,
      data: { session: { token: 'replacement' }, user: { id: 'alice' } },
    }
    await drainMicrotasks()
    expect(state.identity.value).toEqual({
      status: 'authenticated',
      user: { id: 'alice', name: 'Alice' },
      key: 'user:alice',
    })
    expect(state.error.value).toBeNull()
    expect(clearNuxtDataMock).toHaveBeenCalledTimes(2)
  })

  it('purges a mismatched initial browser identity once, then purges later generations once', async () => {
    source.session.value = { ...source.session.value, data: null }
    const payload = {
      data: {
        'convex:notes:list:auth:optional:user:alice': { value: 'alice' },
        'convex:notes:mine:auth:required:user:alice': { error: { message: 'alice-error' } },
        'convex:status:list:auth:none': { error: { message: 'public' } },
      } as Record<string, unknown>,
      state: {},
      serverRendered: true,
    }
    await setupPlugin(payload)
    expect(clearNuxtDataMock).toHaveBeenCalledTimes(1)
    expect(Object.keys(payload.data)).toEqual(['convex:status:list:auth:none'])
    payload.data['convex:notes:list:auth:required:anonymous'] = { value: 'private' }
    source.session.value = {
      ...source.session.value,
      data: { session: { token: 'new-session' }, user: { id: 'alice' } },
    }
    await drainMicrotasks()
    expect(clearNuxtDataMock).toHaveBeenCalledTimes(2)
    expect(Object.keys(payload.data)).toEqual(['convex:status:list:auth:none'])
  })

  it('settles integrated sign-in only after Convex confirms the new identity', async () => {
    source.session.value = { ...source.session.value, data: null }
    state.identity.value = ANONYMOUS_IDENTITY
    const provide = await setupPlugin()
    wire.autoConfirm = false
    source.session.value.refetch.mockImplementationOnce(async () => {
      source.session.value = {
        ...source.session.value,
        data: { session: { token: 'new-session' }, user: { id: 'alice' } },
      }
    })
    let settled = false
    const signIn = controller()
      .client.signIn.email()
      .then(() => {
        settled = true
      })
    await vi.waitFor(() => expect(wire.confirmations).toHaveLength(1))
    expect(settled).toBe(false)
    expect(runtime.attachment.identity.snapshot().settled).toBe(false)
    // ready() returns what useConvexAuth() shows, not the unconfirmed runtime state.
    expect(state.pending.value).toBe(false)
    expect(await controller().ready()).toBe('anonymous')
    wire.confirmations.shift()!()
    await signIn
    expect(settled).toBe(true)
    expect(await controller().ready()).toBe('authenticated')
    expect(source.client.signIn.email).toHaveBeenCalledOnce()
    expect(provide).toHaveBeenCalledWith('convexRuntime', runtime)
    expect(provide).not.toHaveBeenCalledWith('auth', expect.anything())
    expect(controller().client.convex).toBeUndefined()
  })

  it('accepts a late provider token for an already-settled matching SSR generation', async () => {
    source.session.value = { ...source.session.value, isPending: true }
    await setupPlugin()
    source.session.value = { ...source.session.value, isPending: false }
    await drainMicrotasks()
    await expect(controller().client.updateSession()).resolves.toEqual({
      data: { ok: true },
      error: null,
    })
    expect(source.session.value.refetch).toHaveBeenCalledOnce()
  })

  it('reconfirms a changed Convex token before resolving a same-session operation', async () => {
    await setupPlugin()
    wire.autoConfirm = false
    source.token.mockResolvedValue({ data: { token: jwt('Updated Alice') }, error: null })
    let settled = false
    const operation = controller()
      .client.updateUser()
      .then(() => {
        settled = true
      })
    await vi.waitFor(() => expect(wire.confirmations).toHaveLength(1))
    expect(settled).toBe(false)
    // Same user: profile fields may update before confirmation, but the
    // signed-in identity and the operation wait for Convex.
    expect(state.identity.value.status).toBe('authenticated')
    wire.confirmations.shift()!()
    await operation
    expect(settled).toBe(true)
    expect(
      state.identity.value.status === 'authenticated' ? state.identity.value.user.name : null,
    ).toBe('Updated Alice')
    expect(source.client.updateUser).toHaveBeenCalledOnce()
  })

  it('resolves read-only calls without refreshing auth or minting', async () => {
    await setupPlugin()
    source.token.mockClear()
    await expect(controller().client.organization.list()).resolves.toEqual({
      data: [{ id: 'org-1' }],
      error: null,
    })
    await expect(controller().client.organization.getFullOrganization()).rejects.toThrow(
      'organization list unavailable',
    )
    expect(source.session.value.refetch).not.toHaveBeenCalled()
    expect(source.token).not.toHaveBeenCalled()
    expect(state.error.value).toBeNull()
    expect(source.listenerCount()).toBe(1)
    controller().dispose()
    expect(source.listenerCount()).toBe(0)
  })
})
