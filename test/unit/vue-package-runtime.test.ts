import {
  makeFunctionReference,
  type DefaultFunctionArgs,
  type FunctionReference,
  type PaginationOptions,
  type PaginationResult,
} from 'convex/server'
import { describe, expect, it, vi } from 'vitest'
import { createApp, effectScope, isProxy, isReadonly, reactive, ref } from 'vue'

import {
  createBetterConvex,
  useConvex,
  useConvexAction,
  useConvexMutation,
  useConvexPaginatedQuery,
  useConvexQuery,
  type ConvexAuthMode,
} from '../../packages/vue/src'
import { createBetterConvexAttachment } from '../../packages/vue/src/embedded'
import { ConvexCallError, normalizeConvexError } from '../../packages/vue/src/errors'
import {
  createConvexArgsState,
  refreshBetterConvexAuth,
  useConvexPaginatedQueryInternal,
  useConvexQueryInternal,
} from '../../packages/vue/src/internal'
import type { ClientIdentitySnapshot } from '../../packages/vue/src/internal/identity-port'
import { useConvexActionInternal } from '../../packages/vue/src/use-callable'

type Paginated<Args, Item> = FunctionReference<
  'query',
  'public',
  Args & { paginationOpts: PaginationOptions },
  PaginationResult<Item>
>
const queryRef = <Args extends DefaultFunctionArgs = Record<string, never>, Result = unknown>(
  name: string,
) => makeFunctionReference<'query'>(name) as FunctionReference<'query', 'public', Args, Result>
const paginatedRef = <Args = object, Item = { id: string }>(name: string) =>
  makeFunctionReference<'query'>(name) as Paginated<Args, Item>
type Written = { label: string; args: unknown }
const mutationRef = <Result = Written>(name: string) =>
  makeFunctionReference<'mutation'>(name) as FunctionReference<
    'mutation',
    'public',
    { value: string },
    Result
  >
