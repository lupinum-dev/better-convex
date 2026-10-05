import { describe, expect, it } from 'vitest'

import { useState } from '#imports'

import {
  PENDING_IDENTITY,
  toAuthenticatedIdentity,
  type AuthIdentity,
} from '../../src/runtime/auth/auth-identity'
import { useConvexQuery } from '../../src/runtime/composables/useConvexQuery'
import { makeMockOwner } from '../helpers/mock-client-owner'
import { MockConvexClient, mockFnRef } from '../helpers/mock-convex-client'
import { captureInNuxt } from '../helpers/nuxt-runtime-harness'

// Public execution-gate behavior driven by canonical auth status + mode. The
// subscription counts for every auth transition and mode live in
// auth-execution-count-matrix.nuxt.test.ts.
describe('useConvexQuery auth execution gate', () => {
  it('required waits while auth loads, then subscribes as the user and settles its await on the first value', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:await-auth')
    const { result, flush } = await captureInNuxt(
      () => {
        const pending = useState<boolean>('convex:pending')
        const identity = useState<AuthIdentity>('convex:identity')
        pending.value = true
        identity.value = PENDING_IDENTITY
        const queryState = useConvexQuery(query, {}, { auth: 'required' })
        return { queryState, pending, identity }
      },
      { owner: makeMockOwner(primary) },
    )

    let resolved = false
    void result.queryState.then(() => {
      resolved = true
    })
    await flush()
    expect(primary.calls.onUpdate).toHaveLength(0)
    expect(result.queryState.blockedBy.value).toBe('auth')
    expect(result.queryState.status.value).toBe('pending')
    expect(resolved).toBe(false)

    result.identity.value = toAuthenticatedIdentity({ id: 'u1' })
    result.pending.value = false
    await flush()
    expect(primary.activeListenerCount(query, {})).toBe(1)
    expect(result.queryState.blockedBy.value).toBeNull()
    expect(resolved).toBe(false)

    primary.emitQueryResult(query, {}, { owner: 'u1' })
    await result.queryState
    expect(resolved).toBe(true)
    expect(result.queryState.status.value).toBe('success')
  })
})
