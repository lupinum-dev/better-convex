import {
  makeFunctionReference,
  type FunctionReference,
  type PaginationOptions,
  type PaginationResult,
} from 'convex/server'
import { describe, expect, it, vi } from 'vitest'
import { createApp, effectScope } from 'vue'

import { createBetterConvex } from '../../packages/vue/src'
import { createBetterConvexAttachment } from '../../packages/vue/src/embedded'
import {
  createConvexArgsState,
  useConvexPaginatedQueryInternal,
} from '../../packages/vue/src/internal'

type NotesQuery = FunctionReference<
  'query',
  'public',
  { paginationOpts: PaginationOptions },
  PaginationResult<string>
>

interface Subscription {
  active: boolean
  args: { paginationOpts: PaginationOptions }
  emit(value: PaginationResult<string>): void
  fail(error: Error): void
}

function setup(options: { keepPreviousData?: boolean } = {}) {
  const subscriptions: Subscription[] = []
  const client = {
    query: vi.fn() as never,
    mutation: vi.fn() as never,
    action: vi.fn() as never,
    onUpdate: vi.fn(
      (
        _query: unknown,
        args: Subscription['args'],
        onValue: (value: unknown) => void,
        onError?: (error: Error) => void,
      ) => {
        const subscription: Subscription = {
          active: true,
          args,
          emit: onValue,
          fail: (error) => onError?.(error),
        }
        subscriptions.push(subscription)
        return () => {
          subscription.active = false
        }
      },
    ) as never,
  }
  const attachment = createBetterConvexAttachment({
    client,
    anonymousClient: client,
    identity: {
      snapshot: () => ({
        authEnabled: true,
        settled: true,
        identityKey: 'user:alice',
        identityGeneration: 1,
        error: null,
      }),
      waitForInitialSettlement: async () => {},
      subscribe: () => () => {},
    },
  })
  const app = createApp({})
  app.use(createBetterConvex({ attachment }))
  const scope = effectScope()
  const pagination = app.runWithContext(() =>
    scope.run(() =>
      useConvexPaginatedQueryInternal({
        query: makeFunctionReference<'query'>('notes:hydrated') as NotesQuery,
        args: createConvexArgsState({}),
        options: { initialNumItems: 1, keepPreviousData: options.keepPreviousData },
        bridge: { initialPage: { page: ['ssr'], isDone: false, continueCursor: 'ssr-cursor' } },
      }),
    ),
  )!
  const active = () => subscriptions.filter((subscription) => subscription.active)
  return { state: pagination.state, subscriptions, active, scope }
}

describe('paginated query hydration seed', () => {
  it('never presents the SSR page as fresh after a later page hits InvalidCursor', () => {
    const { state, subscriptions, active, scope } = setup()

    // Hydration parity: the first render uses the server page.
    expect(state.status.value).toBe('success')
    expect(state.data.value).toEqual(['ssr'])

    // Newer live data takes ownership of the first page.
    subscriptions[0]!.emit({ page: ['live-a'], isDone: false, continueCursor: 'live-1' })
    void state.loadMore(1)
    const later = active().find(
      (subscription) => subscription.args.paginationOpts.cursor === 'live-1',
    )!
    later.emit({ page: ['live-b'], isDone: false, continueCursor: 'live-2' })
    expect(state.data.value).toEqual(['live-a', 'live-b'])

    later.fail(new Error('Uncaught Error: InvalidCursor: stale'))

    expect(state.data.value).not.toEqual(['ssr'])
    expect(state.data.value).toBeUndefined()
    expect(state.status.value).toBe('pending')
    expect(state.canLoadMore.value).toBe(false)
    const beforeLoadMore = subscriptions.length
    void state.loadMore(1)
    expect(subscriptions).toHaveLength(beforeLoadMore)
    expect(
      subscriptions.some(
        (subscription) => subscription.args.paginationOpts.cursor === 'ssr-cursor',
      ),
    ).toBe(false)

    // The restarted first page owns the list; loadMore continues from it.
    const restarted = active()
    expect(restarted).toHaveLength(1)
    expect(restarted[0]!.args.paginationOpts.cursor).toBeNull()
    restarted[0]!.emit({ page: ['fresh-a'], isDone: false, continueCursor: 'fresh-1' })
    expect(state.status.value).toBe('success')
    expect(state.data.value).toEqual(['fresh-a'])
    void state.loadMore(1)
    const next = subscriptions.at(-1)!
    expect(next.args.paginationOpts).toMatchObject({ cursor: 'fresh-1', numItems: 1 })
    scope.stop()
  })

  it('keeps earlier live results only as stale data with keepPreviousData', () => {
    const { state, subscriptions, active, scope } = setup({ keepPreviousData: true })

    subscriptions[0]!.emit({ page: ['live-a'], isDone: false, continueCursor: 'live-1' })
    void state.loadMore(1)
    const later = active().find(
      (subscription) => subscription.args.paginationOpts.cursor === 'live-1',
    )!
    later.fail(new Error('Uncaught Error: InvalidCursor: stale'))

    expect(state.status.value).toBe('pending')
    expect(state.isStale.value).toBe(true)
    expect(state.data.value).toEqual(['live-a'])
    expect(state.canLoadMore.value).toBe(false)
    scope.stop()
  })

  it('retires the SSR page on restart', () => {
    const { state, scope } = setup()
    expect(state.data.value).toEqual(['ssr'])

    state.restart()

    expect(state.status.value).toBe('pending')
    expect(state.data.value).toBeUndefined()
    expect(state.canLoadMore.value).toBe(false)
    scope.stop()
  })
})
