import { getFunctionName } from 'convex/server'
import { hash } from 'ohash'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { onMounted } from 'vue'

import { useNuxtApp, useState } from '#imports'

import {
  ANONYMOUS_IDENTITY,
  toAuthenticatedIdentity,
  type AuthIdentity,
} from '../../src/runtime/auth/auth-identity'
import { useConvexPaginatedQuery } from '../../src/runtime/composables/useConvexPaginatedQuery'
import { useConvexQuery } from '../../src/runtime/composables/useConvexQuery'
import { createConvexPayloadKey } from '../../src/runtime/utils/convex-cache'
import { makeMockOwner } from '../helpers/mock-client-owner'
import { MockConvexClient, mockFnRef } from '../helpers/mock-convex-client'
import { captureInNuxt, createIdentityObserverHarness } from '../helpers/nuxt-runtime-harness'
import { waitFor } from '../helpers/wait-for'

const requiredByDefault = {
  auth: { origin: 'http://localhost:3000', defaultQueryAuth: 'required' },
}

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

describe('convex.auth.defaultQueryAuth', () => {
  it('gates queries that omit auth, while an explicit auth still wins', async () => {
    const primary = new MockConvexClient()
    const defaulted = mockFnRef<'query'>('notes:default-required')
    const explicit = mockFnRef<'query'>('notes:explicit-optional')
    const paginated = mockFnRef<'query'>('notes:default-required-paginated')

    const { result, flush } = await captureInNuxt(
      () => {
        const pending = useState<boolean>('convex:pending', () => false)
        const identity = useState<AuthIdentity>('convex:identity')
        pending.value = false
        identity.value = ANONYMOUS_IDENTITY
        return {
          defaulted: useConvexQuery(defaulted, {}),
          explicit: useConvexQuery(explicit, {}, { auth: 'optional' }),
          paginated: useConvexPaginatedQuery(paginated as never, {}, { initialNumItems: 5 }),
        }
      },
      { owner: makeMockOwner(primary), convexConfig: requiredByDefault },
    )
    await flush()

    expect(result.defaulted.blockedBy.value).toBe('auth')
    expect(result.defaulted.status.value).toBe('idle')
    expect(result.paginated.blockedBy.value).toBe('auth')
    expect(result.explicit.blockedBy.value).toBeNull()
    expect(primary.activeListenerCount(defaulted, {})).toBe(0)
    expect(primary.activeListenerCount(explicit, {})).toBe(1)
  })

  it('hydrates the SSR payload written under the configured default mode', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:default-required-hydrated')
    // The server keyed its payload with the same resolved default.
    const key = createConvexPayloadKey(
      'convex',
      getFunctionName(query),
      hash({}),
      'required',
      'user:A',
    )
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
          return useConvexQuery(query, {})
        }),
      {
        owner: makeMockOwner(primary),
        identityObserver: identityPort.observer,
        convexConfig: requiredByDefault,
        payloadData: { [key]: { value: { owner: 'A', source: 'ssr' } } },
      },
    )

    expect(result.data.value).toEqual({ owner: 'A', source: 'ssr' })
    await waitFor(() => primary.calls.onUpdate.length === 1)
    expect(result.data.value).toEqual({ owner: 'A', source: 'ssr' })
    wrapper.unmount()
  })
})
