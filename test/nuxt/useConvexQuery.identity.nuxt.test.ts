import type { AuthTokenFetcher } from 'convex/browser'
import { getFunctionName, type FunctionReference } from 'convex/server'
import { hash } from 'ohash'
import { describe, expect, it, vi } from 'vitest'
import { onMounted, ref, watch } from 'vue'

import { onNuxtReady, useNuxtApp, useState } from '#imports'

import { createBetterConvexBrowserRuntime } from '../../packages/vue/src/internal/browser-runtime'
import type { OwnedConvexClient } from '../../packages/vue/src/internal/client-owner'
import type { ConvexIdentityKey } from '../../packages/vue/src/internal/identity-key'
import type { ClientIdentitySnapshot } from '../../packages/vue/src/internal/identity-port'
import { toAuthenticatedIdentity, type AuthIdentity } from '../../src/runtime/auth/auth-identity'
import { createBetterAuthBrowserAdapter } from '../../src/runtime/auth/better-auth-browser-adapter'
import { createConvexQueryState } from '../../src/runtime/composables/useConvexQuery'
import { ConvexCallError } from '../../src/runtime/errors'
import { createConvexPayloadKey } from '../../src/runtime/utils/convex-cache'
import { makeMockOwner } from '../helpers/mock-client-owner'
import { MockConvexClient, mockFnRef } from '../helpers/mock-convex-client'
import { captureInNuxt, createIdentityObserverHarness } from '../helpers/nuxt-runtime-harness'
import { waitFor } from '../helpers/wait-for'

function userAKey(query: FunctionReference<'query'>, auth: 'optional' | 'required') {
  return createConvexPayloadKey('convex', getFunctionName(query), hash({}), auth, 'user:A')
}

/** Run a factory as a hydrating Nuxt app would, then settle hydration after mount. */
function hydrating<T>(factory: () => T): T {
  const nuxtApp = useNuxtApp()
  nuxtApp.isHydrating = true
  const result = factory()
  onMounted(() => {
    nuxtApp.isHydrating = false
    void nuxtApp.callHook('app:suspense:resolve')
  })
  return result
}

const snapshot = (
  identityKey: ConvexIdentityKey,
  identityGeneration: number,
  settled = true,
): ClientIdentitySnapshot => ({
  authEnabled: true,
  settled,
  identityKey,
  identityGeneration,
  error: null,
})

/** Hydrate a query the server rendered for user A while the browser identity port reports `initial`. */
async function hydrateUserA(
  name: string,
  initial: ClientIdentitySnapshot,
  payload: { value: unknown } | { error: ConvexCallError },
  auth: 'optional' | 'required' = 'optional',
) {
  const primary = new MockConvexClient()
  const query = mockFnRef<'query'>(name)
  const identityPort = createIdentityObserverHarness(initial)
  const harness = await captureInNuxt(
    () =>
      hydrating(() => {
        useState<boolean>('convex:pending').value = false
        const identity = useState<AuthIdentity>('convex:identity')
        identity.value = toAuthenticatedIdentity({ id: 'A' })
        return { identity, query: createConvexQueryState(query, {}, { auth }).resultData }
      }),
    {
      owner: makeMockOwner(primary),
      identityObserver: identityPort.observer,
      payloadData: { [userAKey(query, auth)]: payload },
    },
  )
  return { ...harness, primary, identityPort }
}

