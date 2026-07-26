import type { PaginationResult } from 'convex/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useState } from '#imports'

import { toAuthenticatedIdentity, type AuthIdentity } from '../../src/runtime/auth/auth-identity'
import {
  createConvexPaginatedQueryState,
  useConvexPaginatedQuery,
} from '../../src/runtime/composables/useConvexPaginatedQuery'
import { ConvexCallError } from '../../src/runtime/errors'
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
  it('keeps an SSR error through hydration and clears it on the first live value', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('feed:ssr-error-hydration')
    const key = withAuthDimension(
      createConvexQueryKey(
        query,
        { paginationOpts: { numItems: 2, cursor: null } },
        'convex-paginated',
      ),
      'none',
      'anonymous',
    )
    const ssrError = new ConvexCallError({
      kind: 'transport',
      message: 'Sanitized pagination transport failure',
      status: 500,
    })
    const { result, flush, wrapper } = await captureInNuxt(
      () => {
        useState<Record<string, ConvexCallError | null>>('convex:query-errors').value = {
          [key]: ssrError,
        }
        return useConvexPaginatedQuery(query, {}, { auth: 'none', initialNumItems: 2 })
      },
      {
        owner: makeMockOwner(primary),
        payloadData: { [key]: null },
      },
    )
    const queryResult = await result

    expect(queryResult.error.value).toBe(ssrError)
    expect(queryResult.status.value).toBe('error')
    primary.emitQueryResultWhere(() => true, page(['live'], false, 'next'))
    await flush()

    expect(queryResult.error.value).toBeNull()
    expect(queryResult.status.value).toBe('ready')
    expect(queryResult.results.value).toEqual(['live'])
    wrapper.unmount()
  })

  it('replaces a hydrated SSR error with the first live error', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('feed:ssr-to-live-error')
    const key = withAuthDimension(
      createConvexQueryKey(
        query,
        { paginationOpts: { numItems: 2, cursor: null } },
        'convex-paginated',
      ),
      'none',
      'anonymous',
    )
    const ssrError = new ConvexCallError({
      kind: 'transport',
      message: 'Sanitized pagination transport failure',
      status: 500,
    })
    const { result, flush, wrapper } = await captureInNuxt(
      () => {
        const errors = useState<Record<string, ConvexCallError | null>>('convex:query-errors')
        errors.value = { [key]: ssrError }
        return {
          errors,
          query: useConvexPaginatedQuery(query, {}, { auth: 'none', initialNumItems: 2 }),
        }
      },
      {
        owner: makeMockOwner(primary),
        payloadData: { [key]: null },
      },
    )
    const queryResult = await result.query
    expect(queryResult.error.value).toBe(ssrError)

    primary.emitQueryErrorWhere(() => true, new Error('live pagination failed'))
    await flush()

    expect(queryResult.error.value).not.toBe(ssrError)
    expect(queryResult.error.value).toMatchObject({
      kind: 'unknown',
      message: 'Unknown Convex error',
    })
    expect(key in result.errors.value).toBe(false)
    expect(queryResult.status.value).toBe('error')
    wrapper.unmount()
  })

  it('awaits the first live page without issuing a duplicate one-shot query', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('feed:first-page-settlement')
    const { result, wrapper } = await captureInNuxt(
      () => useConvexPaginatedQuery(query, {}, { auth: 'none', initialNumItems: 2 }),
      { owner: makeMockOwner(primary) },
    )
    let settled = false
    const completion = result.then((value) => {
      settled = true
      return value
    })

    await vi.waitFor(() => expect(primary.calls.onUpdate).toHaveLength(1))
    expect(primary.calls.query).toHaveLength(0)
    expect(settled).toBe(false)

    primary.emitQueryResultWhere(() => true, page(['first'], false, 'next'))
    const queryResult = await completion

    expect(queryResult.results.value).toEqual(['first'])
    expect(primary.calls.query).toHaveLength(0)
    wrapper.unmount()
  })

  it('resolves an awaited hydrated first page without another query', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('feed:hydrated-first-page-settlement')
    const key = withAuthDimension(
      createConvexQueryKey(
        query,
        { paginationOpts: { numItems: 2, cursor: null } },
        'convex-paginated',
      ),
      'none',
      'anonymous',
    )
    const { result, wrapper } = await captureInNuxt(
      () => useConvexPaginatedQuery(query, {}, { auth: 'none', initialNumItems: 2 }),
      {
        owner: makeMockOwner(primary),
        payloadData: { [key]: page(['hydrated'], false, 'next') },
      },
    )
    const queryResult = await result

    expect(queryResult.results.value).toEqual(['hydrated'])
    expect(primary.calls.query).toHaveLength(0)
    expect(primary.calls.onUpdate).toHaveLength(1)
    wrapper.unmount()
  })

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
    expect(primary.calls.onUpdate).toHaveLength(3)
    expect(primary.calls.onUpdate[1]?.args).toMatchObject({
      paginationOpts: { cursor: null, endCursor: 'ssr-cursor' },
    })
    expect(primary.calls.onUpdate[2]?.args).toMatchObject({
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

    // Load the next page: the first page is rebound to a fixed end cursor and
    // one listener is acquired for the next range.
    result.q.loadMore(2)
    await flush()
    expect(primary.calls.onUpdate.length).toBe(3)

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
    expect(primary.calls.onUpdate).toHaveLength(3)
    expect(primary.calls.onUpdate[1]?.args).toMatchObject({
      paginationOpts: { cursor: null, endCursor: 'ssr-cursor' },
    })
    expect(primary.calls.onUpdate[2]?.args).toMatchObject({
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
