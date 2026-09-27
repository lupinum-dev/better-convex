import type { FunctionReference, PaginationResult } from 'convex/server'
import { ConvexError } from 'convex/values'
import { describe, expect, it } from 'vitest'
import { shallowRef } from 'vue'

import { ConvexCallError } from '../../packages/vue/src/errors'
import { createPaginationController } from '../../packages/vue/src/internal/pagination-controller'
import type { PaginationPageOptions } from '../../packages/vue/src/internal/pagination-state'
import type { QueryIsolationTag } from '../../packages/vue/src/internal/query-controller'
import { mockFnRef } from '../helpers/mock-convex-client'

interface Row {
  id: string
}

function page(
  ids: string[],
  continueCursor: string,
  isDone = false,
  split?: {
    cursor: string
    status?: 'SplitRecommended' | 'SplitRequired'
  },
): PaginationResult<Row> {
  return {
    page: ids.map((id) => ({ id })),
    continueCursor,
    isDone,
    ...(split ? { splitCursor: split.cursor } : {}),
    ...(split?.status ? { pageStatus: split.status } : {}),
  }
}

const aliceBoundary = {
  nextBoundaryKey: 'notes:list:alice',
  previousBoundaryKey: 'notes:list:alice',
} as const

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function makeHarness(options?: { live?: boolean; initialCursor?: string | null }) {
  const query = mockFnRef<'query'>('notes:list')
  let args: Record<string, unknown> | 'skip' = { owner: 'alice' }
  let argsHash = 'alice'
  let boundaryKey = 'notes:list:alice'
  let tag: QueryIsolationTag = {
    identityKey: 'user:alice',
    identityGeneration: 1,
  }
  // Reactive like the real entry, so computed state observes gate changes.
  const live = shallowRef(options?.live ?? true)
  const idle = shallowRef(false)
  const boundaryFirstPage = shallowRef<PaginationResult<Row> | null>(null)
  const boundaryError = shallowRef<ConvexCallError | undefined>(undefined)
  const fetches: PaginationPageOptions[] = []
  const fetchQueue: Array<Promise<PaginationResult<Row> | null>> = []
  const subscriptions: Array<{
    args: Record<string, unknown>
    active: boolean
    value(value: PaginationResult<Row>): void
    error(error: Error): void
  }> = []

  const client = {
    onUpdate(
      _query: FunctionReference<'query'>,
      subscriptionArgs: Record<string, unknown>,
      onValue: (value: unknown) => void,
      onError?: (error: Error) => void,
    ) {
      const subscription = {
        args: subscriptionArgs,
        active: true,
        value: (value: PaginationResult<Row>) => onValue(value),
        error: (error: Error) => onError?.(error),
      }
      subscriptions.push(subscription)
      return () => {
        subscription.active = false
      }
    },
  }

  const controller = createPaginationController<Row>({
    query,
    initialNumItems: 2,
    getInitialCursor: () => options?.initialCursor ?? null,
    keepPreviousData: true,
    getArgs: () => args,
    getArgsHash: () => argsHash,
    getBoundaryKey: () => boundaryKey,
    getIsolationTag: () => tag,
    isIdle: () => idle.value,
    isLive: () => live.value,
    getBoundaryFirstPage: () => boundaryFirstPage.value,
    retireBoundaryFirstPage: () => {
      boundaryFirstPage.value = null
    },
    getBoundaryError: () => boundaryError.value,
    setBoundaryError: (error) => {
      boundaryError.value = error
    },
    getClient: () => (live.value ? client : null),
    fetchPage: async (paginationOptions) => {
      fetches.push(paginationOptions)
      return (await fetchQueue.shift()) ?? null
    },
  })
  controller.start()

  return {
    controller,
    state: {
      query,
      subscriptions,
      fetches,
      fetchQueue,
      get boundaryError() {
        return boundaryError.value
      },
      get boundaryFirstPage() {
        return boundaryFirstPage.value
      },
      setBoundaryFirstPage(value: PaginationResult<Row> | null) {
        boundaryFirstPage.value = value
      },
      setLive(value: boolean) {
        live.value = value
      },
      setIdle(value: boolean) {
        idle.value = value
      },
      setArgs(nextArgs: Record<string, unknown> | 'skip', hash: string, key: string) {
        args = nextArgs
        argsHash = hash
        boundaryKey = key
      },
      setIdentity(nextTag: QueryIsolationTag, key: string) {
        tag = nextTag
        boundaryKey = key
      },
    },
  }
}