// Identity-owned state clears synchronously on an identity change,
// keepPreviousData never crosses an identity boundary, and a result captured
// under a stale identity cannot commit after the switch.
describe('useConvexQuery identity isolation', () => {
  it.each(['optional', 'required'] as const)(
    'retains matching %s SSR data through first identity settlement without a duplicate query',
    async (auth) => {
      const { result, primary, identityPort, wrapper } = await hydrateUserA(
        `notes:hydrated-${auth}`,
        snapshot('user:A', 0, false),
        { value: { owner: 'A', source: 'ssr' } },
        auth,
      )

      expect(result.query.data.value).toEqual({ owner: 'A', source: 'ssr' })
      expect(primary.calls.onUpdate).toHaveLength(0)

      identityPort.set(snapshot('user:A', 0))
      await waitFor(() => primary.calls.onUpdate.length === 1)

      expect(result.query.data.value).toEqual({ owner: 'A', source: 'ssr' })
      expect(primary.calls.onUpdate).toHaveLength(1)
      wrapper.unmount()
    },
  )

  it('retires a hydrated SSR error when the browser identity changes', async () => {
    const ssrError = new ConvexCallError({
      kind: 'transport',
      message: 'Sanitized SSR transport failure',
      status: 500,
    })
    const { result, primary, identityPort, flush, wrapper } = await hydrateUserA(
      'notes:hydrated-error-identity-boundary',
      snapshot('user:A', 0),
      { error: ssrError },
    )

    expect(result.query.error.value).toBe(ssrError)
    expect(result.query.status.value).toBe('error')
    await waitFor(() => primary.calls.onUpdate.length === 1)
    expect(result.query.error.value).toBe(ssrError)

    result.identity.value = toAuthenticatedIdentity({ id: 'B' })
    identityPort.set(snapshot('user:B', 1))
    await flush()

    expect(result.query.error.value).toBeUndefined()
    expect(result.query.status.value).toBe('pending')
    expect(result.query.data.value).toBeUndefined()
    wrapper.unmount()
  })

  it('retires hydrated protected data on an identity change, even when the key returns to A', async () => {
    const { result, identityPort, wrapper } = await hydrateUserA(
      'notes:hydrated-generation-fence',
      snapshot('user:A', 0),
      { value: { owner: 'A' } },
    )
    expect(result.query.data.value).toEqual({ owner: 'A' })

    identityPort.set(snapshot('user:B', 1))
    expect(result.query.data.value).toBeUndefined()
    expect(result.query.status.value).not.toBe('success')
    identityPort.set(snapshot('user:A', 2, false))
    expect(result.query.data.value).toBeUndefined()
    wrapper.unmount()
  })

  it.each([
    { label: 'another browser user', initial: snapshot('user:B', 0, false) },
    { label: 'an anonymous browser', initial: snapshot('anonymous', 0) },
  ])('rejects user A SSR data for $label before use', async ({ initial }) => {
    const { result, wrapper } = await hydrateUserA('notes:mismatched-hydration', initial, {
      value: { owner: 'A' },
    })

    expect(result.query.data.value).toBeUndefined()
    wrapper.unmount()
  })

  it('clears data on A->B, never carries keepPreviousData across, and drops a late A result', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:mine')

    const { result, flush, wrapper } = await captureInNuxt(
      () => {
        useState<boolean>('convex:pending').value = false
        const identity = useState<AuthIdentity>('convex:identity')
        identity.value = toAuthenticatedIdentity({ id: 'A' })
        const q = createConvexQueryState(
          query,
          {},
          { auth: 'optional', keepPreviousData: true },
        ).resultData
        return { q, identity }
      },
      { owner: makeMockOwner(primary) },
    )

    await flush()
    primary.emitQueryResultWhere(() => true, { owner: 'A' })
    await flush()
    expect(result.q.data.value).toEqual({ owner: 'A' })

    // Capture A's live callback, switch to B, then fire the stale A callback.
    const lateA = primary.queuedQueryResultByPath('notes:mine', { owner: 'A-stale' })
    result.identity.value = toAuthenticatedIdentity({ id: 'B' })
    lateA()
    await flush()

    // A's data is gone, keepPreviousData did not carry it into B, and the late A value did not commit.
    expect(result.q.data.value).toBeUndefined()

    // B's result commits under B.
    primary.emitQueryResultWhere(() => true, { owner: 'B' })
    await flush()
    expect(result.q.data.value).toEqual({ owner: 'B' })

    wrapper.unmount()
  })
})

