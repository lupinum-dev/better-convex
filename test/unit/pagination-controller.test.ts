import type { FunctionReference, PaginationResult } from 'convex/server'
import { describe, expect, it } from 'vitest'

import type { ConvexCallError } from '../../packages/vue/src/errors'
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
    status: 'SplitRecommended' | 'SplitRequired'
  },
): PaginationResult<Row> {
  return {
    page: ids.map((id) => ({ id })),
    continueCursor,
    isDone,
    ...(split
      ? {
          splitCursor: split.cursor,
          pageStatus: split.status,
        }
      : {}),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function makeHarness(options?: { live?: boolean }) {
  const query = mockFnRef<'query'>('notes:list')
  let args: Record<string, unknown> | 'skip' = { owner: 'alice' }
  let argsHash = 'alice'
  let boundaryKey = 'notes:list:alice'
  let tag: QueryIsolationTag = {
    identityKey: 'user:alice',
    identityGeneration: 1,
  }
  let live = options?.live ?? true
  let idle = false
  let boundaryFirstPage: PaginationResult<Row> | null = null
  let boundaryError: ConvexCallError | null = null
  let boundaryRefreshes = 0
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
    subscribe: true,
    keepPreviousData: true,
    getArgs: () => args,
    getArgsHash: () => argsHash,
    getBoundaryKey: () => boundaryKey,
    getIsolationTag: () => tag,
    isIdle: () => idle,
    isLive: () => live,
    getBoundaryFirstPage: () => boundaryFirstPage,
    getBoundaryError: () => boundaryError,
    setBoundaryError: (error) => {
      boundaryError = error
    },
    getClient: () => (live ? client : null),
    fetchPage: async (paginationOptions) => {
      fetches.push(paginationOptions)
      return (await fetchQueue.shift()) ?? null
    },
    refreshBoundary: async () => {
      boundaryRefreshes += 1
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
        return boundaryError
      },
      get boundaryRefreshes() {
        return boundaryRefreshes
      },
      setBoundaryFirstPage(value: PaginationResult<Row> | null) {
        boundaryFirstPage = value
      },
      setLive(value: boolean) {
        live = value
      },
      setIdle(value: boolean) {
        idle = value
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

  it('withholds SplitRequired data and atomically installs bounded replacement pages', () => {
    const { controller, state } = makeHarness()

    state.subscriptions[0]?.value(
      page(['unsafe'], 'page-end', false, {
        cursor: 'split-point',
        status: 'SplitRequired',
      }),
    )

    expect(controller.results.value).toEqual([])
    expect(controller.status.value).toBe('loading-first-page')
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
    expect(controller.results.value).toEqual([])

    state.subscriptions[2]?.value(page(['b'], 'page-end'))
    expect(controller.results.value.map((row) => row.id)).toEqual(['a', 'b'])
    expect(controller.status.value).toBe('ready')
    expect(state.subscriptions[0]?.active).toBe(false)
    expect(state.subscriptions[1]?.active).toBe(true)
    expect(state.subscriptions[2]?.active).toBe(true)

    state.subscriptions[1]?.value(page(['a2'], 'split-point'))
    state.subscriptions[2]?.value(page(['b2'], 'page-end'))
    expect(controller.results.value.map((row) => row.id)).toEqual(['a2', 'b2'])
  })

  it('keeps SplitRecommended data visible until bounded replacements settle', () => {
    const { controller, state } = makeHarness()

    state.subscriptions[0]?.value(
      page(['a', 'b'], 'page-end', false, {
        cursor: 'split-point',
        status: 'SplitRecommended',
      }),
    )

    expect(controller.results.value.map((row) => row.id)).toEqual(['a', 'b'])
    expect(controller.status.value).toBe('ready')
    expect(state.subscriptions).toHaveLength(3)

    state.subscriptions[1]?.value(page(['a'], 'split-point'))
    expect(controller.results.value.map((row) => row.id)).toEqual(['a', 'b'])

    state.subscriptions[2]?.value(page(['b'], 'page-end'))
    expect(controller.results.value.map((row) => row.id)).toEqual(['a', 'b'])
    expect(state.subscriptions[0]?.active).toBe(false)
  })

  it('withholds an incomplete tail while preserving earlier bounded pages', () => {
    const { controller, state } = makeHarness()

    state.subscriptions[0]?.value(page(['a'], 'cursor-1'))
    controller.loadMore(2)
    state.subscriptions[2]?.value(
      page(['unsafe'], 'cursor-2', false, {
        cursor: 'cursor-1.5',
        status: 'SplitRequired',
      }),
    )

    expect(controller.results.value.map((row) => row.id)).toEqual(['a'])
    expect(controller.status.value).toBe('loading-more')
    expect(state.subscriptions).toHaveLength(5)

    state.subscriptions[3]?.value(page(['b'], 'cursor-1.5'))
    expect(controller.results.value.map((row) => row.id)).toEqual(['a'])

    state.subscriptions[4]?.value(page(['c'], 'cursor-2'))
    expect(controller.results.value.map((row) => row.id)).toEqual(['a', 'b', 'c'])
    expect(controller.status.value).toBe('ready')
    expect(state.subscriptions[2]?.active).toBe(false)
  })

  it('bounds every loaded page so realistic live updates preserve page boundaries', () => {
    const { controller, state } = makeHarness()

    state.subscriptions[0]?.value(page(['a', 'b'], 'cursor-1'))
    controller.loadMore(2)

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
    controller.loadMore(2)
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

    expect(controller.results.value.map((row) => row.id)).toEqual(['a', 'aa', 'b', 'c', 'd', 'e'])
    expect(new Set(controller.results.value.map((row) => row.id)).size).toBe(6)
  })

  it('continues through an empty page and binds each live tail callback to its own page', () => {
    const { controller, state } = makeHarness()

    state.subscriptions[0]?.value(page([], 'cursor-1'))
    expect(controller.status.value).toBe('ready')

    controller.loadMore(2)
    controller.loadMore(2)
    expect(state.subscriptions).toHaveLength(3)
    state.subscriptions[2]?.value(page(['b'], 'cursor-2'))
    controller.loadMore(2)
    state.subscriptions[4]?.value(page(['c'], '', true))

    expect(controller.results.value.map((row) => row.id)).toEqual(['b', 'c'])
    expect(controller.pages.value.map((entry) => entry.result?.page[0]?.id)).toEqual(['b', 'c'])
    expect(controller.status.value).toBe('exhausted')
  })

  it('refreshes every loaded page from the new cursor chain and commits atomically', async () => {
    const { controller, state } = makeHarness()
    state.subscriptions[0]?.value(page(['a'], 'old-1'))
    controller.loadMore(2)
    state.subscriptions[2]?.value(page(['b'], 'old-2'))
    controller.loadMore(2)
    state.subscriptions[4]?.value(page(['c'], '', true))

    state.fetchQueue.push(
      Promise.resolve(page(['a2'], 'new-1')),
      Promise.resolve(page(['b2'], 'new-2')),
      Promise.resolve(page(['c2'], '', true)),
    )
    await controller.refresh()

    expect(state.fetches.map((options) => options.cursor)).toEqual([null, 'new-1', 'new-2'])
    expect(controller.results.value.map((row) => row.id)).toEqual(['a2', 'b2', 'c2'])
  })

  it('retires a loaded tail when refresh makes an earlier page terminal', async () => {
    const { controller, state } = makeHarness()
    state.subscriptions[0]?.value(page(['a'], 'old-1'))
    controller.loadMore(2)
    state.subscriptions[2]?.value(page(['b'], '', true))

    state.fetchQueue.push(Promise.resolve(page(['a2'], '', true)))
    await controller.refresh()

    expect(state.fetches.map((options) => options.cursor)).toEqual([null])
    expect(controller.results.value.map((row) => row.id)).toEqual(['a2'])
    expect(controller.pages.value).toEqual([])
    expect(state.subscriptions[2]?.active).toBe(false)
    expect(controller.status.value).toBe('exhausted')
  })

  it('retires only the tail invalidated by a live cursor-boundary change', () => {
    const { controller, state } = makeHarness()
    state.subscriptions[0]?.value(page(['a'], 'cursor-1'))
    controller.loadMore(2)
    state.subscriptions[2]?.value(page(['b'], 'cursor-2'))
    controller.loadMore(2)
    state.subscriptions[4]?.value(page(['c'], '', true))

    state.subscriptions[3]?.value(page(['b2'], 'changed-tail'))
    expect(controller.results.value.map((row) => row.id)).toEqual(['a', 'b2'])
    expect(state.subscriptions[4]?.active).toBe(false)

    state.subscriptions[1]?.value(page(['a2'], 'changed-first'))
    expect(controller.results.value.map((row) => row.id)).toEqual(['a2'])
    expect(state.subscriptions[3]?.active).toBe(false)
    expect(controller.hasNextPage.value).toBe(true)
  })

  it('retires subscriptions and queued refresh results synchronously at an identity boundary', async () => {
    const { controller, state } = makeHarness()
    state.subscriptions[0]?.value(page(['alice'], 'cursor-1'))
    controller.loadMore(2)
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

    expect(controller.results.value).toEqual([])
    expect(state.subscriptions.slice(0, 3).every((subscription) => !subscription.active)).toBe(true)
    expect(state.subscriptions[3]?.active).toBe(true)
    pending.resolve(page(['stale-alice'], '', true))
    await refresh
    expect(controller.results.value).toEqual([])
  })

  it('disposes exactly once and rejects callbacks from retired subscriptions', () => {
    const { controller, state } = makeHarness()
    const subscription = state.subscriptions[0]
    controller.dispose()
    controller.dispose()
    subscription?.value(page(['late'], '', true))

    expect(subscription?.active).toBe(false)
    expect(controller.results.value).toEqual([])
  })
})
