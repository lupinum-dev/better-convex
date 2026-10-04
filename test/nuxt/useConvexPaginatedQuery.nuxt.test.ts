import { getFunctionName, type FunctionReference, type PaginationResult } from 'convex/server'
import { hash } from 'ohash'
import { describe, expect, it, vi } from 'vitest'
import { onBeforeMount, onMounted, ref } from 'vue'

import { onNuxtReady, useNuxtApp, useState } from '#imports'

import { toAuthenticatedIdentity, type AuthIdentity } from '../../src/runtime/auth/auth-identity'
import {
  createConvexPaginatedQueryState,
  useConvexPaginatedQuery,
} from '../../src/runtime/composables/useConvexPaginatedQuery'
import { ConvexCallError } from '../../src/runtime/errors'
import { createConvexPayloadKey, paginatedPayloadHash } from '../../src/runtime/utils/convex-cache'
import type { ConvexIdentityKey } from '../../src/runtime/utils/identity-key'
import { makeMockOwner } from '../helpers/mock-client-owner'
import { MockConvexClient, mockFnRef } from '../helpers/mock-convex-client'
import { captureInNuxt, createIdentityObserverHarness } from '../helpers/nuxt-runtime-harness'

function page<T>(items: T[], isDone: boolean, cursor: string | null): PaginationResult<T> {
  return {
    page: items,
    isDone,
    continueCursor: cursor ?? '',
  } as PaginationResult<T>
}