const actionRef = <Result = Written>(name: string) =>
  makeFunctionReference<'action'>(name) as FunctionReference<
    'action',
    'public',
    { value: string },
    Result
  >

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
  const action = vi.fn(async (_fn: unknown, args: unknown) => ({
    label,
    args,
  }))
  const subscriptions: Array<{
    active: boolean
    args: { paginationOpts: PaginationOptions }
    emit(value: unknown): void
    fail(error: Error): void
  }> = []
  const client = {
    query: query as never,
    mutation: mutation as never,
    action: action as never,
    onUpdate: vi.fn((_fn, args, onValue, onError?: (error: Error) => void) => {
      const subscription = {
        active: true,
        args,
        emit: onValue,
        fail: (error: Error) => onError?.(error),
      }
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
    active: () => subscriptions.filter((subscription) => subscription.active),
    emit(next: Partial<ClientIdentitySnapshot>) {
      snapshot = { ...snapshot, ...next }
      for (const listener of [...listeners]) listener()
    },
  }
}
type Host = ReturnType<typeof attachedRuntime>

/** Run composables in an app with the plugin installed (or none, for `host: null`). */
function mount<T>(
  host: Host | null,
  factory: () => T,
  plugin?: { defaultQueryAuth?: ConvexAuthMode },
) {
  const app = createApp({})
  if (host) app.use(createBetterConvex({ attachment: host.attachment, ...plugin }))
  const scope = effectScope()
  return { state: app.runWithContext(() => scope.run(factory))!, stop: () => scope.stop() }
}

/** A list hydrated with a server-rendered first page, as the Nuxt bridge seeds it. */
function seededList(host: Host, options: { immediate?: boolean; keepPreviousData?: boolean } = {}) {
  return mount(
    host,
    () =>
      useConvexPaginatedQueryInternal({
        query: paginatedRef<object, string>('notes:seeded'),
        args: createConvexArgsState({}),
        options: { initialNumItems: 1, ...options },
        bridge: { initialPage: { page: ['ssr'], isDone: false, continueCursor: 'next' } },
      }).state,
  )
}

describe('better-convex-vue package runtime', () => {
  it('retains call-time mutation args when an optimistic update is replayed', async () => {
    const host = attachedRuntime('alice')
    type Args = { projectId: string; name: string }
    const optimisticUpdate = vi.fn((_store: unknown, args: Args) => {
      observed.push({ name: args.name, proxy: isProxy(args) })
      return undefined
    })
    const observed: Array<{ name: string; proxy: boolean }> = []
    const { state: mutation, stop } = mount(host, () =>
      useConvexMutation(makeFunctionReference<'mutation', Args>('projects:rename'), {
        optimisticUpdate,
      }),
    )
    let resolvePending!: (value: { label: string; args: unknown }) => void
    host.mutation.mockImplementationOnce(() => new Promise((resolve) => (resolvePending = resolve)))
    const form = reactive({ projectId: 'p1', name: 'Draft' })
    const pending = mutation.mutate(form)
    try {
      await vi.waitFor(() => expect(host.mutation).toHaveBeenCalledTimes(1))
      const [, args, options] = host.mutation.mock.calls[0]!
      const retainedArgs = args as Args
      const update = (options as { optimisticUpdate: typeof optimisticUpdate }).optimisticUpdate
      update({}, retainedArgs)
      form.name = 'Final'
      // Replay with the exact args retained by the client, as on a server transition.
      update({}, retainedArgs)
      expect(retainedArgs).toEqual({ projectId: 'p1', name: 'Draft' })
      expect(isProxy(retainedArgs)).toBe(false)
      expect(observed).toEqual([
        { name: 'Draft', proxy: false },
        { name: 'Draft', proxy: false },
      ])
    } finally {
      resolvePending({ label: 'alice', args: {} })
      await pending
      stop()
    }
  })

  it('passes a call-time action snapshot to the client and DevTools observer', async () => {
    const host = attachedRuntime('alice')
    const startEvent = vi.fn()
    const { state: action, stop } = mount(host, () =>
      useConvexActionInternal(
        makeFunctionReference<'action', { name: string }>('projects:export'),
        { observer: { startEvent, finishEvent: vi.fn(), failEvent: vi.fn() } },
      ),
    )
    const form = reactive({ name: 'Draft' })
    const pending = action.run(form)
    form.name = 'Final'
    try {
      await pending
      const args = host.action.mock.calls[0]![1]
      expect(args).toEqual({ name: 'Draft' })
      expect(isProxy(args)).toBe(false)
      expect(startEvent.mock.calls[0]![0]).toBe(args)
    } finally {
      stop()
    }
  })

  it('keeps deferred queries idle until execute starts their live lifecycle', async () => {
    const host = attachedRuntime('alice')
    const { state: query, stop } = mount(host, () =>
      useConvexQuery(queryRef('notes:deferred'), {}, { immediate: false }),
    )

    expect(query.status.value).toBe('idle')
    expect(query.pending.value).toBe(false)
    expect(query.blockedBy.value).toBe('manual')
    expect(host.subscriptions).toHaveLength(0)

    const execution = query.execute()
    expect(query.status.value).toBe('pending')
    expect(query.blockedBy.value).toBeNull()
    expect(host.subscriptions).toHaveLength(1)
    host.subscriptions[0]!.emit('ready')
    await execution
    expect(query.data.value).toBe('ready')
    expect(query.status.value).toBe('success')
    stop()
  })

  it('reactively enters and leaves the explicit query skip state', () => {
    const host = attachedRuntime('alice')
    const args = ref<{ owner: string } | 'skip'>('skip')
    const { state: query, stop } = mount(host, () =>
      useConvexQuery(queryRef<{ owner: string }, string[]>('notes:list'), args),
    )

    expect(query.status.value).toBe('idle')
    expect(query.pending.value).toBe(false)
    expect(query.blockedBy.value).toBe('skip')
    expect(host.subscriptions).toHaveLength(0)

    args.value = { owner: 'alice' }
    expect(query.status.value).toBe('pending')
    expect(host.subscriptions).toHaveLength(1)
    host.subscriptions[0]!.emit(['ready'])
    expect(query.data.value).toEqual(['ready'])

    args.value = 'skip'
    expect(query.status.value).toBe('idle')
    expect(query.pending.value).toBe(false)
    expect(query.data.value).toBeUndefined()
    expect(query.isStale.value).toBe(false)
    expect(host.subscriptions[0]!.active).toBe(false)
    stop()
  })

  it('follows refs passed as individual query argument fields', () => {
    const host = attachedRuntime('alice')
    const owner = ref('alice')
    const { state: query, stop } = mount(host, () =>
      useConvexQuery(queryRef<{ owner: string }, string[]>('notes:list'), { owner }),
    )

    expect(query.status.value).toBe('pending')
    expect(host.subscriptions[0]!.args).toEqual({ owner: 'alice' })

    owner.value = 'bob'
    expect(host.subscriptions[0]!.active).toBe(false)
    expect(host.subscriptions[1]!.args).toEqual({ owner: 'bob' })
    stop()
  })

  it('unwraps into one live object with reactive()', async () => {
    const host = attachedRuntime('alice')
    const { state, stop } = mount(host, () => ({
      query: reactive(useConvexQuery(queryRef('notes:list'), {})),
      create: reactive(useConvexMutation(mutationRef('notes:write'))),
    }))

    expect(state.query.pending).toBe(true)
    host.subscriptions[0]!.emit(['first'])
    expect(state.query.pending).toBe(false)
    expect(state.query.data).toEqual(['first'])

    const call = state.create.mutate({ value: 'write' })
    expect(state.create.pending).toBe(true)
    await call
    expect(state.create.status).toBe('success')
    expect(state.create.data).toEqual({ label: 'alice', args: { value: 'write' } })
    stop()
  })

  it('reactively enters and leaves the explicit pagination skip state', () => {
    const host = attachedRuntime('alice')
    const args = ref<{ owner: string } | 'skip'>('skip')
    const { state: query, stop } = mount(host, () =>
      useConvexPaginatedQuery(
        paginatedRef<{ owner: string }, string>('notes:listPaginated'),
        args,
        {
          initialNumItems: 1,
        },
      ),
    )

    expect(query.status.value).toBe('idle')
    expect(host.subscriptions).toHaveLength(0)

    args.value = { owner: 'alice' }
    expect(query.status.value).toBe('pending')
    expect(host.subscriptions).toHaveLength(1)

    args.value = 'skip'
    expect(query.status.value).toBe('idle')
    expect(host.subscriptions[0]!.active).toBe(false)
    stop()
  })

  it('resumes and restarts deferred pagination with generation-safe cursors', async () => {
    const host = attachedRuntime('alice')
    const { state: query, stop } = mount(host, () =>
      useConvexPaginatedQuery(
        paginatedRef<object, string>('notes:resume'),
        {},
        { initialNumItems: 2, initialCursor: 'resume-at', immediate: false },
      ),
    )

    expect(query.status.value).toBe('idle')
    expect(query.blockedBy.value).toBe('manual')
    expect(host.subscriptions).toHaveLength(0)
    const execution = query.execute()
    expect(query.blockedBy.value).toBeNull()
    expect(host.subscriptions[0]?.active).toBe(true)
    expect(host.subscriptions[0]?.args).toMatchObject({ paginationOpts: { cursor: 'resume-at' } })
    host.subscriptions[0]!.emit({
      page: ['a'],
      continueCursor: 'after-a',
      isDone: false,
    })
    await execution
    expect(query.canLoadMore.value).toBe(true)

    const retired = host.subscriptions[0]!
    query.restart('resume-elsewhere')
    expect(retired.active).toBe(false)
    expect(host.subscriptions).toHaveLength(2)
    expect(host.subscriptions[1]?.args).toMatchObject({
      paginationOpts: { cursor: 'resume-elsewhere' },
    })
    stop()
  })

  it('allows callable setup during SSR without installing a browser runtime', async () => {
    const { state: operation, stop } = mount(null, () => ({
      mutation: useConvexMutation(mutationRef<string>('notes:write')),
      action: useConvexAction(actionRef<string>('notes:work')),
    }))

    expect(operation.mutation.status.value).toBe('idle')
    expect(operation.action.status.value).toBe('idle')
    await expect(operation.mutation.mutate({ value: 'write' })).rejects.toMatchObject({
      kind: 'unknown',
      code: 'CLIENT_UNAVAILABLE',
      functionName: 'notes:write',
      message:
        '[better-convex-vue] useConvexMutation cannot execute without an installed browser runtime',
    })
    await expect(operation.action.run({ value: 'work' })).rejects.toMatchObject({
      kind: 'unknown',
      code: 'CLIENT_UNAVAILABLE',
      functionName: 'notes:work',
      message:
        '[better-convex-vue] useConvexAction cannot execute without an installed browser runtime',
    })
    stop()
  })

  it('isolates two app roots and keeps captured handles stable', async () => {
    const alice = attachedRuntime('alice')
    const bob = attachedRuntime('bob')
    const aliceHandle = mount(alice, () => useConvex()).state
    const bobHandle = mount(bob, () => useConvex()).state
    const read = queryRef<Record<string, never>, string>('notes:read')
    await expect(aliceHandle.query(read, {})).resolves.toBe('alice')
    await expect(bobHandle.query(read, {})).resolves.toBe('bob')
    expect(aliceHandle).not.toBe(bobHandle)
  })

  it('runs mutation and action through one identity-fenced callable lifecycle', async () => {
    const host = attachedRuntime('alice')
    const { state: operation, stop } = mount(host, () => ({
      mutation: useConvexMutation(mutationRef('notes:write')),
      action: useConvexAction(actionRef('notes:work')),
    }))

    await expect(operation.mutation.mutate({ value: 'write' })).resolves.toEqual({
      label: 'alice',
      args: { value: 'write' },
    })
    await expect(operation.action.run({ value: 'work' })).resolves.toEqual({
      label: 'alice',
      args: { value: 'work' },
    })
    expect(operation.mutation.status.value).toBe('success')
    expect(operation.action.status.value).toBe('success')

    let resolvePending: ((value: Written) => void) | null = null
    host.mutation.mockImplementationOnce(
      () => new Promise<Written>((resolve) => (resolvePending = resolve)),
    )
    const retired = operation.mutation.mutate({ value: 'late' })
    await vi.waitFor(() => expect(resolvePending).not.toBeNull())
    host.emit({ identityKey: 'user:bob', identityGeneration: 2 })
    ;(resolvePending as ((value: Written) => void) | null)?.({
      label: 'alice',
      args: { value: 'late' },
    })
    await expect(retired).rejects.toMatchObject({ code: 'IDENTITY_CHANGED' })
    expect(operation.mutation.status.value).toBe('idle')

    stop()
    expect(host.listeners.size).toBe(1) // plugin identity projection remains; callable listener is gone
  })

  it('exposes the exact settled result and error through readonly callable refs', async () => {
    const host = attachedRuntime('alice')
    type Result = { label: string; args: unknown; nested: { id: string } }
    const { state: operation, stop } = mount(host, () => ({
      mutation: useConvexMutation(mutationRef<Result>('notes:exact')),
      action: useConvexAction(actionRef<Result>('notes:exactWork')),
    }))

    for (const [call, callable, invoke] of [
      [operation.mutation.mutate, operation.mutation, host.mutation],
      [operation.action.run, operation.action, host.action],
    ] as const) {
      const result: Result = { label: 'alice', args: {}, nested: { id: 'n1' } }
      invoke.mockResolvedValueOnce(result)
      await expect(call({ value: 'exact' })).resolves.toBe(result)
      expect(callable.data.value).toBe(result)
      expect(isProxy(callable.data.value)).toBe(false)
      expect(isReadonly(callable.data)).toBe(true)

      invoke.mockRejectedValueOnce(new Error('boom'))
      const rejection: unknown = await call({ value: 'fails' }).catch((error: unknown) => error)
      expect(rejection).toBeInstanceOf(ConvexCallError)
      expect(callable.error.value).toBe(rejection)
      expect(isProxy(callable.error.value)).toBe(false)
      expect(isReadonly(callable.error)).toBe(true)
    }
    stop()
  })

  it('diagnoses a casted Promise-like optimistic updater without throwing after registration', async () => {
    const host = attachedRuntime('alice')
    const thenable = { then: vi.fn() }
    const optimisticUpdate = vi.fn(() => thenable)
    const { state: mutation, stop } = mount(host, () =>
      useConvexMutation(makeFunctionReference<'mutation'>('notes:optimistic'), {
        optimisticUpdate: optimisticUpdate as never,
      }),
    )

    await mutation.mutate({})
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
      stop()
    }
  })

  it('subscribes synchronously and clears protected query state on identity change', () => {
    const host = attachedRuntime('alice')
    const { state: query, stop } = mount(host, () =>
      useConvexQuery(queryRef<{ owner: string }>('notes:list'), { owner: 'current' }),
    )

    expect(host.subscriptions).toHaveLength(1)
    host.subscriptions[0]!.emit([{ id: 'alice-result' }])
    expect(query.data.value).toEqual([{ id: 'alice-result' }])
    const retired = host.subscriptions[0]!

    host.emit({ identityKey: 'user:bob', identityGeneration: 2 })
    expect(query.data.value).toBeUndefined()
    expect(retired.active).toBe(false)
    expect(host.subscriptions).toHaveLength(2)
    retired.emit([{ id: 'late-alice' }])
    expect(query.data.value).toBeUndefined()

    host.subscriptions[1]!.emit([{ id: 'bob-result' }])
    expect(query.data.value).toEqual([{ id: 'bob-result' }])
    stop()
    expect(host.subscriptions[1]!.active).toBe(false)
  })

  it('does not re-enter pending for an already-settled subscription after a same-generation notification', () => {
    const host = attachedRuntime('alice')
    const { state: query, stop } = mount(host, () =>
      useConvexQuery(queryRef<{ owner: string }>('notes:list'), { owner: 'current' }),
    )

    host.subscriptions[0]!.emit([{ id: 'settled' }])
    expect(query.status.value).toBe('success')
    expect(query.pending.value).toBe(false)

    host.emit({})

    expect(host.subscriptions).toHaveLength(1)
    expect(query.status.value).toBe('success')
    expect(query.pending.value).toBe(false)
    stop()
  })

  it('distinguishes a valid null query result from an unsettled query', () => {
    const host = attachedRuntime('alice')
    const { state: query, stop } = mount(host, () =>
      useConvexQuery(queryRef<Record<string, never>, null>('notes:nullable')),
    )

    expect(query.status.value).toBe('pending')
    host.subscriptions[0]!.emit(null)
    expect(query.data.value).toBeNull()
    expect(query.status.value).toBe('success')
    expect(query.pending.value).toBe(false)
    stop()
  })

  it('omits public clear and retires pending query work with its scope', () => {
    const host = attachedRuntime('alice')
    const { state: query, stop } = mount(host, () => useConvexQuery(queryRef('notes:pending'), {}))
    const retired = host.subscriptions[0]!

    expect(query.pending.value).toBe(true)
    expect('clear' in query).toBe(false)
    stop()
    expect(query.pending.value).toBe(false)
    expect(query.status.value).toBe('idle')
    expect(retired.active).toBe(false)
    retired.emit('late')
    expect(query.data.value).toBeUndefined()
    expect(query.status.value).toBe('idle')
  })

  it('owns the live pagination cursor chain and retires every page across identity', () => {
    const host = attachedRuntime('alice')
    const { state: query, stop } = mount(host, () =>
      useConvexPaginatedQuery(
        paginatedRef<{ owner: string }>('notes:listPaginated'),
        { owner: 'current' },
        { initialNumItems: 1 },
      ),
    )

    host.subscriptions[0]!.emit({
      page: [{ id: 'a' }],
      continueCursor: 'cursor-1',
      isDone: false,
    })
    expect(query.data.value).toEqual([{ id: 'a' }])
    expect(query.canLoadMore.value).toBe(true)
    void query.loadMore(1)
    expect(host.subscriptions).toHaveLength(3)
    host.subscriptions[2]!.emit({
      page: [{ id: 'b' }],
      continueCursor: '',
      isDone: true,
    })
    expect(query.data.value).toEqual([{ id: 'a' }, { id: 'b' }])
    expect(query.status.value).toBe('success')
    expect(query.canLoadMore.value).toBe(false)

    host.emit({ identityKey: 'user:bob', identityGeneration: 2 })
    expect(query.data.value).toBeUndefined()
    expect(host.subscriptions.slice(0, 3).every((subscription) => !subscription.active)).toBe(true)
    expect(host.subscriptions).toHaveLength(4)
    expect(host.subscriptions[3]!.active).toBe(true)
    stop()
  })

  it('reports authentication errors as errors and unsettled authentication as loading', () => {
    const host = attachedRuntime('alice')
    const { state: query, stop } = mount(host, () =>
      useConvexPaginatedQuery(paginatedRef('notes:listPaginated'), {}, { initialNumItems: 1 }),
    )

    host.emit({ settled: false })
    expect(query.status.value).toBe('pending')
    expect(query.pending.value).toBe(true)

    host.emit({
      settled: true,
      error: normalizeConvexError(new Error('private authentication detail')),
    })
    expect(query.status.value).toBe('error')
    expect(query.pending.value).toBe(false)
    expect(query.error.value).toBeDefined()
    stop()
  })

  it('retires protected pagination data when authentication enters an error state', () => {
    const host = attachedRuntime('alice')
    const { state: query, stop } = mount(host, () =>
      useConvexPaginatedQuery(
        paginatedRef('notes:privatePaginated'),
        {},
        { initialNumItems: 1, keepPreviousData: true },
      ),
    )

    host.subscriptions[0]!.emit({
      page: [{ id: 'private' }],
      continueCursor: '',
      isDone: true,
    })
    expect(query.data.value).toEqual([{ id: 'private' }])

    host.emit({ error: normalizeConvexError(new Error('private authentication detail')) })

    expect(query.status.value).toBe('error')
    expect(query.data.value).toBeUndefined()
    expect(query.isStale.value).toBe(false)
    expect(host.subscriptions[0]!.active).toBe(false)
    stop()
  })

  it("keeps auth:'none' pagination isolated from an unrelated identity error", () => {
    const host = attachedRuntime('alice')
    const { state: query, stop } = mount(host, () =>
      useConvexPaginatedQuery(
        paginatedRef('notes:publicPaginated'),
        {},
        { initialNumItems: 1, auth: 'none' },
      ),
    )

    host.emit({
      identityGeneration: 2,
      error: normalizeConvexError(new Error('unrelated authentication detail')),
    })

    expect(query.status.value).toBe('pending')
    expect(query.error.value).toBeUndefined()
    expect(host.subscriptions[0]!.active).toBe(true)
    host.subscriptions[0]!.emit({
      page: [{ id: 'public' }],
      continueCursor: '',
      isDone: true,
    })
    expect(query.status.value).toBe('success')
    expect(query.data.value).toEqual([{ id: 'public' }])
    stop()
  })

  it('exposes the official object-form pagination state without adapter mechanics', () => {
    const host = attachedRuntime('alice')
    const { state: query, stop } = mount(host, () =>
      useConvexPaginatedQuery(paginatedRef('notes:ssrPaginated'), {}, { initialNumItems: 1 }),
    )

    expect(Object.keys(query).sort()).toEqual([
      'blockedBy',
      'canLoadMore',
      'data',
      'error',
      'execute',
      'isExhausted',
      'isLoadingMore',
      'isStale',
      'loadMore',
      'pending',
      'restart',
      'status',
    ])
    expect(query.data.value).toBeUndefined()
    expect(query.status.value).toBe('pending')
    stop()
  })

  it('resolves execute only after pending auth settles and the first value arrives', async () => {
    const host = attachedRuntime('alice')
    host.emit({ settled: false })
    const { state: query, stop } = mount(host, () =>
      useConvexQuery(queryRef('notes:after-auth'), {}, { immediate: false }),
    )

    let resolved = false
    const execution = query.execute().then(() => {
      resolved = true
    })
    await Promise.resolve()
    expect(query.status.value).toBe('pending')
    expect(host.subscriptions).toHaveLength(0)
    expect(resolved).toBe(false)

    host.emit({ settled: true })
    expect(host.subscriptions).toHaveLength(1)
    await Promise.resolve()
    expect(resolved).toBe(false)

    host.subscriptions[0]!.emit('after-auth')
    await execution
    expect(query.data.value).toBe('after-auth')
    stop()
  })

  it('settles a waiting execute when its scope is disposed', async () => {
    const host = attachedRuntime('alice')
    host.emit({ settled: false })
    const { state: query, stop } = mount(host, () =>
      useConvexQuery(queryRef('notes:disposed-wait'), {}),
    )

    const execution = query.execute()
    stop()
    await execution
    host.emit({ settled: true })
    expect(host.subscriptions).toHaveLength(0)
  })

  it('accepts a hydration seed only through the typed internal entry', () => {
    const host = attachedRuntime('alice')
    const reference = queryRef('notes:seeded')
    const { state, stop } = mount(host, () => ({
      seeded: useConvexQueryInternal({
        query: reference,
        args: createConvexArgsState({}),
        hydrationSeed: { value: 'ssr' },
      }),
      // A hidden fourth positional slot no longer exists on the public entry.
      public: Reflect.apply(useConvexQuery, undefined, [
        reference,
        {},
        {},
        { value: 'forged' },
      ]) as ReturnType<typeof useConvexQuery>,
    }))

    expect(state.seeded.status.value).toBe('success')
    expect(state.seeded.data.value).toBe('ssr')
    expect(state.public.status.value).toBe('pending')
    expect(state.public.data.value).toBeUndefined()
    stop()
  })

  it('refreshes authentication only through the plugin that owns the browser runtime', async () => {
    const host = attachedRuntime('alice')
    const attached = createBetterConvex({ attachment: host.attachment })
    createApp({}).use(attached)

    await expect(refreshBetterConvexAuth(attached)).rejects.toThrow(
      'only the owning plugin can refresh authentication',
    )
    await expect(
      refreshBetterConvexAuth({ install() {}, attachment: () => host.attachment }),
    ).rejects.toThrow('requires a Better Convex plugin')
  })

  it('keeps a hydrated first page while a deferred query observes auth settlement', async () => {
    const host = attachedRuntime('alice')
    host.emit({ settled: false })
    const { state: list, stop } = seededList(host, { immediate: false })

    host.emit({ settled: true })
    void list.execute()

    expect(list.status.value).toBe('success')
    expect(list.data.value).toEqual(['ssr'])
    expect(host.subscriptions).toHaveLength(1)
    stop()
  })

  it('holds one loadMore offered by a hydrated first page until the list goes live', async () => {
    const host = attachedRuntime('alice')
    host.emit({ settled: false })
    const { state: list, stop } = seededList(host, { immediate: false })

    expect(() => list.loadMore(0)).toThrow('positive safe integer')
    let heldSettled = false
    const held = list.loadMore(2).then(() => {
      heldSettled = true
    })
    expect(list.isLoadingMore.value).toBe(true)
    expect(list.canLoadMore.value).toBe(false)
    await expect(list.loadMore(5)).resolves.toBeUndefined()
    expect(host.subscriptions).toHaveLength(0)

    // Started while auth still settles: the held page waits with the list.
    void list.execute()
    expect(host.subscriptions).toHaveLength(0)
    expect(list.status.value).toBe('success')
    expect(list.isLoadingMore.value).toBe(true)
    expect(list.data.value).toEqual(['ssr'])

    host.emit({ settled: true })
    expect(host.subscriptions.map((subscription) => subscription.args)).toMatchObject([
      { paginationOpts: { numItems: 1, cursor: null, endCursor: 'next' } },
      { paginationOpts: { numItems: 2, cursor: 'next' } },
    ])
    await Promise.resolve()
    expect(heldSettled).toBe(false)
    host.subscriptions[1]!.emit({ page: ['live'], isDone: true, continueCursor: 'end' })
    await held
    expect(list.data.value).toEqual(['ssr', 'live'])
    expect(list.status.value).toBe('success')
    expect(list.isLoadingMore.value).toBe(false)
    expect(list.isExhausted.value).toBe(true)
    expect(list.canLoadMore.value).toBe(false)
    stop()
  })

  it('drops a held loadMore when the deferred list is restarted before it starts', async () => {
    const host = attachedRuntime('alice')
    const { state: list, stop } = seededList(host, { immediate: false })

    const held = list.loadMore(2)
    list.restart()
    await expect(held).resolves.toBeUndefined()
    expect(list.isLoadingMore.value).toBe(false)
    void list.execute()

    expect(host.subscriptions.map((subscription) => subscription.args)).toMatchObject([
      { paginationOpts: { numItems: 1, cursor: null } },
    ])
    stop()
  })

  it('applies the plugin defaultQueryAuth to queries that omit auth', () => {
    const host = attachedRuntime('anon')
    host.emit({ identityKey: 'anonymous', identityGeneration: 2 })
    const { state: queries, stop } = mount(
      host,
      () => ({
        defaulted: useConvexQuery(queryRef('notes:defaulted'), {}),
        explicit: useConvexQuery(queryRef('notes:explicit'), {}, { auth: 'optional' }),
        paginated: useConvexPaginatedQuery(
          paginatedRef('notes:paginated'),
          {},
          {
            initialNumItems: 1,
          },
        ),
      }),
      { defaultQueryAuth: 'required' },
    )

    expect(queries.defaulted.blockedBy.value).toBe('auth')
    expect(queries.paginated.blockedBy.value).toBe('auth')
    expect(queries.explicit.blockedBy.value).toBeNull()
    expect(host.subscriptions).toHaveLength(1)
    stop()
  })

  it.each(['auto', 'OPTIONAL', null, 1])('rejects an invalid defaultQueryAuth: %j', (value) => {
    const host = attachedRuntime('invalid')
    expect(() =>
      createBetterConvex({ attachment: host.attachment, defaultQueryAuth: value as never }),
    ).toThrow(TypeError)
  })
})

