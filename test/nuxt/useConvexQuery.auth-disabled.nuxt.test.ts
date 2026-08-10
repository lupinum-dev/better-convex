import { afterEach, describe, expect, it, vi } from 'vitest'

import { createConvexQueryState } from '../../src/runtime/composables/useConvexQuery'
import { makeMockOwner } from '../helpers/mock-client-owner'
import { MockConvexClient, mockFnRef } from '../helpers/mock-convex-client'
import { captureInNuxt } from '../helpers/nuxt-runtime-harness'

afterEach(() => {
  vi.clearAllMocks()
})

// A no-auth build never installs the auth engine. Optional queries execute
// anonymously without any loading state, and required queries stay idle. This
// is distinct from the *enabled*-build
// settled-anonymous case exercised in useConvexQuery.auth-gate.nuxt.test.ts —
// here there is no engine, no `convex:pending` settlement to wait for, and no
// possibility of ever becoming authenticated.
describe('useConvexQuery under an auth-disabled build ', () => {
  it('optional executes anonymously immediately, with no loading state at any point', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:disabled-optional')

    const { result, flush } = await captureInNuxt(
      () => createConvexQueryState(query, {}, { auth: 'optional' }).resultData,
      { owner: makeMockOwner(primary), convexConfig: { auth: false } },
    )

    // No auth-loading wait: the subscription is established on the very first
    // flush (contrast the *enabled*-build 'loading' case in
    // useConvexQuery.auth-gate.nuxt.test.ts, which defers subscribing until
    // auth settles). Any 'pending' status observed here is the query's own
    // network round-trip, never an auth-settlement wait.
    await flush()
    expect(primary.activeListenerCount(query, {})).toBe(1)

    primary.emitQueryResult(query, {}, ['a', 'b'])
    await flush()
    expect(result.status.value).toBe('success')
    expect(result.data.value).toEqual(['a', 'b'])
  })

  it('required stays idle and never issues a request', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:disabled-required')

    const { result, flush } = await captureInNuxt(
      () => createConvexQueryState(query, {}, { auth: 'required' }).resultData,
      { owner: makeMockOwner(primary), convexConfig: { auth: false } },
    )

    await flush()
    expect(result.status.value).toBe('idle')
    expect(primary.calls.onUpdate.length).toBe(0)
    expect(primary.activeListenerCount(query, {})).toBe(0)
  })

  it('none still executes anonymously (auth-disabled builds reuse the already-anonymous primary)', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:disabled-none')

    const { result, flush } = await captureInNuxt(
      () => createConvexQueryState(query, {}, { auth: 'none' }).resultData,
      { owner: makeMockOwner(primary), convexConfig: { auth: false } },
    )

    await flush()
    expect(primary.activeListenerCount(query, {})).toBe(1)
    primary.emitQueryResult(query, {}, ['x'])
    await flush()
    expect(result.status.value).toBe('success')
  })
})
