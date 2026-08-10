import { afterEach, describe, expect, it, vi } from 'vitest'

import { useState } from '#imports'

import {
  ANONYMOUS_IDENTITY,
  toAuthenticatedIdentity,
  type AuthIdentity,
} from '../../src/runtime/auth/auth-identity'
import { createConvexQueryState } from '../../src/runtime/composables/useConvexQuery'
import { makeMockOwner } from '../helpers/mock-client-owner'
import { MockConvexClient, mockFnRef } from '../helpers/mock-convex-client'
import { captureInNuxt } from '../helpers/nuxt-runtime-harness'

afterEach(() => {
  vi.clearAllMocks()
})

// public runtime assertions (anonymous transport, architecture invariant): in an
// auth-enabled app, a live `none` query runs through the dedicated anonymous
// client that never receives auth, so an authenticated subject is not observed,
// and sign-in/out/rotation never reacquire the mounted `none` subscription.
describe('useConvexQuery none transport isolation', () => {
  it('routes an authenticated none live query through the anonymous client, not the primary', async () => {
    const primary = new MockConvexClient()
    const anon = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:public:auth-enabled')

    const { flush } = await captureInNuxt(
      () => {
        // Auth is enabled and the subject is signed in.
        useState<boolean>('convex:pending', () => false).value = false
        useState<AuthIdentity>('convex:identity').value = toAuthenticatedIdentity('jwt.signed.in', {
          id: 'u1',
        })
        return createConvexQueryState(query, {}, { auth: 'none' }).resultData
      },
      { owner: makeMockOwner(primary, anon) },
    )

    await flush()

    expect(anon.calls.onUpdate.length).toBe(1)
    expect(primary.calls.onUpdate.length).toBe(0)
  })

  it('does not reacquire a mounted none subscription on sign-in, rotation, or sign-out', async () => {
    const primary = new MockConvexClient()
    const anon = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:public:stable')

    const { result, flush } = await captureInNuxt(
      () => {
        const pending = useState<boolean>('convex:pending', () => false)
        const identity = useState<AuthIdentity>('convex:identity')
        pending.value = false
        identity.value = ANONYMOUS_IDENTITY
        const q = createConvexQueryState(query, {}, { auth: 'none' }).resultData
        return { q, identity }
      },
      { owner: makeMockOwner(primary, anon) },
    )

    await flush()
    expect(anon.calls.onUpdate.length).toBe(1)

    // Sign in.
    result.identity.value = toAuthenticatedIdentity('jwt1', { id: 'u1' })
    await flush()

    // Same-user token rotation.
    result.identity.value = toAuthenticatedIdentity('jwt2', { id: 'u1' })
    await flush()

    // Sign out.
    result.identity.value = ANONYMOUS_IDENTITY
    await flush()

    // The none subscription is identity-independent and never reacquired.
    expect(anon.calls.onUpdate.length).toBe(1)
    expect(primary.calls.onUpdate.length).toBe(0)
  })

  it('reuses the primary for none in an auth-disabled build', async () => {
    const primary = new MockConvexClient()
    const anon = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:public:auth-disabled')

    const { flush } = await captureInNuxt(
      () => createConvexQueryState(query, {}, { auth: 'none' }).resultData,
      { owner: makeMockOwner(primary, anon), convexConfig: { auth: false } },
    )

    await flush()

    // Auth disabled: the permanently-anonymous primary serves none .
    expect(primary.calls.onUpdate.length).toBe(1)
    expect(anon.calls.onUpdate.length).toBe(0)
  })
})