function pageKey(
  query: FunctionReference<'query'>,
  args: Record<string, unknown>,
  auth: 'none' | 'optional' = 'none',
  identity: ConvexIdentityKey = 'anonymous',
) {
  return createConvexPayloadKey(
    'convex-paginated',
    getFunctionName(query),
    paginatedPayloadHash(hash(args), 2, null),
    auth,
    identity,
  )
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

// architecture invariant: the pagination controller owns first- and later-page
// acquisition through composable-owned listeners, and clears its pages on an
// identity change.
describe('useConvexPaginatedQuery controller', () => {
  it('starts a payload-less first page only after Nuxt hydration settles', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('feed:payload-less-hydration')
    const { result, wrapper } = await captureInNuxt(
      () => {
        const nuxtApp = useNuxtApp()
        nuxtApp.isHydrating = true
        const listenersBeforeMount = ref(-1)
        const listenersDuringMount = ref(-1)
        const state = useConvexPaginatedQuery(
          query,
          {},
          {
            auth: 'none',
            initialNumItems: 2,
          },
        )
        onBeforeMount(() => {
          listenersBeforeMount.value = primary.calls.onUpdate.length
        })
        onMounted(() => {
          listenersDuringMount.value = primary.calls.onUpdate.length
          nuxtApp.isHydrating = false
          void nuxtApp.callHook('app:suspense:resolve')
        })
        return { listenersBeforeMount, listenersDuringMount, state }
      },
      { owner: makeMockOwner(primary), payloadData: {} },
    )

    expect(result.listenersBeforeMount.value).toBe(0)
    expect(result.listenersDuringMount.value).toBe(0)
    await vi.waitFor(() => expect(primary.calls.onUpdate).toHaveLength(1))
    expect(result.state.status.value).toBe('pending')
    wrapper.unmount()
  })

  it('keeps an SSR page authoritative until hydration settles', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('feed:hydrated-frame')
    const key = pageKey(query, {})
    const { result, wrapper } = await captureInNuxt(
      () => {
        const nuxtApp = useNuxtApp()
        nuxtApp.isHydrating = true
        const listenersBeforeMount = ref(-1)
        const listenersDuringMount = ref(-1)
        const statusBeforeMount = ref('unknown')
        const state = useConvexPaginatedQuery(query, {}, { auth: 'none', initialNumItems: 2 })
        onBeforeMount(() => {
          listenersBeforeMount.value = primary.calls.onUpdate.length
          statusBeforeMount.value = state.status.value
        })
        onMounted(() => {
          listenersDuringMount.value = primary.calls.onUpdate.length
          nuxtApp.isHydrating = false
          void nuxtApp.callHook('app:suspense:resolve')
        })
        return {
          listenersBeforeMount,
          listenersDuringMount,
          statusBeforeMount,
          state,
        }
      },
      {
        owner: makeMockOwner(primary),
        payloadData: {
          [key]: { value: page(['ssr-a', 'ssr-b'], false, 'ssr-cursor') },
        },
      },
    )

    expect(result.listenersBeforeMount.value).toBe(0)
    expect(result.listenersDuringMount.value).toBe(0)
    expect(result.statusBeforeMount.value).toBe('success')
    // The await resolves on the hydrated page, without another query.
    const queryResult = await result.state
    expect(queryResult.data.value).toEqual(['ssr-a', 'ssr-b'])
    expect(queryResult.canLoadMore.value).toBe(true)
    expect(queryResult.isLoadingMore.value).toBe(false)
    expect(queryResult.isExhausted.value).toBe(false)
    expect(queryResult.blockedBy.value).toBeNull()
    expect(queryResult).not.toHaveProperty('cursor')
    expect(queryResult).not.toHaveProperty('pageStatus')
    await vi.waitFor(() => expect(primary.calls.onUpdate).toHaveLength(1))
    expect(queryResult.data.value).toEqual(['ssr-a', 'ssr-b'])
    expect(queryResult.canLoadMore.value).toBe(true)
    expect(primary.calls.query).toHaveLength(0)
    wrapper.unmount()
  })

  it('keeps an SSR error through hydration and clears it on the first live value', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('feed:ssr-error-hydration')
    const key = pageKey(query, {})
    const ssrError = new ConvexCallError({
      kind: 'transport',
      message: 'Sanitized pagination transport failure',
      status: 500,
    })
    const { result, flush, wrapper } = await captureInNuxt(
      () =>
        hydrating(() => useConvexPaginatedQuery(query, {}, { auth: 'none', initialNumItems: 2 })),
      {
        owner: makeMockOwner(primary),
        payloadData: { [key]: { error: ssrError } },
      },
    )
    const queryResult = await result

    expect(queryResult.error.value).toBe(ssrError)
    expect(queryResult.status.value).toBe('error')
    expect(queryResult.canLoadMore.value).toBe(false)
    await vi.waitFor(() => expect(primary.calls.onUpdate).toHaveLength(1))
    expect(queryResult.status.value).toBe('error')
    primary.emitQueryResultWhere(() => true, page(['live'], false, 'next'))
    await flush()

    expect(queryResult.error.value).toBeUndefined()
    expect(queryResult.status.value).toBe('success')
    expect(queryResult.data.value).toEqual(['live'])
    wrapper.unmount()
  })

  it('retires a hydrated SSR error when reactive arguments change', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('feed:ssr-error-argument-boundary')
    const initialArgs = { category: 'alpha' }
    const replacementArgs = { category: 'beta' }
    const key = pageKey(query, initialArgs)
    const ssrError = new ConvexCallError({
      kind: 'transport',
      message: 'Sanitized pagination transport failure',
      status: 500,
    })
    const { result, flush, wrapper } = await captureInNuxt(
      () =>
        hydrating(() => {
          const args = ref(initialArgs)
          return {
            args,
            query: useConvexPaginatedQuery(query, args, {
              auth: 'none',
              initialNumItems: 2,
            }),
            stableQuery: useConvexPaginatedQuery(query, initialArgs, {
              auth: 'none',
              initialNumItems: 2,
            }),
          }
        }),
      {
        owner: makeMockOwner(primary),
        payloadData: { [key]: { error: ssrError } },
      },
    )

    expect(result.query.error.value).toBe(ssrError)
    expect(result.query.status.value).toBe('error')
    await vi.waitFor(() => expect(primary.calls.onUpdate).toHaveLength(2))

    result.args.value = replacementArgs
    await flush()

    expect(result.query.error.value).toBeUndefined()
    expect(result.query.status.value).toBe('pending')
    expect(result.query.data.value).toBeUndefined()
    expect(result.stableQuery.error.value).toBe(ssrError)

    primary.emitQueryResultWhere(
      ({ args }) => (args as { category?: string }).category === 'beta',
      page(['beta'], true, null),
    )
    await vi.waitFor(() => expect(result.query.status.value).toBe('success'))
    expect(result.query.data.value).toEqual(['beta'])

    primary.emitQueryResultWhere(
      ({ args }) => (args as { category?: string }).category === 'alpha',
      page(['alpha'], true, null),
    )
    await vi.waitFor(() => expect(result.stableQuery.status.value).toBe('success'))
    expect(result.stableQuery.data.value).toEqual(['alpha'])
    expect(result.stableQuery.error.value).toBeUndefined()
    wrapper.unmount()
  })

  it('does not settle from a null SSR payload without a page or error', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('feed:null-ssr-payload')
    const key = pageKey(query, {})
    const { result, wrapper } = await captureInNuxt(
      () => useConvexPaginatedQuery(query, {}, { auth: 'none', initialNumItems: 2 }),
      {
        owner: makeMockOwner(primary),
        payloadData: { [key]: null },
      },
    )
    let settled = false
    void result.then(() => {
      settled = true
    })

    await vi.waitFor(() => expect(primary.calls.onUpdate).toHaveLength(1))
    await Promise.resolve()
    expect(result.status.value).toBe('pending')
    expect(settled).toBe(false)

    primary.emitQueryResultWhere(() => true, page(['live'], true, null))
    const queryResult = await result
    expect(queryResult.status.value).toBe('success')
    expect(queryResult.data.value).toEqual(['live'])
    wrapper.unmount()
  })

  it('replaces a hydrated SSR error with the first live error', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('feed:ssr-to-live-error')
    const key = pageKey(query, {})
    const ssrError = new ConvexCallError({
      kind: 'transport',
      message: 'Sanitized pagination transport failure',
      status: 500,
    })
    const { result, flush, wrapper } = await captureInNuxt(
      () =>
        hydrating(() => ({
          query: useConvexPaginatedQuery(query, {}, { auth: 'none', initialNumItems: 2 }),
        })),
      {
        owner: makeMockOwner(primary),
        payloadData: { [key]: { error: ssrError } },
      },
    )
    const queryResult = await result.query
    expect(queryResult.error.value).toBe(ssrError)
    await vi.waitFor(() => expect(primary.calls.onUpdate).toHaveLength(1))

    primary.emitQueryErrorWhere(() => true, new Error('live pagination failed'))
    await flush()

    expect(queryResult.error.value).not.toBe(ssrError)
    expect(queryResult.error.value).toMatchObject({
      kind: 'unknown',
      message: 'Unknown Convex error',
    })
    expect(queryResult.status.value).toBe('error')
    wrapper.unmount()
  })

  it('settles initial live errors without rejecting the optional await', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('feed:first-page-error')
    const { result, wrapper } = await captureInNuxt(
      () => useConvexPaginatedQuery(query, {}, { auth: 'none', initialNumItems: 2 }),
      { owner: makeMockOwner(primary) },
    )

    primary.emitQueryErrorWhere(() => true, new Error('secret transport detail'))
    const queryResult = await result

    expect(queryResult.status.value).toBe('error')
    expect(queryResult.error.value).toMatchObject({
      kind: 'unknown',
      message: 'Unknown Convex error',
    })
    wrapper.unmount()
  })

  it.each([
    {
      name: 'skip',
      args: 'skip' as const,
      server: true,
      status: 'idle' as const,
    },
    {
      name: 'server false',
      args: {},
      server: false,
      status: 'pending' as const,
    },
  ])('settles $name immediately', async ({ args, server, status }) => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('feed:immediate-settlement')
    const { result, wrapper } = await captureInNuxt(
      () =>
        useConvexPaginatedQuery(query, args, {
          auth: 'none',
          initialNumItems: 2,
          server,
        }),
      { owner: makeMockOwner(primary) },
    )

    const awaited = await result
    expect(awaited.status).toBe(result.status)
    expect(result.status.value).toBe(status)
    wrapper.unmount()
  })

  it('defers a resumed pagination subscription and restarts from a new cursor', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('feed:deferred-resume')
    const { result, wrapper } = await captureInNuxt(
      () =>
        useConvexPaginatedQuery(
          query,
          {},
          {
            auth: 'none',
            initialNumItems: 2,
            initialCursor: 'resume-at',
            immediate: false,
          },
        ),
      { owner: makeMockOwner(primary) },
    )

    expect(result.status.value).toBe('idle')
    expect(result.blockedBy.value).toBe('manual')
    expect(primary.calls.onUpdate).toHaveLength(0)
    const execution = result.execute()
    expect(result.blockedBy.value).toBeNull()
    expect(primary.calls.onUpdate).toHaveLength(1)
    primary.emitQueryResultWhere(
      (entry) =>
        (entry.args as { paginationOpts: { cursor: string | null } }).paginationOpts.cursor ===
        'resume-at',
      page(['resumed'], false, 'next-cursor'),
    )
    await execution
    expect(result.data.value).toEqual(['resumed'])
    expect(result.canLoadMore.value).toBe(true)

    result.restart('another-cursor')
    expect(primary.calls.onUpdate).toHaveLength(2)
    expect(primary.calls.onUpdate[1]?.args).toMatchObject({
      paginationOpts: { cursor: 'another-cursor' },
    })
    wrapper.unmount()
  })

  it('settles when the current reactive generation becomes skipped', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('feed:reactive-skip-settlement')
    const args = ref<Record<string, never> | 'skip'>({})
    const { result, flush, wrapper } = await captureInNuxt(
      () =>
        useConvexPaginatedQuery(query, args, {
          auth: 'none',
          initialNumItems: 2,
        }),
      { owner: makeMockOwner(primary) },
    )
    let settled = false
    void result.then(() => {
      settled = true
    })

    args.value = 'skip'
    await flush()
    const awaited = await result

    expect(settled).toBe(true)
    expect(awaited.status.value).toBe('idle')
    expect(awaited.data.value).toBeUndefined()
    wrapper.unmount()
  })

  it('retires an initial identity without settling until the replacement page arrives', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('feed:identity-first-settlement')
    const { result, flush, wrapper } = await captureInNuxt(
      () => {
        const identity = useState<AuthIdentity>('convex:identity')
        identity.value = toAuthenticatedIdentity({ id: 'A' })
        return {
          identity,
          query: useConvexPaginatedQuery(query, {}, { initialNumItems: 2 }),
        }
      },
      { owner: makeMockOwner(primary) },
    )
    let settled = false
    void result.query.then(() => {
      settled = true
    })

    result.identity.value = toAuthenticatedIdentity({ id: 'B' })
    await flush()
    expect(settled).toBe(false)
    expect(result.query.data.value).toBeUndefined()

    primary.emitQueryResultWhere(() => true, page(['B'], true, null))
    const awaited = await result.query
    expect(awaited.data.value).toEqual(['B'])
    wrapper.unmount()
  })

  it('returns a native Promise with immediate state that settles on the first live page, without a one-shot query', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('feed:native-promise')
    const { result, wrapper } = await captureInNuxt(
      () => useConvexPaginatedQuery(query, {}, { auth: 'none', initialNumItems: 2 }),
      { owner: makeMockOwner(primary) },
    )

    expect(result).toBeInstanceOf(Promise)
    expect(result.data.value).toBeUndefined()
    expect(result.status.value).toBe('pending')
    for (const key of ['then', 'catch', 'finally']) {
      expect(Object.prototype.propertyIsEnumerable.call(result, key)).toBe(true)
    }
    let settled = false
    const completion = result.then((value) => {
      settled = true
      return value
    })
    await vi.waitFor(() => expect(primary.calls.onUpdate).toHaveLength(1))
    await Promise.resolve()
    expect(settled).toBe(false)

    primary.emitQueryResultWhere(() => true, page(['first'], false, 'next'))
    const awaited = await completion

    expect(awaited).not.toBe(result)
    expect(awaited.data).toBe(result.data)
    expect(awaited.data.value).toEqual(['first'])
    expect(awaited.status.value).toBe('success')
    expect(primary.calls.query).toHaveLength(0)
    wrapper.unmount()
  })

  it('retains a matching SSR first page through settlement and subscribes exactly once', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('feed:ssr-settlement')
    const key = pageKey(query, {}, 'optional', 'user:A')
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
          useState<boolean>('convex:pending').value = false
          useState<AuthIdentity>('convex:identity').value = toAuthenticatedIdentity({ id: 'A' })
          return createConvexPaginatedQueryState(
            query,
            {},
            {
              auth: 'optional',
              initialNumItems: 2,
            },
          ).resultData
        }),
      {
        owner: makeMockOwner(primary),
        identityObserver: identityPort.observer,
        payloadData: {
          [key]: { value: page(['ssr-a', 'ssr-b'], false, 'ssr-cursor') },
        },
      },
    )

    expect(result.data.value).toEqual(['ssr-a', 'ssr-b'])
    expect(primary.calls.onUpdate).toHaveLength(0)
    identityPort.set({
      authEnabled: true,
      settled: true,
      identityKey: 'user:A',
      identityGeneration: 0,
      error: null,
    })
    await vi.waitFor(() => expect(primary.calls.onUpdate).toHaveLength(1))

    expect(result.data.value).toEqual(['ssr-a', 'ssr-b'])
    expect(primary.calls.onUpdate).toHaveLength(1)
    void result.loadMore(2)
    expect(primary.calls.onUpdate).toHaveLength(3)
    expect(primary.calls.onUpdate[1]?.args).toMatchObject({
      paginationOpts: { cursor: null, endCursor: 'ssr-cursor' },
    })
    expect(primary.calls.onUpdate[2]?.args).toMatchObject({
      paginationOpts: { cursor: 'ssr-cursor' },
    })
    wrapper.unmount()
  })

  it('keeps an authenticated hydrated list loadable across onNuxtReady and auth confirmation', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('feed:ssr-ready-handoff')
    const key = pageKey(query, {}, 'optional', 'user:A')
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
          useState<boolean>('convex:pending').value = false
          useState<AuthIdentity>('convex:identity').value = toAuthenticatedIdentity({ id: 'A' })
          const state = createConvexPaginatedQueryState(
            query,
            {},
            { auth: 'optional', initialNumItems: 2 },
          ).resultData
          const hydrated = {
            status: state.status.value,
            canLoadMore: state.canLoadMore.value,
          }
          // Registered after the composable's own handoff, so it observes the live state.
          const ready = ref<{ status: string; canLoadMore: boolean } | null>(null)
          onNuxtReady(() => {
            ready.value = {
              status: state.status.value,
              canLoadMore: state.canLoadMore.value,
            }
          })
          return { state, hydrated, ready }
        }),
      {
        owner: makeMockOwner(primary),
        identityObserver: identityPort.observer,
        payloadData: {
          [key]: { value: page(['ssr-a', 'ssr-b'], false, 'ssr-cursor') },
        },
      },
    )

    expect(result.hydrated).toEqual({ status: 'success', canLoadMore: true })
    await vi.waitFor(() => expect(result.ready.value).not.toBeNull())
    expect(result.ready.value).toEqual({
      status: 'success',
      canLoadMore: true,
    })
    expect(result.state.data.value).toEqual(['ssr-a', 'ssr-b'])

    // Convex has not confirmed the token yet: the page waits with the list.
    void result.state.loadMore(2)
    expect(primary.calls.onUpdate).toHaveLength(0)
    expect(result.state.status.value).toBe('success')
    expect(result.state.isLoadingMore.value).toBe(true)
    expect(result.state.canLoadMore.value).toBe(false)
    expect(result.state.data.value).toEqual(['ssr-a', 'ssr-b'])

    identityPort.set({
      authEnabled: true,
      settled: true,
      identityKey: 'user:A',
      identityGeneration: 0,
      error: null,
    })
    await vi.waitFor(() => expect(primary.calls.onUpdate).toHaveLength(2))
    expect(primary.calls.onUpdate[0]?.args).toMatchObject({
      paginationOpts: { cursor: null, endCursor: 'ssr-cursor' },
    })
    expect(primary.calls.onUpdate[1]?.args).toMatchObject({
      paginationOpts: { numItems: 2, cursor: 'ssr-cursor' },
    })
    wrapper.unmount()
  })

  it('runs a loadMore requested while hydrating once the list goes live', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('feed:hydrating-load-more')
    const key = pageKey(query, {})

    const { result, wrapper } = await captureInNuxt(
      () =>
        hydrating(() => {
          const state = createConvexPaginatedQueryState(
            query,
            {},
            {
              auth: 'none',
              initialNumItems: 2,
            },
          ).resultData
          const canLoadMoreWhileHydrating = state.canLoadMore.value
          void state.loadMore(3)
          return {
            state,
            canLoadMoreWhileHydrating,
            held: {
              canLoadMore: state.canLoadMore.value,
              isLoadingMore: state.isLoadingMore.value,
            },
          }
        }),
      {
        owner: makeMockOwner(primary),
        payloadData: {
          [key]: { value: page(['ssr-a', 'ssr-b'], false, 'ssr-cursor') },
        },
      },
    )

    expect(result.canLoadMoreWhileHydrating).toBe(true)
    expect(result.held).toEqual({ canLoadMore: false, isLoadingMore: true })
    await vi.waitFor(() => expect(primary.calls.onUpdate).toHaveLength(3))
    expect(primary.calls.onUpdate[1]?.args).toMatchObject({
      paginationOpts: { cursor: null, endCursor: 'ssr-cursor' },
    })
    expect(primary.calls.onUpdate[2]?.args).toMatchObject({
      paginationOpts: { numItems: 3, cursor: 'ssr-cursor' },
    })
    expect(result.state.status.value).toBe('success')
    expect(result.state.isLoadingMore.value).toBe(true)
    expect(result.state.data.value).toEqual(['ssr-a', 'ssr-b'])
    expect(primary.calls.query).toHaveLength(0)
    wrapper.unmount()
  })

  it.each([
    { label: 'restart()', cursor: null },
    { label: 'restart(cursor)', cursor: 'jump-to' },
  ])('stops showing the SSR page on $label before onNuxtReady', async ({ cursor }) => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>(`feed:hydrating-restart-${cursor ?? 'start'}`)
    const key = pageKey(query, {})

    const { result, wrapper } = await captureInNuxt(
      () =>
        hydrating(() => {
          const state = useConvexPaginatedQuery(query, {}, { auth: 'none', initialNumItems: 2 })
          const beforeRestart = {
            data: state.data.value,
            canLoadMore: state.canLoadMore.value,
          }
          state.restart(cursor)
          const afterRestart = {
            data: state.data.value,
            status: state.status.value,
            canLoadMore: state.canLoadMore.value,
            isExhausted: state.isExhausted.value,
          }
          return {
            state,
            beforeRestart,
            afterRestart,
            onUpdatesAfterRestart: primary.calls.onUpdate.length,
          }
        }),
      {
        owner: makeMockOwner(primary),
        payloadData: {
          [key]: { value: page(['ssr-a', 'ssr-b'], false, 'ssr-cursor') },
        },
      },
    )

    expect(result.beforeRestart).toEqual({
      data: ['ssr-a', 'ssr-b'],
      canLoadMore: true,
    })
    // restart() drops the server page at once: no stale `success` page offering
    // a loadMore that would silently do nothing.
    expect(result.afterRestart.data).toBeUndefined()
    expect(result.afterRestart.status).not.toBe('success')
    expect(result.afterRestart.canLoadMore).toBe(false)
    expect(result.afterRestart.isExhausted).toBe(false)
    expect(result.onUpdatesAfterRestart).toBe(0)

    // The list goes live from the restart cursor, not from the SSR page.
    await vi.waitFor(() => expect(primary.calls.onUpdate).toHaveLength(1))
    expect(primary.calls.onUpdate[0]?.args).toMatchObject({
      paginationOpts: { cursor, numItems: 2 },
    })
    expect(primary.calls.onUpdate[0]?.args).not.toMatchObject({
      paginationOpts: { endCursor: 'ssr-cursor' },
    })
    expect(result.state.data.value).toBeUndefined()
    primary.emitQueryResultWhere(
      (entry) =>
        (entry.args as { paginationOpts: { cursor: string | null } }).paginationOpts.cursor ===
        cursor,
      page(['live-a'], true, 'live-end'),
    )
    await vi.waitFor(() => expect(result.state.data.value).toEqual(['live-a']))
    expect(result.state.status.value).toBe('success')
    expect(primary.calls.query).toHaveLength(0)
    wrapper.unmount()
  })

  it('rejects a mismatched SSR first page before exposing browser state', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('feed:ssr-mismatch')
    const key = pageKey(query, {}, 'optional', 'user:A')
    const identityPort = createIdentityObserverHarness({
      authEnabled: true,
      settled: false,
      identityKey: 'user:B',
      identityGeneration: 0,
      error: null,
    })

    const { result, wrapper } = await captureInNuxt(
      () =>
        hydrating(() => {
          useState<boolean>('convex:pending').value = false
          useState<AuthIdentity>('convex:identity').value = toAuthenticatedIdentity({ id: 'A' })
          return createConvexPaginatedQueryState(
            query,
            {},
            {
              auth: 'optional',
              initialNumItems: 2,
            },
          ).resultData
        }),
      {
        owner: makeMockOwner(primary),
        identityObserver: identityPort.observer,
        payloadData: { [key]: { value: page(['private-A'], true, null) } },
      },
    )

    expect(result.data.value).toBeUndefined()
    expect(result.status.value).toBe('idle')
    wrapper.unmount()
  })

  it('keeps loaded items when a later page fails and reports it with the function name', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('feed:failing-tail')
    const { result, flush, wrapper } = await captureInNuxt(
      () => useConvexPaginatedQuery(query, {}, { auth: 'none', initialNumItems: 2 }),
      { owner: makeMockOwner(primary) },
    )

    await vi.waitFor(() => expect(primary.calls.onUpdate).toHaveLength(1))
    primary.emitQueryResultWhere(() => true, page(['a', 'b'], false, 'cursor-1'))
    await flush()
    const loading = result.loadMore(2)
    primary.emitQueryErrorWhere(
      (e) =>
        (e.args as { paginationOpts: { cursor: string | null } }).paginationOpts.cursor ===
        'cursor-1',
      new Error('tail failed'),
    )
    await expect(loading).resolves.toBeUndefined()

    expect(result.data.value).toEqual(['a', 'b'])
    expect(result.status.value).toBe('success')
    expect(result.pending.value).toBe(false)
    expect(result.isLoadingMore.value).toBe(false)
    expect(result.error.value).toMatchObject({
      functionName: 'feed:failing-tail',
    })
    expect(result.canLoadMore.value).toBe(true)
    wrapper.unmount()
  })

  it('clears pages and re-acquires the first page on an identity change', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('feed:mine')

    const { result, flush, wrapper } = await captureInNuxt(
      () => {
        useState<boolean>('convex:pending').value = false
        const identity = useState<AuthIdentity>('convex:identity')
        identity.value = toAuthenticatedIdentity({ id: 'A' })
        const q = createConvexPaginatedQueryState(
          query,
          {},
          { auth: 'optional', initialNumItems: 2, keepPreviousData: true },
        ).resultData
        return { q, identity }
      },
      { owner: makeMockOwner(primary) },
    )

    await flush()
    primary.emitQueryResultWhere(() => true, page(['a1', 'a2'], false, 'c1'))
    await flush()
    expect(result.q.data.value).toEqual(['a1', 'a2'])

    // Switch identity: pages cleared, no A rows carried across.
    result.identity.value = toAuthenticatedIdentity({ id: 'B' })
    await flush()
    expect(result.q.data.value).toBeUndefined()

    // B's first page acquires a fresh listener and commits under B.
    primary.emitQueryResultWhere(() => true, page(['b1'], true, 'c2'))
    await flush()
    expect(result.q.data.value).toEqual(['b1'])

    wrapper.unmount()
  })

  it('routes an authenticated none paginated query through the anonymous client', async () => {
    const primary = new MockConvexClient()
    const anon = new MockConvexClient()
    const query = mockFnRef<'query'>('feed:public')

    const { flush, wrapper } = await captureInNuxt(
      () => {
        useState<boolean>('convex:pending').value = false
        useState<AuthIdentity>('convex:identity').value = toAuthenticatedIdentity({ id: 'A' })
        return createConvexPaginatedQueryState(query, {}, { auth: 'none', initialNumItems: 2 })
          .resultData
      },
      { owner: makeMockOwner(primary, anon) },
    )

    await flush()
    expect(anon.calls.onUpdate.length).toBe(1)
    expect(primary.calls.onUpdate.length).toBe(0)

    wrapper.unmount()
  })

  it('hydrates byte arguments from the same paginated key used by SSR', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('feed:hydrated-by-digest')
    const digest = new Uint8Array([4, 5, 6]).buffer
    const key = pageKey(query, { digest })

    const { result, wrapper } = await captureInNuxt(
      () =>
        hydrating(
          () =>
            createConvexPaginatedQueryState(query, { digest } as never, {
              auth: 'none',
              initialNumItems: 2,
            }).resultData,
        ),
      {
        owner: makeMockOwner(primary),
        payloadData: { [key]: { value: page(['matching-bytes'], true, null) } },
      },
    )

    expect(result.data.value).toEqual(['matching-bytes'])
    await vi.waitFor(() => expect(primary.calls.onUpdate).toHaveLength(1))
    expect((primary.calls.onUpdate[0]?.args as { digest: ArrayBuffer }).digest).toBe(digest)
    wrapper.unmount()
  })

  it('ignores an SSR first page once hydration has finished', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('feed:stale-payload-navigation')
    const key = pageKey(query, {})
    const { result, wrapper } = await captureInNuxt(
      () => useConvexPaginatedQuery(query, {}, { auth: 'none', initialNumItems: 2 }),
      {
        owner: makeMockOwner(primary),
        payloadData: {
          [key]: { value: page(['old-ssr'], false, 'old-cursor') },
        },
      },
    )

    expect(result.status.value).toBe('pending')
    expect(result.data.value).toBeUndefined()
    await vi.waitFor(() => expect(primary.calls.onUpdate).toHaveLength(1))
    primary.emitQueryResultWhere(() => true, page(['live'], true, null))
    await vi.waitFor(() => expect(result.status.value).toBe('success'))
    expect(result.data.value).toEqual(['live'])
    wrapper.unmount()
  })

  it('renders server:false as idle while hydrating, as the server did', async () => {
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>('feed:server-false-hydration')
    const { result, wrapper } = await captureInNuxt(
      () =>
        hydrating(() => {
          const statusBeforeMount = ref('unknown')
          const pendingBeforeMount = ref<boolean | undefined>(undefined)
          const state = useConvexPaginatedQuery(
            query,
            {},
            { auth: 'none', initialNumItems: 2, server: false },
          )
          onBeforeMount(() => {
            statusBeforeMount.value = state.status.value
            pendingBeforeMount.value = state.pending.value
          })
          return { state, statusBeforeMount, pendingBeforeMount }
        }),
      { owner: makeMockOwner(primary), payloadData: {} },
    )

    expect(result.statusBeforeMount.value).toBe('idle')
    expect(result.pendingBeforeMount.value).toBe(false)
    await vi.waitFor(() => expect(primary.calls.onUpdate).toHaveLength(1))
    expect(result.state.status.value).toBe('pending')
    wrapper.unmount()
  })
})
