import {
  makeFunctionReference,
  type FunctionReference,
  type PaginationOptions,
  type PaginationResult,
} from 'convex/server'
import { describe, expect, it, vi } from 'vitest'
import { createApp, effectScope, ref } from 'vue'

import {
  createBetterConvex,
  useConvex,
  useConvexAction,
  useConvexMutation,
  useConvexPaginatedQuery,
  useConvexQuery,
} from '../../packages/vue/src'
import { createBetterConvexAttachment } from '../../packages/vue/src/embedded'
import { normalizeConvexError } from '../../packages/vue/src/errors'
import type { ClientIdentitySnapshot } from '../../packages/vue/src/internal/identity-port'

function attachedRuntime(label: string, options?: { queryResult?: unknown }) {
  let snapshot: ClientIdentitySnapshot = {
    authEnabled: true,
    settled: true,
    identityKey: `user:${label}`,
    identityGeneration: 1,
    error: null,
  }
  const listeners = new Set<() => void>()
  const query = vi.fn(async () => options?.queryResult ?? label)
  const mutation = vi.fn(async (_fn: unknown, args: unknown, _options?: unknown) => ({
    label,
    args,
  }))
  const action = vi.fn(async (_fn: unknown, args: unknown) => ({ label, args }))
  const subscriptions: Array<{ active: boolean; emit(value: unknown): void }> = []
  const client = {
    query: query as never,
    mutation: mutation as never,
    action: action as never,
    onUpdate: vi.fn((_fn, _args, onValue) => {
      const subscription = { active: true, emit: onValue }
      subscriptions.push(subscription)
      return () => {
        subscription.active = false
      }
    }) as never,
  }
  const attachment = createBetterConvexAttachment({
    client,
    anonymousClient: client,
    identity: {
      snapshot: () => snapshot,
      waitForInitialSettlement: async () => {},
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
  })
  return {
    attachment,
    query,
    mutation,
    action,
    subscriptions,
    listeners,
    emit(next: ClientIdentitySnapshot) {
      snapshot = next
      for (const listener of [...listeners]) listener()
    },
  }
}

describe('better-convex-vue package runtime', () => {
  it('keeps the newer result when one-shot refreshes resolve in reverse order', async () => {
    const host = attachedRuntime('alice', { queryResult: 'initial' })
    const app = createApp({})
    app.use(createBetterConvex({ attachment: host.attachment }))
    const scope = effectScope()
    const query = app.runWithContext(() =>
      scope.run(() => useConvexQuery(makeFunctionReference<'query'>('notes:refresh-order'), {})),
    )!

    await query.refresh()
    expect(query.data.value).toBe('initial')
    const resolvers: Array<(value: string) => void> = []
    host.query
      .mockImplementationOnce(() => new Promise((resolve) => resolvers.push(resolve)))
      .mockImplementationOnce(() => new Promise((resolve) => resolvers.push(resolve)))

    const older = query.refresh()
    const newer = query.refresh()
    await vi.waitFor(() => expect(resolvers).toHaveLength(2))

    resolvers[1]?.('newer')
    await newer
    expect(query.data.value).toBe('newer')

    resolvers[0]?.('older')
    await older
    expect(query.data.value).toBe('newer')
    scope.stop()
  })

  it('reactively enters and leaves the explicit query skip state', () => {
    const host = attachedRuntime('alice')
    const app = createApp({})
    app.use(createBetterConvex({ attachment: host.attachment }))
    const scope = effectScope()
    const args = ref<{ owner: string } | 'skip'>('skip')
    const query = app.runWithContext(() =>
      scope.run(() =>
        useConvexQuery(
          makeFunctionReference<'query'>('notes:list') as FunctionReference<
            'query',
            'public',
            { owner: string },
            string[]
          >,
          args,
        ),
      ),
    )!

    expect(query.status.value).toBe('idle')
    expect(host.subscriptions).toHaveLength(0)

    args.value = { owner: 'alice' }
    expect(query.status.value).toBe('pending')
    expect(host.subscriptions).toHaveLength(1)

    args.value = 'skip'
    expect(query.status.value).toBe('idle')
    expect(host.subscriptions[0]!.active).toBe(false)
    scope.stop()
  })

  it('reactively enters and leaves the explicit pagination skip state', () => {
    const host = attachedRuntime('alice')
    const app = createApp({})
    app.use(createBetterConvex({ attachment: host.attachment }))
    const scope = effectScope()
    const args = ref<{ owner: string } | 'skip'>('skip')
    const query = app.runWithContext(() =>
      scope.run(() =>
        useConvexPaginatedQuery(
          makeFunctionReference<'query'>('notes:listPaginated') as FunctionReference<
            'query',
            'public',
            { owner: string; paginationOpts: PaginationOptions },
            PaginationResult<string>
          >,
          args,
          { initialNumItems: 1 },
        ),
      ),
    )!

    expect(query.status.value).toBe('idle')
    expect(host.subscriptions).toHaveLength(0)

    args.value = { owner: 'alice' }
    expect(query.status.value).toBe('pending')
    expect(host.subscriptions).toHaveLength(1)

    args.value = 'skip'
    expect(query.status.value).toBe('idle')
    expect(host.subscriptions[0]!.active).toBe(false)
    scope.stop()
  })

  it('allows callable setup during SSR without installing a browser runtime', async () => {
    const app = createApp({})
    const scope = effectScope()
    const operation = app.runWithContext(() =>
      scope.run(() => ({
        mutation: useConvexMutation(
          makeFunctionReference<'mutation'>('notes:write') as FunctionReference<
            'mutation',
            'public',
            { value: string },
            string
          >,
        ),
        action: useConvexAction(
          makeFunctionReference<'action'>('notes:work') as FunctionReference<
            'action',
            'public',
            { value: string },
            string
          >,
        ),
      })),
    )!

    expect(operation.mutation.status.value).toBe('idle')
    expect(operation.action.status.value).toBe('idle')
    await expect(operation.mutation({ value: 'write' })).rejects.toMatchObject({
      kind: 'unknown',
      message:
        '[better-convex-vue] useConvexMutation cannot execute without an installed browser runtime',
    })
    await expect(operation.action({ value: 'work' })).rejects.toMatchObject({
      kind: 'unknown',
      message:
        '[better-convex-vue] useConvexAction cannot execute without an installed browser runtime',
    })
    scope.stop()
  })

  it('isolates two app roots and keeps captured handles stable', async () => {
    const alice = attachedRuntime('alice')
    const bob = attachedRuntime('bob')
    const aliceApp = createApp({})
    const bobApp = createApp({})
    aliceApp.use(createBetterConvex({ attachment: alice.attachment }))
    bobApp.use(createBetterConvex({ attachment: bob.attachment }))

    const aliceHandle = aliceApp.runWithContext(() => useConvex())
    const bobHandle = bobApp.runWithContext(() => useConvex())
    const read = makeFunctionReference<'query'>('notes:read') as FunctionReference<
      'query',
      'public',
      Record<string, never>,
      string
    >
    await expect(aliceHandle.query(read, {})).resolves.toBe('alice')
    await expect(bobHandle.query(read, {})).resolves.toBe('bob')
    expect(aliceHandle).not.toBe(bobHandle)
  })

  it('runs mutation and action through one identity-fenced callable lifecycle', async () => {
    const host = attachedRuntime('alice')
    const app = createApp({})
    app.use(createBetterConvex({ attachment: host.attachment }))
    const scope = effectScope()
    const operation = app.runWithContext(() =>
      scope.run(() => ({
        mutation: useConvexMutation(
          makeFunctionReference<'mutation'>('notes:write') as FunctionReference<
            'mutation',
            'public',
            { value: string },
            { label: string; args: unknown }
          >,
        ),
        action: useConvexAction(
          makeFunctionReference<'action'>('notes:work') as FunctionReference<
            'action',
            'public',
            { value: string },
            { label: string; args: unknown }
          >,
        ),
      })),
    )!

    expect(Object.isFrozen(operation.mutation)).toBe(true)
    expect(Object.isFrozen(operation.action)).toBe(true)
    await expect(operation.mutation({ value: 'write' })).resolves.toEqual({
      label: 'alice',
      args: { value: 'write' },
    })
    await expect(operation.action({ value: 'work' })).resolves.toEqual({
      label: 'alice',
      args: { value: 'work' },
    })
    expect(operation.mutation.status.value).toBe('success')
    expect(operation.action.status.value).toBe('success')

    let resolvePending: ((value: { label: string; args: unknown }) => void) | null = null
    host.mutation.mockImplementationOnce(
      () => new Promise<{ label: string; args: unknown }>((resolve) => (resolvePending = resolve)),
    )
    const retired = operation.mutation({ value: 'late' })
    await vi.waitFor(() => expect(resolvePending).not.toBeNull())
    host.emit({
      ...host.attachment.identity.snapshot(),
      identityKey: 'user:bob',
      identityGeneration: 2,
    })
    ;(resolvePending as ((value: { label: string; args: unknown }) => void) | null)?.({
      label: 'alice',
      args: { value: 'late' },
    })
    await expect(retired).rejects.toMatchObject({ code: 'IDENTITY_CHANGED' })
    expect(operation.mutation.status.value).toBe('idle')

    scope.stop()
    expect(host.listeners.size).toBe(1) // plugin identity projection remains; callable listener is gone
  })

  it('diagnoses a casted Promise-like optimistic updater without throwing after registration', async () => {
    const host = attachedRuntime('alice')
    const app = createApp({})
    app.use(createBetterConvex({ attachment: host.attachment }))
    const scope = effectScope()
    const thenable = { then: vi.fn() }
    const optimisticUpdate = vi.fn(() => thenable)
    const mutation = app.runWithContext(() =>
      scope.run(() =>
        useConvexMutation(makeFunctionReference<'mutation'>('notes:optimistic'), {
          optimisticUpdate: optimisticUpdate as never,
        }),
      ),
    )!

    await mutation({})
    const options = host.mutation.mock.calls[0]?.[2] as
      | { optimisticUpdate?: (store: unknown, args: unknown) => unknown }
      | undefined
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(options?.optimisticUpdate?.({}, {})).toBeUndefined()
      expect(optimisticUpdate).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith(
        '[better-convex-vue] optimisticUpdate returned a Promise-like value. Optimistic updates must be synchronous.',
      )
    } finally {
      warn.mockRestore()
      scope.stop()
    }
  })

  it('subscribes synchronously and clears protected query state on identity change', () => {
    const host = attachedRuntime('alice')
    const app = createApp({})
    app.use(createBetterConvex({ attachment: host.attachment }))
    const scope = effectScope()
    const query = app.runWithContext(() =>
      scope.run(() =>
        useConvexQuery(makeFunctionReference<'query'>('notes:list'), { owner: 'current' }),
      ),
    )!

    expect(host.subscriptions).toHaveLength(1)
    host.subscriptions[0]!.emit([{ id: 'alice-result' }])
    expect(query.data.value).toEqual([{ id: 'alice-result' }])
    const retired = host.subscriptions[0]!

    host.emit({
      ...host.attachment.identity.snapshot(),
      identityKey: 'user:bob',
      identityGeneration: 2,
    })
    expect(query.data.value).toBeUndefined()
    expect(retired.active).toBe(false)
    expect(host.subscriptions).toHaveLength(2)
    retired.emit([{ id: 'late-alice' }])
    expect(query.data.value).toBeUndefined()

    host.subscriptions[1]!.emit([{ id: 'bob-result' }])
    expect(query.data.value).toEqual([{ id: 'bob-result' }])
    scope.stop()
    expect(host.subscriptions[1]!.active).toBe(false)
  })

  it('does not re-enter pending for an already-settled subscription after a same-generation notification', () => {
    const host = attachedRuntime('alice')
    const app = createApp({})
    app.use(createBetterConvex({ attachment: host.attachment }))
    const scope = effectScope()
    const query = app.runWithContext(() =>
      scope.run(() =>
        useConvexQuery(makeFunctionReference<'query'>('notes:list'), { owner: 'current' }),
      ),
    )!

    host.subscriptions[0]!.emit([{ id: 'settled' }])
    expect(query.status.value).toBe('success')
    expect(query.pending.value).toBe(false)

    host.emit({ ...host.attachment.identity.snapshot() })

    expect(host.subscriptions).toHaveLength(1)
    expect(query.status.value).toBe('success')
    expect(query.pending.value).toBe(false)
    scope.stop()
  })

  it('distinguishes a valid null query result from an unsettled query', () => {
    const host = attachedRuntime('alice')
    const app = createApp({})
    app.use(createBetterConvex({ attachment: host.attachment }))
    const scope = effectScope()
    const query = app.runWithContext(() =>
      scope.run(() =>
        useConvexQuery(
          makeFunctionReference<'query'>('notes:nullable') as FunctionReference<
            'query',
            'public',
            Record<string, never>,
            null
          >,
        ),
      ),
    )!

    expect(query.status.value).toBe('pending')
    host.subscriptions[0]!.emit(null)
    expect(query.data.value).toBeNull()
    expect(query.status.value).toBe('success')
    expect(query.pending.value).toBe(false)
    scope.stop()
  })

  it('omits public clear and retires pending query work with its scope', () => {
    const host = attachedRuntime('alice')
    const app = createApp({})
    app.use(createBetterConvex({ attachment: host.attachment }))
    const scope = effectScope()
    const query = app.runWithContext(() =>
      scope.run(() => useConvexQuery(makeFunctionReference<'query'>('notes:pending'), {})),
    )!
    const retired = host.subscriptions[0]!

    expect(query.pending.value).toBe(true)
    expect('clear' in query).toBe(false)
    scope.stop()
    expect(query.pending.value).toBe(false)
    expect(query.status.value).toBe('idle')
    expect(retired.active).toBe(false)
    retired.emit('late')
    expect(query.data.value).toBeUndefined()
    expect(query.status.value).toBe('idle')
  })

  it('owns the live pagination cursor chain and retires every page across identity', () => {
    const host = attachedRuntime('alice')
    const app = createApp({})
    app.use(createBetterConvex({ attachment: host.attachment }))
    const scope = effectScope()
    const query = app.runWithContext(() =>
      scope.run(() =>
        useConvexPaginatedQuery(
          makeFunctionReference<'query'>('notes:listPaginated') as FunctionReference<
            'query',
            'public',
            { owner: string; paginationOpts: PaginationOptions },
            PaginationResult<{ id: string }>
          >,
          { owner: 'current' },
          { initialNumItems: 1 },
        ),
      ),
    )!

    host.subscriptions[0]!.emit({
      page: [{ id: 'a' }],
      continueCursor: 'cursor-1',
      isDone: false,
    })
    expect(query.data.value).toEqual([{ id: 'a' }])
    expect(query.canLoadMore.value).toBe(true)
    query.loadMore(1)
    expect(host.subscriptions).toHaveLength(3)
    host.subscriptions[2]!.emit({
      page: [{ id: 'b' }],
      continueCursor: '',
      isDone: true,
    })
    expect(query.data.value).toEqual([{ id: 'a' }, { id: 'b' }])
    expect(query.status.value).toBe('success')
    expect(query.canLoadMore.value).toBe(false)

    host.emit({
      ...host.attachment.identity.snapshot(),
      identityKey: 'user:bob',
      identityGeneration: 2,
    })
    expect(query.data.value).toBeUndefined()
    expect(host.subscriptions.slice(0, 3).every((subscription) => !subscription.active)).toBe(true)
    expect(host.subscriptions).toHaveLength(4)
    expect(host.subscriptions[3]!.active).toBe(true)
    scope.stop()
  })

  it('reports authentication errors as errors and unsettled authentication as loading', () => {
    const host = attachedRuntime('alice')
    const app = createApp({})
    app.use(createBetterConvex({ attachment: host.attachment }))
    const scope = effectScope()
    const query = app.runWithContext(() =>
      scope.run(() =>
        useConvexPaginatedQuery(
          makeFunctionReference<'query'>('notes:listPaginated') as FunctionReference<
            'query',
            'public',
            { paginationOpts: PaginationOptions },
            PaginationResult<{ id: string }>
          >,
          {},
          { initialNumItems: 1 },
        ),
      ),
    )!

    host.emit({
      ...host.attachment.identity.snapshot(),
      settled: false,
    })
    expect(query.status.value).toBe('pending')
    expect(query.isLoading.value).toBe(true)

    host.emit({
      ...host.attachment.identity.snapshot(),
      settled: true,
      error: normalizeConvexError(new Error('private authentication detail')),
    })
    expect(query.status.value).toBe('error')
    expect(query.isLoading.value).toBe(false)
    expect(query.error.value).toBeDefined()
    scope.stop()
  })

  it('retires protected pagination data when authentication enters an error state', () => {
    const host = attachedRuntime('alice')
    const app = createApp({})
    app.use(createBetterConvex({ attachment: host.attachment }))
    const scope = effectScope()
    const query = app.runWithContext(() =>
      scope.run(() =>
        useConvexPaginatedQuery(
          makeFunctionReference<'query'>('notes:privatePaginated') as FunctionReference<
            'query',
            'public',
            { paginationOpts: PaginationOptions },
            PaginationResult<{ id: string }>
          >,
          {},
          { initialNumItems: 1, keepPreviousData: true },
        ),
      ),
    )!

    host.subscriptions[0]!.emit({ page: [{ id: 'private' }], continueCursor: '', isDone: true })
    expect(query.data.value).toEqual([{ id: 'private' }])

    host.emit({
      ...host.attachment.identity.snapshot(),
      error: normalizeConvexError(new Error('private authentication detail')),
    })

    expect(query.status.value).toBe('error')
    expect(query.data.value).toBeUndefined()
    expect(query.isStale.value).toBe(false)
    expect(host.subscriptions[0]!.active).toBe(false)
    scope.stop()
  })

  it("keeps auth:'none' pagination isolated from an unrelated identity error", () => {
    const host = attachedRuntime('alice')
    const app = createApp({})
    app.use(createBetterConvex({ attachment: host.attachment }))
    const scope = effectScope()
    const query = app.runWithContext(() =>
      scope.run(() =>
        useConvexPaginatedQuery(
          makeFunctionReference<'query'>('notes:publicPaginated') as FunctionReference<
            'query',
            'public',
            { paginationOpts: PaginationOptions },
            PaginationResult<{ id: string }>
          >,
          {},
          { initialNumItems: 1, auth: 'none' },
        ),
      ),
    )!

    host.emit({
      ...host.attachment.identity.snapshot(),
      identityGeneration: 2,
      error: normalizeConvexError(new Error('unrelated authentication detail')),
    })

    expect(query.status.value).toBe('pending')
    expect(query.error.value).toBeUndefined()
    expect(host.subscriptions[0]!.active).toBe(true)
    host.subscriptions[0]!.emit({ page: [{ id: 'public' }], continueCursor: '', isDone: true })
    expect(query.status.value).toBe('success')
    expect(query.data.value).toEqual([{ id: 'public' }])
    scope.stop()
  })

  it('exposes the official object-form pagination state without adapter mechanics', () => {
    const host = attachedRuntime('alice')
    const app = createApp({})
    app.use(createBetterConvex({ attachment: host.attachment }))
    const scope = effectScope()
    const query = app.runWithContext(() =>
      scope.run(() =>
        useConvexPaginatedQuery(
          makeFunctionReference<'query'>('notes:ssrPaginated') as FunctionReference<
            'query',
            'public',
            { paginationOpts: PaginationOptions },
            PaginationResult<{ id: string }>
          >,
          {},
          { initialNumItems: 1 },
        ),
      ),
    )!

    expect(Object.keys(query).sort()).toEqual([
      'canLoadMore',
      'data',
      'error',
      'isLoading',
      'isStale',
      'loadMore',
      'refresh',
      'status',
    ])
    expect(Object.isFrozen(query)).toBe(true)
    expect(query.data.value).toBeUndefined()
    expect(query.status.value).toBe('pending')
    scope.stop()
  })

  it('keeps prior argument data stale until the next first page settles', () => {
    const host = attachedRuntime('alice')
    const app = createApp({})
    app.use(createBetterConvex({ attachment: host.attachment }))
    const scope = effectScope()
    const owner = ref('alice')
    const query = app.runWithContext(() =>
      scope.run(() =>
        useConvexPaginatedQuery(
          makeFunctionReference<'query'>('notes:ssrPaginatedByOwner') as FunctionReference<
            'query',
            'public',
            { owner: string; paginationOpts: PaginationOptions },
            PaginationResult<{ id: string }>
          >,
          () => ({ owner: owner.value }),
          { initialNumItems: 1, keepPreviousData: true },
        ),
      ),
    )!

    host.subscriptions[0]!.emit({
      page: [{ id: 'alice' }],
      continueCursor: 'alice-cursor',
      isDone: false,
    })
    expect(query.data.value).toEqual([{ id: 'alice' }])
    owner.value = 'bob'

    expect(query.data.value).toEqual([{ id: 'alice' }])
    expect(query.isStale.value).toBe(true)
    expect(query.status.value).toBe('pending')
    host.subscriptions[1]!.emit({
      page: [{ id: 'bob' }],
      continueCursor: '',
      isDone: true,
    })
    expect(query.data.value).toEqual([{ id: 'bob' }])
    expect(query.isStale.value).toBe(false)
    expect(query.status.value).toBe('success')
    scope.stop()
  })
})