describe('pagination controller', () => {
  it('settles the first-page awaitable on a hydrated page, live value, error, or disposal', async () => {
    const hydrated = makeHarness()
    hydrated.state.setBoundaryFirstPage(page(['hydrated'], '', true))
    await expect(hydrated.controller.firstPageSettled()).resolves.toBeUndefined()
    hydrated.controller.dispose()

    const live = makeHarness()
    const liveSettlement = live.controller.firstPageSettled()
    live.state.subscriptions[0]?.value(page(['live'], '', true))
    await expect(liveSettlement).resolves.toBeUndefined()
    live.controller.dispose()

    const failed = makeHarness()
    const failedSettlement = failed.controller.firstPageSettled()
    failed.state.subscriptions[0]?.error(new Error('failed'))
    await expect(failedSettlement).resolves.toBeUndefined()
    failed.controller.dispose()

    const skipped = makeHarness()
    const skippedSettlement = skipped.controller.firstPageSettled()
    skipped.state.setIdle(true)
    skipped.state.setLive(false)
    await skipped.controller.handleExecutionBoundary({
      nextBoundaryKey: 'notes:list:skip',
      previousBoundaryKey: 'notes:list:alice',
      nextLive: false,
      previousLive: true,
    })
    await expect(skippedSettlement).resolves.toBeUndefined()
    skipped.controller.dispose()

    const disposed = makeHarness()
    const disposedSettlement = disposed.controller.firstPageSettled()
    disposed.controller.dispose()
    await expect(disposedSettlement).resolves.toBeUndefined()
  })

  it('owns initial, argument, identity, idle, and disposal subscription transitions', async () => {
    const { controller, state } = makeHarness()

    expect(state.subscriptions).toHaveLength(1)
    expect(state.subscriptions[0]?.active).toBe(true)

    state.setLive(false)
    await controller.handleExecutionBoundary({
      nextBoundaryKey: 'notes:list:alice',
      previousBoundaryKey: 'notes:list:alice',
      nextLive: false,
      previousLive: true,
    })
    expect(state.subscriptions).toHaveLength(1)
    expect(state.subscriptions[0]?.active).toBe(false)

    state.setLive(true)
    await controller.handleExecutionBoundary({
      nextBoundaryKey: 'notes:list:alice',
      previousBoundaryKey: 'notes:list:alice',
      nextLive: true,
      previousLive: false,
    })
    expect(state.subscriptions).toHaveLength(2)
    expect(state.subscriptions[1]?.active).toBe(true)

    state.setArgs({ owner: 'bob' }, 'bob', 'notes:list:bob')
    await controller.handleExecutionBoundary({
      nextBoundaryKey: 'notes:list:bob',
      previousBoundaryKey: 'notes:list:alice',
      nextLive: true,
      previousLive: true,
    })
    expect(state.subscriptions).toHaveLength(3)
    expect(state.subscriptions[1]?.active).toBe(false)
    expect(state.subscriptions[2]?.active).toBe(true)

    const previousTag = {
      identityKey: 'user:alice',
      identityGeneration: 1,
    } as const
    const nextTag = { identityKey: 'user:bob', identityGeneration: 2 } as const
    state.setIdentity(nextTag, 'notes:list:bob:identity-2')
    controller.handleIdentityBoundary({
      nextTag,
      previousTag,
      previousBoundaryKey: 'notes:list:bob',
    })
    expect(state.subscriptions).toHaveLength(4)
    expect(state.subscriptions[2]?.active).toBe(false)
    expect(state.subscriptions[3]?.active).toBe(true)

    state.setIdle(true)
    await controller.handleExecutionBoundary({
      nextBoundaryKey: 'notes:list:idle',
      previousBoundaryKey: 'notes:list:bob:identity-2',
      nextLive: false,
      previousLive: true,
    })
    expect(state.subscriptions).toHaveLength(4)
    expect(state.subscriptions[3]?.active).toBe(false)

    state.setIdle(false)
    await controller.handleExecutionBoundary({
      nextBoundaryKey: 'notes:list:bob:identity-2',
      previousBoundaryKey: 'notes:list:idle',
      nextLive: true,
      previousLive: false,
    })
    expect(state.subscriptions).toHaveLength(5)
    expect(state.subscriptions[4]?.active).toBe(true)

    controller.dispose()
    controller.dispose()
    expect(state.subscriptions[4]?.active).toBe(false)
  })

  it('keeps prior argument data stale but retires old callbacks before the next page settles', async () => {
    const { controller, state } = makeHarness()
    const aliceSubscription = state.subscriptions[0]
    aliceSubscription?.value(page(['alice'], 'alice-cursor'))

    state.setArgs({ owner: 'bob' }, 'bob', 'notes:list:bob')
    await controller.handleExecutionBoundary({
      nextBoundaryKey: 'notes:list:bob',
      previousBoundaryKey: 'notes:list:alice',
      nextLive: true,
      previousLive: true,
    })

    expect(controller.status.value).toBe('pending')
    expect(controller.isStale.value).toBe(true)
    expect(controller.data.value?.map((row) => row.id)).toEqual(['alice'])

    aliceSubscription?.value(page(['retired'], '', true))
    expect(controller.data.value?.map((row) => row.id)).toEqual(['alice'])

    state.subscriptions[1]?.value(page(['bob'], '', true))
    expect(controller.status.value).toBe('success')
    expect(controller.isStale.value).toBe(false)
    expect(controller.data.value?.map((row) => row.id)).toEqual(['bob'])
  })

  it('does not resurrect settled data after a terminal skip boundary', async () => {
    const { controller, state } = makeHarness()
    state.subscriptions[0]?.value(page(['alice'], '', true))

    state.setArgs('skip', 'skip', 'notes:list:skip')
    state.setIdle(true)
    state.setLive(false)
    await controller.handleExecutionBoundary({
      nextBoundaryKey: 'notes:list:skip',
      previousBoundaryKey: 'notes:list:alice',
      nextLive: false,
      previousLive: true,
    })
    expect(controller.data.value).toBeUndefined()

    state.setArgs({ owner: 'bob' }, 'bob', 'notes:list:bob')
    state.setIdle(false)
    state.setLive(true)
    await controller.handleExecutionBoundary({
      nextBoundaryKey: 'notes:list:bob',
      previousBoundaryKey: 'notes:list:skip',
      nextLive: true,
      previousLive: false,
    })

    expect(controller.status.value).toBe('pending')
    expect(controller.isStale.value).toBe(false)
    expect(controller.data.value).toBeUndefined()
  })

  it('withholds SplitRequired data and atomically installs bounded replacement pages', () => {
    const { controller, state } = makeHarness()

    state.subscriptions[0]?.value(
      page(['unsafe'], 'page-end', false, {
        cursor: 'split-point',
        status: 'SplitRequired',
      }),
    )

    expect(controller.data.value).toBeUndefined()
    expect(controller.status.value).toBe('pending')
    expect(state.subscriptions).toHaveLength(3)
    expect(state.subscriptions[1]?.args.paginationOpts).toMatchObject({
      cursor: null,
      endCursor: 'split-point',
    })
    expect(state.subscriptions[2]?.args.paginationOpts).toMatchObject({
      cursor: 'split-point',
      endCursor: 'page-end',
    })

    state.subscriptions[1]?.value(page(['a'], 'split-point'))
    expect(controller.data.value).toBeUndefined()

    state.subscriptions[2]?.value(page(['b'], 'page-end'))
    expect(controller.data.value?.map((row) => row.id)).toEqual(['a', 'b'])
    expect(controller.status.value).toBe('success')
    expect(state.subscriptions[0]?.active).toBe(false)
    expect(state.subscriptions[1]?.active).toBe(true)
    expect(state.subscriptions[2]?.active).toBe(true)

    state.subscriptions[1]?.value(page(['a2'], 'split-point'))
    state.subscriptions[2]?.value(page(['b2'], 'page-end'))
    expect(controller.data.value?.map((row) => row.id)).toEqual(['a2', 'b2'])
  })

  it('keeps SplitRecommended data visible until bounded replacements settle', () => {
    const { controller, state } = makeHarness()

    state.subscriptions[0]?.value(
      page(['a', 'b'], 'page-end', false, {
        cursor: 'split-point',
        status: 'SplitRecommended',
      }),
    )

    expect(controller.data.value?.map((row) => row.id)).toEqual(['a', 'b'])
    expect(controller.status.value).toBe('success')
    expect(state.subscriptions).toHaveLength(3)

    state.subscriptions[1]?.value(page(['a'], 'split-point'))
    expect(controller.data.value?.map((row) => row.id)).toEqual(['a', 'b'])

    state.subscriptions[2]?.value(page(['b'], 'page-end'))
    expect(controller.data.value?.map((row) => row.id)).toEqual(['a', 'b'])
    expect(state.subscriptions[0]?.active).toBe(false)
  })

  it('withholds an incomplete tail while preserving earlier bounded pages', () => {
    const { controller, state } = makeHarness()

    state.subscriptions[0]?.value(page(['a'], 'cursor-1'))
    void controller.loadMore(2)
    state.subscriptions[2]?.value(
      page(['unsafe'], 'cursor-2', false, {
        cursor: 'cursor-1.5',
        status: 'SplitRequired',
      }),
    )

    expect(controller.data.value?.map((row) => row.id)).toEqual(['a'])
    expect(controller.status.value).toBe('success')
    expect(controller.isLoadingMore.value).toBe(true)
    expect(state.subscriptions).toHaveLength(5)

    state.subscriptions[3]?.value(page(['b'], 'cursor-1.5'))
    expect(controller.data.value?.map((row) => row.id)).toEqual(['a'])

    state.subscriptions[4]?.value(page(['c'], 'cursor-2'))
    expect(controller.data.value?.map((row) => row.id)).toEqual(['a', 'b', 'c'])
    expect(controller.status.value).toBe('success')
    expect(controller.isLoadingMore.value).toBe(false)
    expect(state.subscriptions[2]?.active).toBe(false)
  })

  it('bounds every loaded page so realistic live updates preserve page boundaries', () => {
    const { controller, state } = makeHarness()

    state.subscriptions[0]?.value(page(['a', 'b'], 'cursor-1'))
    void controller.loadMore(2)

    expect(state.subscriptions).toHaveLength(3)
    expect(state.subscriptions[0]?.active).toBe(false)
    expect(state.subscriptions[1]?.args.paginationOpts).toMatchObject({
      cursor: null,
      endCursor: 'cursor-1',
    })
    expect(state.subscriptions[2]?.args.paginationOpts).toMatchObject({
      cursor: 'cursor-1',
    })

    state.subscriptions[2]?.value(page(['c', 'd'], 'cursor-2'))
    void controller.loadMore(2)
    expect(state.subscriptions).toHaveLength(5)
    expect(state.subscriptions[2]?.active).toBe(false)
    expect(state.subscriptions[3]?.args.paginationOpts).toMatchObject({
      cursor: 'cursor-1',
      endCursor: 'cursor-2',
    })
    expect(state.subscriptions[4]?.args.paginationOpts).toMatchObject({
      cursor: 'cursor-2',
    })

    state.subscriptions[1]?.value(page(['a', 'aa', 'b'], 'cursor-1'))
    state.subscriptions[3]?.value(page(['c', 'd'], 'cursor-2'))
    state.subscriptions[4]?.value(page(['e'], '', true))

    expect(controller.data.value?.map((row) => row.id)).toEqual(['a', 'aa', 'b', 'c', 'd', 'e'])
    expect(new Set(controller.data.value?.map((row) => row.id) ?? []).size).toBe(6)
  })

  it('continues through an empty page and binds each live tail callback to its own page', () => {
    const { controller, state } = makeHarness()

    state.subscriptions[0]?.value(page([], 'cursor-1'))
    expect(controller.status.value).toBe('success')

    void controller.loadMore(2)
    void controller.loadMore(2)
    expect(state.subscriptions).toHaveLength(3)
    state.subscriptions[2]?.value(page(['b'], 'cursor-2'))
    void controller.loadMore(2)
    state.subscriptions[4]?.value(page(['c'], '', true))

    expect(controller.data.value?.map((row) => row.id)).toEqual(['b', 'c'])
    expect(controller.pages.value.map((entry) => entry.result?.page[0]?.id)).toEqual(['b', 'c'])
    expect(controller.status.value).toBe('success')
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid loadMore count %s before changing cursor state',
    (numItems) => {
      const { controller, state } = makeHarness()
      state.subscriptions[0]?.value(page(['a'], 'cursor-1'))

      expect(() => controller.loadMore(numItems)).toThrow(
        '[better-convex-vue] loadMore numItems must be a positive safe integer',
      )
      expect(controller.pages.value).toEqual([])
      expect(state.subscriptions).toHaveLength(1)
      controller.dispose()
    },
  )

  it('refreshes every loaded page from the new cursor chain and commits atomically', async () => {
    const { controller, state } = makeHarness()
    state.subscriptions[0]?.value(page(['a'], 'old-1'))
    void controller.loadMore(2)
    state.subscriptions[2]?.value(page(['b'], 'old-2'))
    void controller.loadMore(2)
    state.subscriptions[4]?.value(page(['c'], '', true))

    state.fetchQueue.push(
      Promise.resolve(page(['a2'], 'new-1')),
      Promise.resolve(page(['b2'], 'new-2')),
      Promise.resolve(page(['c2'], '', true)),
    )
    await controller.refresh()

    expect(state.fetches.map((options) => options.cursor)).toEqual([null, 'new-1', 'new-2'])
    expect(controller.data.value?.map((row) => row.id)).toEqual(['a2', 'b2', 'c2'])
  })

  it('retires a loaded tail when refresh makes an earlier page terminal', async () => {
    const { controller, state } = makeHarness()
    state.subscriptions[0]?.value(page(['a'], 'old-1'))
    void controller.loadMore(2)
    state.subscriptions[2]?.value(page(['b'], '', true))

    state.fetchQueue.push(Promise.resolve(page(['a2'], '', true)))
    await controller.refresh()

    expect(state.fetches.map((options) => options.cursor)).toEqual([null])
    expect(controller.data.value?.map((row) => row.id)).toEqual(['a2'])
    expect(controller.pages.value).toEqual([])
    expect(state.subscriptions[2]?.active).toBe(false)
    expect(controller.status.value).toBe('success')
  })

  it('retires only the tail invalidated by a live cursor-boundary change', () => {
    const { controller, state } = makeHarness()
    state.subscriptions[0]?.value(page(['a'], 'cursor-1'))
    void controller.loadMore(2)
    state.subscriptions[2]?.value(page(['b'], 'cursor-2'))
    void controller.loadMore(2)
    state.subscriptions[4]?.value(page(['c'], '', true))

    state.subscriptions[3]?.value(page(['b2'], 'changed-tail'))
    expect(controller.data.value?.map((row) => row.id)).toEqual(['a', 'b2'])
    expect(state.subscriptions[4]?.active).toBe(false)

    state.subscriptions[1]?.value(page(['a2'], 'changed-first'))
    expect(controller.data.value?.map((row) => row.id)).toEqual(['a2'])
    expect(state.subscriptions[3]?.active).toBe(false)
    expect(controller.canLoadMore.value).toBe(true)
  })

  it('retires subscriptions and queued refresh results synchronously at an identity boundary', async () => {
    const { controller, state } = makeHarness()
    state.subscriptions[0]?.value(page(['alice'], 'cursor-1'))
    void controller.loadMore(2)
    state.subscriptions[2]?.value(page(['tail'], '', true))

    const pending = deferred<PaginationResult<Row> | null>()
    state.fetchQueue.push(pending.promise)
    const refresh = controller.refresh()
    const previousTag = {
      identityKey: 'user:alice',
      identityGeneration: 1,
    } as const
    const nextTag = { identityKey: 'user:bob', identityGeneration: 2 } as const
    state.setIdentity(nextTag, 'notes:list:bob')
    controller.handleIdentityBoundary({
      nextTag,
      previousTag,
      previousBoundaryKey: 'notes:list:alice',
    })

    expect(controller.data.value).toBeUndefined()
    expect(state.subscriptions.slice(0, 3).every((subscription) => !subscription.active)).toBe(true)
    expect(state.subscriptions[3]?.active).toBe(true)
    pending.resolve(page(['stale-alice'], '', true))
    await refresh
    expect(controller.data.value).toBeUndefined()
  })

  it('holds a page requested before the list is live and subscribes it with the list', async () => {
    const { controller, state } = makeHarness({ live: false })
    state.setBoundaryFirstPage(page(['a'], 'cursor-1'))

    expect(controller.status.value).toBe('success')
    expect(controller.canLoadMore.value).toBe(true)
    let settled = false
    const held = controller.loadMore(2).then(() => {
      settled = true
    })
    expect(state.fetches).toEqual([])
    expect(state.subscriptions).toHaveLength(0)
    expect(controller.pages.value).toHaveLength(1)
    expect(controller.status.value).toBe('success')
    expect(controller.isLoadingMore.value).toBe(true)
    expect(controller.canLoadMore.value).toBe(false)
    expect(controller.data.value?.map((row) => row.id)).toEqual(['a'])
    await expect(controller.loadMore(2)).resolves.toBeUndefined()
    expect(controller.pages.value).toHaveLength(1)
    expect(settled).toBe(false)

    state.setLive(true)
    await controller.handleExecutionBoundary({
      ...aliceBoundary,
      nextLive: true,
      previousLive: false,
    })
    expect(
      state.subscriptions.map((subscription) => subscription.args.paginationOpts),
    ).toMatchObject([{ cursor: null, endCursor: 'cursor-1' }, { cursor: 'cursor-1' }])

    state.subscriptions[1]?.value(page(['b'], '', true))
    await held
    expect(settled).toBe(true)
    expect(controller.data.value?.map((row) => row.id)).toEqual(['a', 'b'])
    expect(controller.status.value).toBe('success')
    expect(controller.canLoadMore.value).toBe(false)
    expect(controller.isExhausted.value).toBe(true)
  })

  it('resubscribes every existing page when the same boundary becomes live', async () => {
    const { controller, state } = makeHarness()
    state.subscriptions[0]?.value(page(['a'], 'cursor-1'))
    void controller.loadMore(2)
    state.subscriptions[2]?.value(page(['b'], 'cursor-2'))
    void controller.loadMore(2)

    await controller.handleExecutionBoundary({
      ...aliceBoundary,
      nextLive: true,
      previousLive: false,
    })

    expect(state.subscriptions.slice(0, 5).every((subscription) => !subscription.active)).toBe(true)
    expect(
      state.subscriptions.slice(5).map((subscription) => subscription.args.paginationOpts),
    ).toMatchObject([
      { cursor: null, endCursor: 'cursor-1' },
      { cursor: 'cursor-1', endCursor: 'cursor-2' },
      { cursor: 'cursor-2' },
    ])
    state.subscriptions[4]?.value(page(['retired'], '', true))
    expect(controller.status.value).toBe('success')
    expect(controller.isLoadingMore.value).toBe(true)

    state.subscriptions[7]?.value(page(['c'], '', true))
    state.subscriptions[6]?.value(page(['b2'], 'cursor-2'))
    expect(controller.data.value?.map((row) => row.id)).toEqual(['a', 'b2', 'c'])
    expect(controller.status.value).toBe('success')
    expect(controller.isLoadingMore.value).toBe(false)
    expect(controller.isExhausted.value).toBe(true)
  })

  it('stops at a withheld middle page instead of concatenating around the hole', () => {
    const { controller, state } = makeHarness()
    state.subscriptions[0]?.value(page(['a'], 'cursor-1'))
    void controller.loadMore(2)
    state.subscriptions[2]?.value(page(['b'], 'cursor-2'))
    void controller.loadMore(2)
    state.subscriptions[4]?.value(page(['c'], '', true))
    expect(controller.data.value?.map((row) => row.id)).toEqual(['a', 'b', 'c'])

    state.subscriptions[3]?.value(
      page(['unsafe'], 'cursor-2', false, { cursor: 'cursor-1.5', status: 'SplitRequired' }),
    )

    expect(controller.data.value?.map((row) => row.id)).toEqual(['a'])
    expect(controller.status.value).toBe('success')
    expect(controller.isLoadingMore.value).toBe(true)
    expect(controller.isExhausted.value).toBe(false)
    expect(controller.canLoadMore.value).toBe(false)

    state.subscriptions[5]?.value(page(['b1'], 'cursor-1.5'))
    state.subscriptions[6]?.value(page(['b2'], 'cursor-2'))
    expect(controller.data.value?.map((row) => row.id)).toEqual(['a', 'b1', 'b2', 'c'])
    expect(controller.status.value).toBe('success')
    expect(controller.isLoadingMore.value).toBe(false)
    expect(controller.isExhausted.value).toBe(true)
    expect(controller.canLoadMore.value).toBe(false)
  })

  it('stops at every pending page, not only the last one', () => {
    const { controller, state } = makeHarness()
    state.subscriptions[0]?.value(page(['a'], 'cursor-1'))
    void controller.loadMore(2)
    state.subscriptions[2]?.value(page(['b'], 'cursor-2'))
    void controller.loadMore(2)
    state.subscriptions[4]?.value(page(['c'], 'cursor-3'))

    state.subscriptions[1]?.value(
      page(['unsafe'], 'cursor-1', false, { cursor: 'cursor-0.5', status: 'SplitRequired' }),
    )

    expect(controller.data.value?.map((row) => row.id)).toEqual(['a', 'b', 'c'])
    expect(controller.isStale.value).toBe(true)
    expect(controller.status.value).toBe('pending')
    expect(controller.canLoadMore.value).toBe(false)
  })

  it('keeps loaded items and reports a failed later page separately', () => {
    const { controller, state } = makeHarness()
    state.subscriptions[0]?.value(page(['a'], 'cursor-1'))
    void controller.loadMore(2)
    state.subscriptions[2]?.value(page(['b'], 'cursor-2'))
    void controller.loadMore(2)
    state.subscriptions[4]?.error(new Error('tail failed'))

    expect(controller.data.value?.map((row) => row.id)).toEqual(['a', 'b'])
    expect(controller.status.value).toBe('success')
    expect(controller.pending.value).toBe(false)
    expect(controller.isLoadingMore.value).toBe(false)
    expect(controller.error.value).toBeInstanceOf(ConvexCallError)
    expect(controller.error.value?.functionName).toBe('notes:list')
    expect(controller.error.value).toBe(controller.pages.value[1]?.error)
    expect(state.boundaryError).toBeUndefined()
    // The failed tail may be requested again.
    expect(controller.canLoadMore.value).toBe(true)

    state.subscriptions[3]?.error(new Error('middle failed'))
    expect(controller.data.value?.map((row) => row.id)).toEqual(['a', 'b'])
    expect(state.boundaryError).toBeUndefined()

    state.subscriptions[3]?.value(page(['b2'], 'cursor-2'))
    state.subscriptions[4]?.value(page(['c'], '', true))
    expect(controller.data.value?.map((row) => row.id)).toEqual(['a', 'b2', 'c'])
    expect(controller.error.value).toBeUndefined()
    expect(controller.status.value).toBe('success')
  })

  it('fails a later-page split on that page without failing the first page', () => {
    const { controller, state } = makeHarness()
    state.subscriptions[0]?.value(page(['a'], 'cursor-1'))
    void controller.loadMore(2)
    state.subscriptions[2]?.value(
      page(['unsafe'], 'cursor-2', false, { cursor: 'cursor-1.5', status: 'SplitRequired' }),
    )
    state.subscriptions[3]?.error(new Error('split failed'))

    expect(state.boundaryError).toBeUndefined()
    expect(controller.error.value).toBeInstanceOf(ConvexCallError)
    expect(controller.pages.value[0]?.error).toBe(controller.error.value)
    expect(controller.data.value?.map((row) => row.id)).toEqual(['a'])
    expect(state.subscriptions[4]?.active).toBe(false)
  })

  it.each([
    ['message', new Error('Uncaught Error: InvalidCursor: cursor is from a different query')],
    [
      'system data',
      new ConvexError({ isConvexSystemError: true, paginationError: 'InvalidCursor' }),
    ],
  ])('resets pagination when a later page reports an invalid cursor (%s)', (_label, cause) => {
    const { controller, state } = makeHarness()
    state.subscriptions[0]?.value(page(['a'], 'cursor-1'))
    void controller.loadMore(2)
    state.subscriptions[2]?.value(page(['b'], 'cursor-2'))
    const firstId = (state.subscriptions[1]?.args.paginationOpts as PaginationPageOptions).id

    state.subscriptions[2]?.error(cause)

    expect(state.subscriptions.slice(0, 3).every((subscription) => !subscription.active)).toBe(true)
    expect(state.subscriptions).toHaveLength(4)
    const restarted = state.subscriptions[3]?.args.paginationOpts as PaginationPageOptions
    expect(restarted).toMatchObject({ cursor: null, numItems: 2 })
    expect(restarted.endCursor).toBeUndefined()
    expect(restarted.id).not.toBe(firstId)
    expect(controller.pages.value).toEqual([])
    expect(controller.error.value).toBeUndefined()
    expect(controller.status.value).toBe('pending')
    expect(controller.isStale.value).toBe(true)
    expect(controller.data.value?.map((row) => row.id)).toEqual(['a', 'b'])

    state.subscriptions[3]?.value(page(['a2'], 'cursor-1'))
    expect(controller.data.value?.map((row) => row.id)).toEqual(['a2'])
    expect(controller.status.value).toBe('success')
  })

  it('never revives the hydrated first page after an invalid-cursor restart', () => {
    const { controller, state } = makeHarness()
    state.setBoundaryFirstPage(page(['ssr'], 'ssr-cursor'))
    // Hydration parity: the first render uses the server page.
    expect(controller.data.value?.map((row) => row.id)).toEqual(['ssr'])
    expect(controller.status.value).toBe('success')

    state.subscriptions[0]?.value(page(['a'], 'cursor-1'))
    expect(state.boundaryFirstPage).toBeNull()
    void controller.loadMore(2)
    state.subscriptions[2]?.value(page(['b'], 'cursor-2'))
    state.subscriptions[2]?.error(new Error('InvalidCursor: stale'))

    expect(controller.status.value).toBe('pending')
    expect(controller.isStale.value).toBe(true)
    expect(controller.data.value?.map((row) => row.id)).toEqual(['a', 'b'])
    expect(controller.canLoadMore.value).toBe(false)
    const subscriptionCount = state.subscriptions.length
    void controller.loadMore(2)
    expect(state.subscriptions).toHaveLength(subscriptionCount)
  })

  it('retires the hydrated first page on reset even before live data arrives', () => {
    const { controller, state } = makeHarness()
    state.setBoundaryFirstPage(page(['ssr'], 'ssr-cursor'))
    controller.reset()

    expect(state.boundaryFirstPage).toBeNull()
    expect(controller.status.value).toBe('pending')
    expect(controller.data.value).toBeUndefined()
  })

  it('surfaces an invalid initial cursor instead of resetting into a loop', () => {
    const { controller, state } = makeHarness({ initialCursor: 'stale-cursor' })
    expect(state.subscriptions[0]?.args.paginationOpts).toMatchObject({ cursor: 'stale-cursor' })

    state.subscriptions[0]?.error(new Error('InvalidCursor: stale cursor'))

    expect(state.subscriptions).toHaveLength(1)
    expect(controller.status.value).toBe('error')
    expect(controller.error.value).toBeInstanceOf(ConvexCallError)
    expect(controller.error.value?.functionName).toBe('notes:list')
  })

  it('resets when refresh meets an invalid cursor', async () => {
    const { controller, state } = makeHarness()
    state.subscriptions[0]?.value(page(['a'], 'cursor-1'))
    void controller.loadMore(2)
    state.subscriptions[2]?.value(page(['b'], '', true))

    state.fetchQueue.push(Promise.reject(new Error('InvalidCursor: stale')))
    await controller.refresh()

    expect(state.subscriptions.slice(0, 3).every((subscription) => !subscription.active)).toBe(true)
    expect(state.subscriptions[3]?.args.paginationOpts).toMatchObject({ cursor: null })
    expect(controller.pages.value).toEqual([])
    expect(controller.error.value).toBeUndefined()
    expect(controller.status.value).toBe('pending')
  })

  it('keeps the loaded list when refresh fails on a later page', async () => {
    const { controller, state } = makeHarness()
    state.subscriptions[0]?.value(page(['a'], 'cursor-1'))
    void controller.loadMore(2)
    state.subscriptions[2]?.value(page(['b'], 'cursor-2'))
    void controller.loadMore(2)
    state.subscriptions[4]?.value(page(['c'], '', true))

    state.fetchQueue.push(
      Promise.resolve(page(['a2'], 'cursor-1')),
      Promise.reject(new Error('page two failed')),
    )
    await controller.refresh()

    expect(state.fetches.map((options) => options.cursor)).toEqual([null, 'cursor-1'])
    expect(controller.data.value?.map((row) => row.id)).toEqual(['a', 'b', 'c'])
    expect(state.boundaryError).toBeUndefined()
    expect(controller.error.value).toBeInstanceOf(ConvexCallError)
    expect(controller.pages.value[0]?.error).toBe(controller.error.value)
    expect(controller.status.value).toBe('success')
    expect([1, 3, 4].every((index) => state.subscriptions[index]?.active)).toBe(true)

    state.subscriptions[3]?.value(page(['b2'], 'cursor-2'))
    expect(controller.error.value).toBeUndefined()
    expect(controller.status.value).toBe('success')
  })

  it('splits a live page that grows beyond twice the initial page size', () => {
    const { controller, state } = makeHarness()

    state.subscriptions[0]?.value(page(['a', 'b', 'c', 'd'], 'page-end', false, { cursor: 'mid' }))
    expect(state.subscriptions).toHaveLength(1)
    state.subscriptions[0]?.value(page(['a', 'b', 'c', 'd', 'e'], 'page-end'))
    expect(state.subscriptions).toHaveLength(1)

    state.subscriptions[0]?.value(
      page(['a', 'b', 'c', 'd', 'e'], 'page-end', false, { cursor: 'mid' }),
    )
    expect(controller.data.value?.map((row) => row.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(controller.status.value).toBe('success')
    expect(state.subscriptions).toHaveLength(3)
    expect(state.subscriptions[1]?.args.paginationOpts).toMatchObject({
      cursor: null,
      endCursor: 'mid',
    })
    expect(state.subscriptions[2]?.args.paginationOpts).toMatchObject({
      cursor: 'mid',
      endCursor: 'page-end',
    })

    state.subscriptions[1]?.value(page(['a', 'b'], 'mid'))
    state.subscriptions[2]?.value(page(['c', 'd', 'e'], 'page-end'))
    expect(controller.data.value?.map((row) => row.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(controller.pages.value).toHaveLength(1)
    expect(state.subscriptions[0]?.active).toBe(false)
    expect(state.subscriptions).toHaveLength(3)
  })

  it('splits an oversized later page and keeps its items visible meanwhile', () => {
    const { controller, state } = makeHarness()
    state.subscriptions[0]?.value(page(['a'], 'cursor-1'))
    void controller.loadMore(8)
    state.subscriptions[2]?.value(
      page(['b', 'c', 'd', 'e', 'f'], 'cursor-2', false, { cursor: 'cursor-1.5' }),
    )

    expect(controller.data.value?.map((row) => row.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(state.subscriptions).toHaveLength(5)
    expect(state.subscriptions[3]?.args.paginationOpts).toMatchObject({
      cursor: 'cursor-1',
      endCursor: 'cursor-1.5',
    })
    expect(state.subscriptions[4]?.args.paginationOpts).toMatchObject({
      cursor: 'cursor-1.5',
      endCursor: 'cursor-2',
    })
  })

  it('settles loadMore when its page loads or fails and never rejects', async () => {
    const { controller, state } = makeHarness()
    state.subscriptions[0]?.value(page(['a'], 'cursor-1'))

    let loaded = false
    const first = controller.loadMore(2).then(() => {
      loaded = true
    })
    await Promise.resolve()
    expect(loaded).toBe(false)
    expect(controller.isLoadingMore.value).toBe(true)
    expect(controller.status.value).toBe('success')
    expect(controller.pending.value).toBe(false)
    state.subscriptions[2]?.value(page(['b'], 'cursor-2'))
    await first
    expect(loaded).toBe(true)
    expect(controller.isLoadingMore.value).toBe(false)

    const failed = controller.loadMore(2)
    state.subscriptions[4]?.error(new Error('tail failed'))
    await expect(failed).resolves.toBeUndefined()
    expect(controller.status.value).toBe('success')
    expect(controller.data.value?.map((row) => row.id)).toEqual(['a', 'b'])
  })

  it('settles loadMore only after nested bounded split replacements commit', async () => {
    const { controller, state } = makeHarness()
    state.subscriptions[0]?.value(page(['a'], 'cursor-1'))

    let settled = false
    const load = controller.loadMore(2).then(() => {
      settled = true
    })
    state.subscriptions[2]?.value(
      page(['unsafe'], 'cursor-2', false, { cursor: 'cursor-1.5', status: 'SplitRequired' }),
    )
    // The first replacement is itself too large and must split again.
    state.subscriptions[3]?.value(
      page(['unsafe'], 'cursor-1.5', false, { cursor: 'cursor-1.2', status: 'SplitRequired' }),
    )
    state.subscriptions[4]?.value(page(['d'], 'cursor-2'))
    await Promise.resolve()
    expect(controller.isLoadingMore.value).toBe(true)
    expect(settled).toBe(false)

    state.subscriptions[5]?.value(page(['b'], 'cursor-1.2'))
    state.subscriptions[6]?.value(page(['c'], 'cursor-1.5'))
    await load
    expect(settled).toBe(true)
    expect(controller.isLoadingMore.value).toBe(false)
    expect(controller.data.value?.map((row) => row.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('does nothing and resolves at once without canLoadMore', async () => {
    const { controller, state } = makeHarness()

    await expect(controller.loadMore(2)).resolves.toBeUndefined()
    expect(controller.pages.value).toEqual([])

    state.subscriptions[0]?.value(page(['a'], '', true))
    expect(controller.isExhausted.value).toBe(true)
    expect(controller.canLoadMore.value).toBe(false)
    await expect(controller.loadMore(2)).resolves.toBeUndefined()
    expect(controller.pages.value).toEqual([])
    expect(state.subscriptions).toHaveLength(1)
  })

  it('settles a pending loadMore when it is superseded, reset, retired, or disposed', async () => {
    const superseded = makeHarness()
    superseded.state.subscriptions[0]?.value(page(['a'], 'cursor-1'))
    const supersededLoad = superseded.controller.loadMore(2)
    superseded.state.subscriptions[1]?.value(page(['a2'], 'changed'))
    await expect(supersededLoad).resolves.toBeUndefined()
    expect(superseded.controller.pages.value).toEqual([])

    const reset = makeHarness()
    reset.state.subscriptions[0]?.value(page(['a'], 'cursor-1'))
    const resetLoad = reset.controller.loadMore(2)
    reset.controller.reset()
    await expect(resetLoad).resolves.toBeUndefined()

    const retired = makeHarness()
    retired.state.subscriptions[0]?.value(page(['a'], 'cursor-1'))
    const retiredLoad = retired.controller.loadMore(2)
    const nextTag = { identityKey: 'user:bob', identityGeneration: 2 } as const
    retired.state.setIdentity(nextTag, 'notes:list:bob')
    retired.controller.handleIdentityBoundary({
      nextTag,
      previousTag: { identityKey: 'user:alice', identityGeneration: 1 },
      previousBoundaryKey: 'notes:list:alice',
    })
    await expect(retiredLoad).resolves.toBeUndefined()

    const disposed = makeHarness({ live: false })
    disposed.state.setBoundaryFirstPage(page(['a'], 'cursor-1'))
    const disposedLoad = disposed.controller.loadMore(2)
    disposed.controller.dispose()
    await expect(disposedLoad).resolves.toBeUndefined()
  })

  it('retries a failed later page through loadMore', async () => {
    const { controller, state } = makeHarness()
    state.subscriptions[0]?.value(page(['a'], 'cursor-1'))
    void controller.loadMore(2)
    state.subscriptions[2]?.error(new Error('tail failed'))
    expect(controller.error.value).toBeInstanceOf(ConvexCallError)
    expect(controller.canLoadMore.value).toBe(true)

    const retry = controller.loadMore(3)
    expect(state.subscriptions[2]?.active).toBe(false)
    expect(state.subscriptions).toHaveLength(4)
    expect(state.subscriptions[3]?.args.paginationOpts).toMatchObject({
      numItems: 3,
      cursor: 'cursor-1',
    })
    expect(controller.error.value).toBeUndefined()
    expect(controller.isLoadingMore.value).toBe(true)

    state.subscriptions[3]?.value(page(['b'], '', true))
    await retry
    expect(controller.data.value?.map((row) => row.id)).toEqual(['a', 'b'])
    expect(controller.isExhausted.value).toBe(true)
    expect(controller.canLoadMore.value).toBe(false)
  })

  it('disposes exactly once and rejects callbacks from retired subscriptions', () => {
    const { controller, state } = makeHarness()
    const subscription = state.subscriptions[0]
    controller.dispose()
    controller.dispose()
    subscription?.value(page(['late'], '', true))

    expect(subscription?.active).toBe(false)
    expect(controller.data.value).toBeUndefined()
  })
})