describe('paginated query hydration seed', () => {
  it('never presents the SSR page as fresh after a later page hits InvalidCursor', () => {
    const host = attachedRuntime('alice')
    const { state: list, stop } = seededList(host)

    // Hydration parity: the first render uses the server page.
    expect(list.status.value).toBe('success')
    expect(list.data.value).toEqual(['ssr'])

    // Newer live data takes ownership of the first page.
    host.subscriptions[0]!.emit({ page: ['live-a'], isDone: false, continueCursor: 'live-1' })
    void list.loadMore(1)
    const later = host.active().find((s) => s.args.paginationOpts.cursor === 'live-1')!
    later.emit({ page: ['live-b'], isDone: false, continueCursor: 'live-2' })
    expect(list.data.value).toEqual(['live-a', 'live-b'])

    later.fail(new Error('Uncaught Error: InvalidCursor: stale'))

    expect(list.data.value).toBeUndefined()
    expect(list.status.value).toBe('pending')
    expect(list.canLoadMore.value).toBe(false)
    const beforeLoadMore = host.subscriptions.length
    void list.loadMore(1)
    expect(host.subscriptions).toHaveLength(beforeLoadMore)
    expect(host.subscriptions.some((s) => s.args.paginationOpts.cursor === 'next')).toBe(false)

    // The restarted first page owns the list; loadMore continues from it.
    const restarted = host.active()
    expect(restarted).toHaveLength(1)
    expect(restarted[0]!.args.paginationOpts.cursor).toBeNull()
    restarted[0]!.emit({ page: ['fresh-a'], isDone: false, continueCursor: 'fresh-1' })
    expect(list.status.value).toBe('success')
    expect(list.data.value).toEqual(['fresh-a'])
    void list.loadMore(1)
    expect(host.subscriptions.at(-1)!.args.paginationOpts).toMatchObject({
      cursor: 'fresh-1',
      numItems: 1,
    })
    stop()
  })

  it('keeps earlier live results only as stale data with keepPreviousData', () => {
    const host = attachedRuntime('alice')
    const { state: list, stop } = seededList(host, { keepPreviousData: true })

    host.subscriptions[0]!.emit({ page: ['live-a'], isDone: false, continueCursor: 'live-1' })
    void list.loadMore(1)
    host
      .active()
      .find((s) => s.args.paginationOpts.cursor === 'live-1')!
      .fail(new Error('Uncaught Error: InvalidCursor: stale'))

    expect(list.status.value).toBe('pending')
    expect(list.isStale.value).toBe(true)
    expect(list.data.value).toEqual(['live-a'])
    expect(list.canLoadMore.value).toBe(false)
    stop()
  })

  it('retires the SSR page on restart', () => {
    const host = attachedRuntime('alice')
    const { state: list, stop } = seededList(host)
    expect(list.data.value).toEqual(['ssr'])

    list.restart()

    expect(list.status.value).toBe('pending')
    expect(list.data.value).toBeUndefined()
    expect(list.canLoadMore.value).toBe(false)
    stop()
  })
})
