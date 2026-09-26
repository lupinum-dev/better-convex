import { getFunctionName, type FunctionReference } from 'convex/server'
import { hash } from 'ohash'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { onMounted } from 'vue'

import { useNuxtApp, useState } from '#imports'

import { toAuthenticatedIdentity, type AuthIdentity } from '../../src/runtime/auth/auth-identity'
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

afterEach(() => {
  vi.clearAllMocks()
})

// Identity-owned state clears synchronously on an identity change,
// keepPreviousData never crosses an identity boundary, and a result captured
// under a stale identity cannot commit after the switch.
describe('useConvexQuery identity isolation', () => {
  it.each(['optional', 'required'] as const)(
    'retains matching %s SSR data through first identity settlement without a duplicate query',
    async (auth) => {
      const primary = new MockConvexClient()
      const query = mockFnRef<'query'>(`notes:hydrated-${auth}`)
      const key = userAKey(query, auth)
      const identityPort = createIdentityObserverHarness({
        authEnabled: true,
        settled: false,
        identityKey: 'user:A',
        identityGeneration: 0,
        error: null,
      })

      const { result, wrapper } = await captureInNuxt(
        () =>
          hydrating(() => {
            const pending = useState<boolean>('convex:pending', () => false)
            const identity = useState<AuthIdentity>('convex:identity')
            pending.value = false
            identity.value = toAuthenticatedIdentity('jwt-A', { id: 'A' })
            return createConvexQueryState(query, {}, { auth }).resultData
          }),
        {
          owner: makeMockOwner(primary),
          identityObserver: identityPort.observer,
          payloadData: { [key]: { value: { owner: 'A', source: 'ssr' } } },
        },
      )

      expect(result.data.value).toEqual({ owner: 'A', source: 'ssr' })
      expect(primary.calls.onUpdate).toHaveLength(0)

      identityPort.set({
        authEnabled: true,
        settled: true,
        identityKey: 'user:A',
        identityGeneration: 0,
        error: null,
      })
      await waitFor(() => primary.calls.onUpdate.length === 1)

      expect(result.data.value).toEqual({ owner: 'A', source: 'ssr' })
      expect(primary.calls.onUpdate).toHaveLength(1)
      wrapper.unmount()
    },
  )

  it('retires a hydrated SSR error when the browser identity changes', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:hydrated-error-identity-boundary')
    const key = userAKey(query, 'optional')
    const ssrError = new ConvexCallError({
      kind: 'transport',
      message: 'Sanitized SSR transport failure',
      status: 500,
    })
    const identityPort = createIdentityObserverHarness({
      authEnabled: true,
      settled: true,
      identityKey: 'user:A',
      identityGeneration: 0,
      error: null,
    })

    const { result, flush, wrapper } = await captureInNuxt(
      () =>
        hydrating(() => {
          const identity = useState<AuthIdentity>('convex:identity')
          identity.value = toAuthenticatedIdentity('jwt-A', { id: 'A' })
          return {
            identity,
            query: createConvexQueryState(query, {}, { auth: 'optional' }).resultData,
          }
        }),
      {
        owner: makeMockOwner(primary),
        identityObserver: identityPort.observer,
        payloadData: { [key]: { error: ssrError } },
      },
    )

    expect(result.query.error.value).toBe(ssrError)
    expect(result.query.status.value).toBe('error')
    await waitFor(() => primary.calls.onUpdate.length === 1)
    expect(result.query.error.value).toBe(ssrError)

    result.identity.value = toAuthenticatedIdentity('jwt-B', { id: 'B' })
    identityPort.set({
      authEnabled: true,
      settled: true,
      identityKey: 'user:B',
      identityGeneration: 1,
      error: null,
    })
    await flush()

    expect(result.query.error.value).toBeUndefined()
    expect(result.query.status.value).toBe('pending')
    expect(result.query.data.value).toBeUndefined()
    wrapper.unmount()
  })

  it('retires hydrated protected data when the browser identity changes', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:hydrated-data-identity-boundary')
    const key = userAKey(query, 'optional')
    const identityPort = createIdentityObserverHarness({
      authEnabled: true,
      settled: true,
      identityKey: 'user:A',
      identityGeneration: 0,
      error: null,
    })

    const { result, wrapper } = await captureInNuxt(
      () =>
        hydrating(() => {
          const pending = useState<boolean>('convex:pending', () => false)
          const identity = useState<AuthIdentity>('convex:identity')
          pending.value = false
          identity.value = toAuthenticatedIdentity('jwt-A', { id: 'A' })
          return createConvexQueryState(query, {}, { auth: 'optional' }).resultData
        }),
      {
        owner: makeMockOwner(primary),
        identityObserver: identityPort.observer,
        payloadData: { [key]: { value: { owner: 'A' } } },
      },
    )

    expect(result.data.value).toEqual({ owner: 'A' })
    identityPort.set({
      authEnabled: true,
      settled: true,
      identityKey: 'user:B',
      identityGeneration: 1,
      error: null,
    })
    expect(result.data.value).toBeUndefined()
    expect(result.status.value).not.toBe('success')
    wrapper.unmount()
  })

  it.each([
    {
      label: 'another browser user',
      snapshot: {
        authEnabled: true,
        settled: false,
        identityKey: 'user:B' as const,
        identityGeneration: 0,
        error: null,
      },
    },
    {
      label: 'an anonymous browser',
      snapshot: {
        authEnabled: true,
        settled: true,
        identityKey: 'anonymous' as const,
        identityGeneration: 0,
        error: null,
      },
    },
  ])('rejects user A SSR data for $label before use', async ({ snapshot }) => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:mismatched-hydration')
    const key = userAKey(query, 'optional')
    const identityPort = createIdentityObserverHarness(snapshot)

    const { result, wrapper } = await captureInNuxt(
      () =>
        hydrating(() => {
          const pending = useState<boolean>('convex:pending', () => false)
          const identity = useState<AuthIdentity>('convex:identity')
          pending.value = false
          identity.value = toAuthenticatedIdentity('jwt-A', { id: 'A' })
          return createConvexQueryState(query, {}, { auth: 'optional' }).resultData
        }),
      {
        owner: makeMockOwner(primary),
        identityObserver: identityPort.observer,
        payloadData: { [key]: { value: { owner: 'A' } } },
      },
    )

    expect(result.data.value).toBeUndefined()
    wrapper.unmount()
  })

  it('clears hydrated data on later generations even when the identity key returns to A', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:hydrated-generation-fence')
    const key = userAKey(query, 'optional')
    const identityPort = createIdentityObserverHarness({
      authEnabled: true,
      settled: true,
      identityKey: 'user:A',
      identityGeneration: 0,
      error: null,
    })

    const { result, wrapper } = await captureInNuxt(
      () =>
        hydrating(() => {
          const pending = useState<boolean>('convex:pending', () => false)
          const identity = useState<AuthIdentity>('convex:identity')
          pending.value = false
          identity.value = toAuthenticatedIdentity('jwt-A', { id: 'A' })
          return createConvexQueryState(query, {}, { auth: 'optional' }).resultData
        }),
      {
        owner: makeMockOwner(primary),
        identityObserver: identityPort.observer,
        payloadData: { [key]: { value: { owner: 'A' } } },
      },
    )
    expect(result.data.value).toEqual({ owner: 'A' })

    identityPort.set({
      authEnabled: true,
      settled: false,
      identityKey: 'user:B',
      identityGeneration: 1,
      error: null,
    })
    expect(result.data.value).toBeUndefined()
    identityPort.set({
      authEnabled: true,
      settled: false,
      identityKey: 'user:A',
      identityGeneration: 2,
      error: null,
    })
    expect(result.data.value).toBeUndefined()
    wrapper.unmount()
  })

  it('drops a deferred one-shot result resolved during the synchronous A-to-B window', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:deferred-once')
    let resolveA!: (value: unknown) => void
    let calls = 0
    primary.setQueryHandler('notes:deferred-once', () => {
      calls += 1
      return calls === 1
        ? new Promise((resolve) => (resolveA = resolve))
        : Promise.resolve({ owner: 'B' })
    })

    const { result, flush, wrapper } = await captureInNuxt(
      () => {
        const pending = useState<boolean>('convex:pending', () => false)
        const identity = useState<AuthIdentity>('convex:identity')
        pending.value = false
        identity.value = toAuthenticatedIdentity('jwt-A', { id: 'A' })
        const q = createConvexQueryState(query, {}, { auth: 'optional' }).resultData
        return { q, identity }
      },
      { owner: makeMockOwner(primary) },
    )

    const refresh = result.q.refresh()
    await Promise.resolve()
    result.identity.value = toAuthenticatedIdentity('jwt-B', { id: 'B' })
    resolveA({ owner: 'A' })
    await refresh
    expect(result.q.data.value).not.toEqual({ owner: 'A' })
    expect(result.q.error.value).toBeUndefined()

    await flush()
    wrapper.unmount()
  })

  it('clears data on A->B and never carries keepPreviousData across the boundary', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:mine')

    const { result, flush, wrapper } = await captureInNuxt(
      () => {
        const pending = useState<boolean>('convex:pending', () => false)
        const identity = useState<AuthIdentity>('convex:identity')
        pending.value = false
        identity.value = toAuthenticatedIdentity('jwt-A', { id: 'A' })
        const q = createConvexQueryState(
          query,
          {},
          {
            auth: 'optional',
            keepPreviousData: true,
          },
        ).resultData
        return { q, pending, identity }
      },
      { owner: makeMockOwner(primary) },
    )

    await flush()

    // A's live result arrives.
    primary.emitQueryResultWhere(() => true, { owner: 'A' })
    await flush()
    expect(result.q.data.value).toEqual({ owner: 'A' })

    // Switch to user B.
    result.identity.value = toAuthenticatedIdentity('jwt-B', { id: 'B' })
    await flush()

    // A's data is gone and keepPreviousData did not carry it into B.
    expect(result.q.data.value).toBeUndefined()

    // B's result commits under B.
    primary.emitQueryResultWhere(() => true, { owner: 'B' })
    await flush()
    expect(result.q.data.value).toEqual({ owner: 'B' })

    wrapper.unmount()
  })

  it('rejects a stale-identity result captured under A after B becomes current', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:stale')

    const { result, flush, wrapper } = await captureInNuxt(
      () => {
        const pending = useState<boolean>('convex:pending', () => false)
        const identity = useState<AuthIdentity>('convex:identity')
        pending.value = false
        identity.value = toAuthenticatedIdentity('jwt-A', { id: 'A' })
        const q = createConvexQueryState(query, {}, { auth: 'optional' }).resultData
        return { q, pending, identity }
      },
      { owner: makeMockOwner(primary) },
    )

    await flush()
    primary.emitQueryResultWhere(() => true, { owner: 'A' })
    await flush()
    expect(result.q.data.value).toEqual({ owner: 'A' })

    // Capture A's live callback set, switch to B, then fire the stale A callback.
    // Because the composable tears down A's listener on the identity change, and
    // any surviving A-tagged commit is masked, no A value reappears under B.
    const lateA = primary.queuedQueryResultByPath('notes:stale', { owner: 'A-stale' })
    result.identity.value = toAuthenticatedIdentity('jwt-B', { id: 'B' })
    // A late emission targeting the (now-removed) A listener must not commit.
    lateA()
    await flush()
    expect(result.q.data.value).not.toEqual({ owner: 'A-stale' })
    expect(result.q.data.value).toBeUndefined()

    wrapper.unmount()
  })
})
