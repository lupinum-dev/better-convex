import type { PaginationResult } from 'convex/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useState } from '#imports'

import { toAuthenticatedIdentity, type AuthIdentity } from '../../src/runtime/auth/auth-identity'
import { createConvexPaginatedQueryState } from '../../src/runtime/composables/useConvexPaginatedQuery'
import { withAuthDimension } from '../../src/runtime/utils/convex-cache'
import { createConvexQueryKey } from '../../src/runtime/utils/convex-shared'
import { makeMockOwner } from '../helpers/mock-client-owner'
import { MockConvexClient, mockFnRef } from '../helpers/mock-convex-client'
import { captureInNuxt, createIdentityObserverHarness } from '../helpers/nuxt-runtime-harness'

afterEach(() => {
  vi.clearAllMocks()
})

function page<T>(items: T[], isDone: boolean, cursor: string | null): PaginationResult<T> {
  return { page: items, isDone, continueCursor: cursor ?? '' } as PaginationResult<T>
}

// architecture invariant: the pagination controller owns first- and later-page
// acquisition through composable-owned listeners, and clears its pages on an
// identity change.
describe('useConvexPaginatedQuery controller', () => {
  it('retains a matching SSR first page through settlement and subscribes exactly once', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('feed:ssr-settlement')
    const key = withAuthDimension(
      createConvexQueryKey(
        query,
        { paginationOpts: { numItems: 2, cursor: null } },
        'convex-paginated',
      ),
      'optional',
      'user:A',
    )
    const identityPort = createIdentityObserverHarness({
      authEnabled: true,
      settled: false,
      identityKey: 'user:A',
      identityGeneration: 0,
      error: null,
    })

    const { result, flush, wrapper } = await captureInNuxt(
      () => {
        const pending = useState<boolean>('convex:pending', () => false)
        const identity = useState<AuthIdentity>('convex:identity')
        pending.value = false
        identity.value = toAuthenticatedIdentity('jwt-A', { id: 'A' })
        return createConvexPaginatedQueryState(
          query,
          {},
          { auth: 'optional', initialNumItems: 2 },
          true,
        ).resultData
      },
      {
        owner: makeMockOwner(primary),
        identityObserver: identityPort.observer,
        payloadData: { [key]: page(['ssr-a', 'ssr-b'], false, 'ssr-cursor') },
      },
    )

    expect(result.results.value).toEqual(['ssr-a', 'ssr-b'])
    expect(primary.calls.onUpdate).toHaveLength(0)
    identityPort.set({
      authEnabled: true,
      settled: true,
      identityKey: 'user:A',
      identityGeneration: 0,
      error: null,
    })
    await flush()

    expect(result.results.value).toEqual(['ssr-a', 'ssr-b'])
    expect(primary.calls.onUpdate).toHaveLength(1)
    result.loadMore(2)
    expect(primary.calls.onUpdate[1]?.args).toMatchObject({
      paginationOpts: { cursor: 'ssr-cursor' },
    })
    wrapper.unmount()
  })

  it('rejects a mismatched SSR first page before exposing browser state', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('feed:ssr-mismatch')
    const key = withAuthDimension(
      createConvexQueryKey(
        query,
        { paginationOpts: { numItems: 2, cursor: null } },
        'convex-paginated',
      ),
      'optional',
      'user:A',
    )
    const identityPort = createIdentityObserverHarness({
      authEnabled: true,
      settled: false,
      identityKey: 'user:B',
      identityGeneration: 0,
      error: null,
    })

    const { result, wrapper } = await captureInNuxt(
      () => {
        const pending = useState<boolean>('convex:pending', () => false)
        const identity = useState<AuthIdentity>('convex:identity')
        pending.value = false
        identity.value = toAuthenticatedIdentity('jwt-A', { id: 'A' })
        return createConvexPaginatedQueryState(
          query,
          {},
          { auth: 'optional', initialNumItems: 2 },
          true,
        ).resultData
      },
      {
        owner: makeMockOwner(primary),
        identityObserver: identityPort.observer,
        payloadData: { [key]: page(['private-A'], true, null) },
      },
    )

    expect(result.results.value).toEqual([])
    wrapper.unmount()
  })

  it('does not reacquire the first-page subscription when reset finishes after disposal', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('feed:reset-after-disposal')

    const { result, flush, wrapper } = await captureInNuxt(
      () =>
        createConvexPaginatedQueryState(query, {}, { auth: 'none', initialNumItems: 2 }, true)
          .resultData,
      { owner: makeMockOwner(primary) },
    )

    await flush()
    expect(primary.activeListenerCount()).toBe(1)

    const reset = result.reset()
    expect(primary.activeListenerCount()).toBe(0)
    wrapper.unmount()
    await reset

    expect(primary.activeListenerCount()).toBe(0)
  })

  it('drops a deferred refresh resolved during the synchronous A-to-B window', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('feed:deferred-refresh')
    let resolveA!: (value: PaginationResult<string>) => void
    let calls = 0
    primary.setQueryHandler('feed:deferred-refresh', () => {
      calls += 1
      return calls === 1
        ? new Promise((resolve) => (resolveA = resolve))
        : Promise.resolve(page(['B'], true, null))
    })

    const { result, flush, wrapper } = await captureInNuxt(
      () => {
        const pending = useState<boolean>('convex:pending', () => false)
        const identity = useState<AuthIdentity>('convex:identity')
        pending.value = false
        identity.value = toAuthenticatedIdentity('jwt-A', { id: 'A' })
        const q = createConvexPaginatedQueryState(
          query,
          {},
          { auth: 'optional', subscribe: false, initialNumItems: 2 },
          true,
        ).resultData
        return { q, identity }
      },
      { owner: makeMockOwner(primary) },
    )

    const refresh = result.q.refresh()
    await Promise.resolve()
    result.identity.value = toAuthenticatedIdentity('jwt-B', { id: 'B' })
    resolveA(page(['A'], true, null))
    await refresh
    expect(result.q.results.value).not.toContain('A')
    expect(result.q.error.value).toBeNull()

    await flush()
    wrapper.unmount()
  })

  it('loads the first page live, then appends a page via loadMore', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('feed:list')

    const { result, flush, wrapper } = await captureInNuxt(
      () => {
        const pending = useState<boolean>('convex:pending', () => false)
        const identity = useState<AuthIdentity>('convex:identity')
        pending.value = false
        identity.value = toAuthenticatedIdentity('jwt-A', { id: 'A' })
        const q = createConvexPaginatedQueryState(
          query,
          {},
          { auth: 'optional', initialNumItems: 2 },
          true,
        ).resultData
        return { q, pending, identity }
      },
      { owner: makeMockOwner(primary) },
    )

    await flush()
    expect(primary.calls.onUpdate.length).toBe(1)

    // First page arrives.
    primary.emitQueryResultWhere(
      (e) =>
        (e.args as { paginationOpts: { cursor: string | null } }).paginationOpts.cursor === null,
      page(['a', 'b'], false, 'cursor-1'),
    )
    await flush()
    expect(result.q.results.value).toEqual(['a', 'b'])
    expect(result.q.hasNextPage.value).toBe(true)

    // Load the next page: a second listener is acquired for the continue cursor.
    result.q.loadMore(2)
    await flush()
    expect(primary.calls.onUpdate.length).toBe(2)

    primary.emitQueryResultWhere(
      (e) =>
        (e.args as { paginationOpts: { cursor: string | null } }).paginationOpts.cursor ===
        'cursor-1',
      page(['c', 'd'], true, 'cursor-2'),
    )
    await flush()
    expect(result.q.results.value).toEqual(['a', 'b', 'c', 'd'])
    expect(result.q.status.value).toBe('exhausted')

    wrapper.unmount()
  })

  it('clears pages and re-acquires the first page on an identity change', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('feed:mine')

    const { result, flush, wrapper } = await captureInNuxt(
      () => {
        const pending = useState<boolean>('convex:pending', () => false)
        const identity = useState<AuthIdentity>('convex:identity')
        pending.value = false
        identity.value = toAuthenticatedIdentity('jwt-A', { id: 'A' })
        const q = createConvexPaginatedQueryState(
          query,
          {},
          { auth: 'optional', initialNumItems: 2, keepPreviousData: true },
          true,
        ).resultData
        return { q, pending, identity }
      },
      { owner: makeMockOwner(primary) },
    )

    await flush()
    primary.emitQueryResultWhere(() => true, page(['a1', 'a2'], false, 'c1'))
    await flush()
    expect(result.q.results.value).toEqual(['a1', 'a2'])

    // Switch identity: pages cleared, no A rows carried across.
    result.identity.value = toAuthenticatedIdentity('jwt-B', { id: 'B' })
    await flush()
    expect(result.q.results.value).toEqual([])

    // B's first page acquires a fresh listener and commits under B.
    primary.emitQueryResultWhere(() => true, page(['b1'], true, 'c2'))
    await flush()
    expect(result.q.results.value).toEqual(['b1'])

    wrapper.unmount()
  })

  it('routes an authenticated none paginated query through the anonymous client', async () => {
    const primary = new MockConvexClient()
    const anon = new MockConvexClient()
    const query = mockFnRef<'query'>('feed:public')

    const { flush, wrapper } = await captureInNuxt(
      () => {
        const pending = useState<boolean>('convex:pending', () => false)
        const identity = useState<AuthIdentity>('convex:identity')
        pending.value = false
        identity.value = toAuthenticatedIdentity('jwt-A', { id: 'A' })
        return createConvexPaginatedQueryState(
          query,
          {},
          { auth: 'none', initialNumItems: 2 },
          true,
        ).resultData
      },
      { owner: makeMockOwner(primary, anon) },
    )

    await flush()
    expect(anon.calls.onUpdate.length).toBe(1)
    expect(primary.calls.onUpdate.length).toBe(0)

    wrapper.unmount()
  })

  it('hydrates the complete first page so loadMore retains the SSR cursor', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('feed:hydrated')
    const key = withAuthDimension(
      createConvexQueryKey(
        query,
        { paginationOpts: { numItems: 2, cursor: null } },
        'convex-paginated',
      ),
      'none',
      'anonymous',
    )

    const { result, flush, wrapper } = await captureInNuxt(
      () =>
        createConvexPaginatedQueryState(query, {}, { auth: 'none', initialNumItems: 2 }, true)
          .resultData,
      {
        owner: makeMockOwner(primary),
        payloadData: { [key]: page(['ssr-a', 'ssr-b'], false, 'ssr-cursor') },
      },
    )

    expect(result.results.value).toEqual(['ssr-a', 'ssr-b'])
    expect(result.hasNextPage.value).toBe(true)
    result.loadMore(2)
    await flush()
    expect(primary.calls.onUpdate).toHaveLength(2)
    expect(primary.calls.onUpdate[1]?.args).toMatchObject({
      paginationOpts: { cursor: 'ssr-cursor' },
    })
    wrapper.unmount()
  })

  it('hydrates byte arguments from the same paginated key used by SSR', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('feed:hydrated-by-digest')
    const digest = new Uint8Array([4, 5, 6]).buffer
    const key = withAuthDimension(
      createConvexQueryKey(
        query,
        { digest, paginationOpts: { numItems: 2, cursor: null } },
        'convex-paginated',
      ),
      'none',
      'anonymous',
    )

    const { result, wrapper } = await captureInNuxt(
      () =>
        createConvexPaginatedQueryState(
          query,
          { digest } as never,
          { auth: 'none', initialNumItems: 2 },
          true,
        ).resultData,
      {
        owner: makeMockOwner(primary),
        payloadData: { [key]: page(['matching-bytes'], true, null) },
      },
    )

    expect(result.results.value).toEqual(['matching-bytes'])
    expect((primary.calls.onUpdate[0]?.args as { digest: ArrayBuffer }).digest).toBe(digest)
    wrapper.unmount()
  })
})