// The real chain: Better Auth adapter, identity port, client owner and query
// lifecycle. Only the provider session and the Convex wire are doubles.
describe('SSR hydration with auth enabled (F-016)', () => {
  class Wire extends MockConvexClient {
    close = vi.fn(async () => {})
    authChange: ((accepted: boolean) => void) | undefined
    setAuth(_fetch: AuthTokenFetcher, onChange: (accepted: boolean) => void) {
      this.authChange = onChange
    }
  }
  type Session = {
    isPending: boolean
    data: null | { session: { token: string }; user: { id: string } }
    error: null
  }
  const signedInAs = (id: string): Session => ({
    isPending: false,
    data: { session: { token: `session-${id}` }, user: { id } },
    error: null,
  })

  it.each([
    { name: 'anonymous render, provider confirms anonymous', ssr: null, provider: null },
    { name: 'user A render, Convex confirms A after hydration', ssr: 'A', provider: 'A' },
  ] as const)('$name: SSR data stays, no pending, one client', async ({ ssr, provider }) => {
    const session = ref<Session>({ isPending: true, data: null, error: null })
    const clients: Wire[] = []
    const adapter = createBetterAuthBrowserAdapter(
      { useSession: () => session, convex: { token: async () => ({ data: null, error: null }) } },
      undefined,
      { initialIdentityKey: ssr },
    )
    const runtime = createBetterConvexBrowserRuntime({
      auth: adapter,
      clientFactory() {
        clients.push(new Wire())
        return clients.at(-1) as unknown as OwnedConvexClient
      },
    })
    const query = mockFnRef<'query'>(`notes:f016-${ssr ?? 'anonymous'}`)
    const identity: ConvexIdentityKey = ssr ? `user:${ssr}` : 'anonymous'
    const payloadData = {
      [createConvexPayloadKey('convex', getFunctionName(query), hash({}), 'optional', identity)]: {
        value: 'ssr',
      },
    }
    const seen: string[] = []
    let liveHandoff = false
    const { result, flush, wrapper } = await captureInNuxt(
      () =>
        hydrating(() => {
          // Registered after the query, so it runs after the query went live.
          onNuxtReady(() => {
            liveHandoff = true
          })
          useState<boolean>('convex:pending').value = false
          if (ssr) {
            useState<AuthIdentity>('convex:identity').value = toAuthenticatedIdentity({
              id: ssr,
            })
          }
          const state = createConvexQueryState(query, {}).resultData
          watch(
            () => `${state.status.value}/${String(state.data.value)}`,
            (value) => seen.push(value),
            { immediate: true },
          )
          return state
        }),
      { convex: runtime.handle, identityObserver: runtime.identity, payloadData },
    )
    const generationAtHydration = runtime.identity.snapshot().identityGeneration
    // Auth settles after the live handoff, the order that made the page flash.
    await waitFor(() => liveHandoff)
    await flush()

    session.value = provider ? signedInAs(provider) : { isPending: false, data: null, error: null }
    await flush()
    if (provider) clients[0]!.authChange!(true)
    await runtime.ready()
    await waitFor(() => clients[0]!.calls.onUpdate.length > 0)
    clients[0]!.emitQueryResultByPath(getFunctionName(query), 'live')
    await flush()

    expect(new Set(seen)).toEqual(new Set(['success/ssr', 'success/live']))
    expect(result.data.value).toBe('live')
    expect(runtime.identity.snapshot().identityGeneration).toBe(generationAtHydration)
    expect(clients).toHaveLength(1)
    wrapper.unmount()
    await runtime.dispose()
    adapter.dispose()
  })

  it('anonymous render, provider finds user A: drops the anonymous data and runs as A', async () => {
    const session = ref<Session>({ isPending: true, data: null, error: null })
    const clients: Wire[] = []
    const adapter = createBetterAuthBrowserAdapter(
      { useSession: () => session, convex: { token: async () => ({ data: null, error: null }) } },
      undefined,
      { initialIdentityKey: null },
    )
    const runtime = createBetterConvexBrowserRuntime({
      auth: adapter,
      clientFactory() {
        clients.push(new Wire())
        return clients.at(-1) as unknown as OwnedConvexClient
      },
    })
    const query = mockFnRef<'query'>('notes:f016-found-session')
    const payloadData = {
      [createConvexPayloadKey('convex', getFunctionName(query), hash({}), 'optional', 'anonymous')]:
        {
          value: 'anonymous-ssr',
        },
    }
    const { result, flush, wrapper } = await captureInNuxt(
      () =>
        hydrating(() => {
          useState<boolean>('convex:pending').value = false
          return createConvexQueryState(query, {}).resultData
        }),
      { convex: runtime.handle, identityObserver: runtime.identity, payloadData },
    )
    const generationAtHydration = runtime.identity.snapshot().identityGeneration

    session.value = signedInAs('A')
    await flush()
    expect(result.data.value).toBeUndefined()
    expect(runtime.identity.snapshot()).toMatchObject({
      identityKey: 'user:A',
      identityGeneration: generationAtHydration + 1,
    })
    const userClient = clients.at(-1)!
    userClient.authChange!(true)
    await runtime.ready()
    await waitFor(() => userClient.calls.onUpdate.length > 0)
    userClient.emitQueryResultByPath(getFunctionName(query), 'for-A')
    await flush()
    expect(result.data.value).toBe('for-A')
    wrapper.unmount()
    await runtime.dispose()
    adapter.dispose()
  })
})
