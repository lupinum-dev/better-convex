import {
  makeFunctionReference,
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
  const subscriptions: Array<{ active: boolean; args: unknown; emit(value: unknown): void }> = []
  const client = {
    query: query as never,
    mutation: mutation as never,
    action: action as never,
    onUpdate: vi.fn((_fn, args, onValue) => {
      const subscription = { active: true, args, emit: onValue }
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
  it('keeps deferred queries idle until execute starts their live lifecycle', async () => {
    const host = attachedRuntime('alice')
    const app = createApp({})
    app.use(createBetterConvex({ attachment: host.attachment }))
    const scope = effectScope()
    const query = app.runWithContext(() =>
      scope.run(() =>
        useConvexQuery(makeFunctionReference<'query'>('notes:deferred'), {}, { immediate: false }),
      ),
    )!

    expect(query.status.value).toBe('idle')
    expect(query.pending.value).toBe(false)
    expect(host.subscriptions).toHaveLength(0)

    const execution = query.execute()
    expect(query.status.value).toBe('pending')
    expect(host.subscriptions).toHaveLength(1)
    host.subscriptions[0]!.emit('ready')
    await execution
    expect(query.data.value).toBe('ready')
    expect(query.status.value).toBe('success')
    scope.stop()
  })

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

  it('follows refs passed as individual query argument fields', () => {
    const host = attachedRuntime('alice')
    const app = createApp({})
    app.use(createBetterConvex({ attachment: host.attachment }))
    const scope = effectScope()
    const owner = ref('alice')
    const query = app.runWithContext(() =>
      scope.run(() =>
        useConvexQuery(
          makeFunctionReference<'query'>('notes:list') as FunctionReference<
            'query',
            'public',
            { owner: string },
            string[]
          >,
          { owner },
        ),
      ),
    )!

    expect(query.status.value).toBe('pending')
    expect(host.subscriptions[0]!.args).toEqual({ owner: 'alice' })

    owner.value = 'bob'
    expect(host.subscriptions[0]!.active).toBe(false)
    expect(host.subscriptions[1]!.args).toEqual({ owner: 'bob' })
    scope.stop()
  })

  it('unwraps into one live object with reactive()', async () => {
    const host = attachedRuntime('alice')
    const app = createApp({})
    app.use(createBetterConvex({ attachment: host.attachment }))
    const scope = effectScope()
    const state = app.runWithContext(() =>
      scope.run(() => ({
        query: reactive(useConvexQuery(makeFunctionReference<'query'>('notes:list'), {})),
        create: reactive(
          useConvexMutation(
            makeFunctionReference<'mutation'>('notes:write') as FunctionReference<
              'mutation',
              'public',
              { value: string },
              { label: string; args: unknown }
            >,
          ),
        ),
      })),
    )!

    expect(state.query.pending).toBe(true)
    host.subscriptions[0]!.emit(['first'])
    expect(state.query.pending).toBe(false)
    expect(state.query.data).toEqual(['first'])

    const call = state.create.mutate({ value: 'write' })
    expect(state.create.pending).toBe(true)
    await call
    expect(state.create.status).toBe('success')
    expect(state.create.data).toEqual({ label: 'alice', args: { value: 'write' } })
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

  it('resumes and resets deferred pagination with generation-safe cursors', async () => {
    const host = attachedRuntime('alice')
    const app = createApp({})
    app.use(createBetterConvex({ attachment: host.attachment }))
    const scope = effectScope()
    const query = app.runWithContext(() =>
      scope.run(() =>
        useConvexPaginatedQuery(
          makeFunctionReference<'query'>('notes:resume') as FunctionReference<
            'query',
            'public',
            { paginationOpts: PaginationOptions },
            PaginationResult<string>
          >,
          {},
          { initialNumItems: 2, initialCursor: 'resume-at', immediate: false },
        ),
      ),
    )!

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
    query.reset('resume-elsewhere')
    expect(retired.active).toBe(false)
    expect(host.subscriptions).toHaveLength(2)
    expect(host.subscriptions[1]?.args).toMatchObject({
      paginationOpts: { cursor: 'resume-elsewhere' },
    })
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

    let resolvePending: ((value: { label: string; args: unknown }) => void) | null = null
    host.mutation.mockImplementationOnce(
      () => new Promise<{ label: string; args: unknown }>((resolve) => (resolvePending = resolve)),
    )
    const retired = operation.mutation.mutate({ value: 'late' })
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

  it('exposes the exact settled result and error through readonly callable refs', async () => {
    const host = attachedRuntime('alice')
    const app = createApp({})
    app.use(createBetterConvex({ attachment: host.attachment }))
    const scope = effectScope()
    type Result = { label: string; args: unknown; nested: { id: string } }
    const operation = app.runWithContext(() =>
      scope.run(() => ({
        mutation: useConvexMutation(
          makeFunctionReference<'mutation'>('notes:exact') as FunctionReference<
            'mutation',
            'public',
            { value: string },
            Result
          >,
        ),
        action: useConvexAction(
          makeFunctionReference<'action'>('notes:exactWork') as FunctionReference<
            'action',
            'public',
            { value: string },
            Result
          >,
        ),
      })),
    )!

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
    scope.stop()
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
        useConvexQuery(makeFunctionReference<'query'>('notes:list'), {
          owner: 'current',
        }),
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
        useConvexQuery(makeFunctionReference<'query'>('notes:list'), {
          owner: 'current',
        }),
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
    expect(query.pending.value).toBe(true)

    host.emit({
      ...host.attachment.identity.snapshot(),
      settled: true,
      error: normalizeConvexError(new Error('private authentication detail')),
    })
    expect(query.status.value).toBe('error')
    expect(query.pending.value).toBe(false)
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

    host.subscriptions[0]!.emit({
      page: [{ id: 'private' }],
      continueCursor: '',
      isDone: true,
    })
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
    host.subscriptions[0]!.emit({
      page: [{ id: 'public' }],
      continueCursor: '',
      isDone: true,
    })
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
      'refresh',
      'reset',
      'status',
    ])
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

  it('resolves execute only after pending auth settles and the first value arrives', async () => {
    const host = attachedRuntime('alice')
    host.emit({ ...host.attachment.identity.snapshot(), settled: false })
    const app = createApp({})
    app.use(createBetterConvex({ attachment: host.attachment }))
    const scope = effectScope()
    const query = app.runWithContext(() =>
      scope.run(() =>
        useConvexQuery(
          makeFunctionReference<'query'>('notes:after-auth'),
          {},
          { immediate: false },
        ),
      ),
    )!

    let resolved = false
    const execution = query.execute().then(() => {
      resolved = true
    })
    await Promise.resolve()
    expect(query.status.value).toBe('pending')
    expect(host.subscriptions).toHaveLength(0)
    expect(resolved).toBe(false)

    host.emit({ ...host.attachment.identity.snapshot(), settled: true })
    expect(host.subscriptions).toHaveLength(1)
    await Promise.resolve()
    expect(resolved).toBe(false)

    host.subscriptions[0]!.emit('after-auth')
    await execution
    expect(query.data.value).toBe('after-auth')
    scope.stop()
  })

  it('settles a waiting execute when its scope is disposed', async () => {
    const host = attachedRuntime('alice')
    host.emit({ ...host.attachment.identity.snapshot(), settled: false })
    const app = createApp({})
    app.use(createBetterConvex({ attachment: host.attachment }))
    const scope = effectScope()
    const query = app.runWithContext(() =>
      scope.run(() => useConvexQuery(makeFunctionReference<'query'>('notes:disposed-wait'), {})),
    )!

    const execution = query.execute()
    scope.stop()
    await execution
    host.emit({ ...host.attachment.identity.snapshot(), settled: true })
    expect(host.subscriptions).toHaveLength(0)
  })

  it('accepts a hydration seed only through the typed internal entry', () => {
    const host = attachedRuntime('alice')
    const app = createApp({})
    app.use(createBetterConvex({ attachment: host.attachment }))
    const scope = effectScope()
    const reference = makeFunctionReference<'query'>('notes:seeded')
    const state = app.runWithContext(() =>
      scope.run(() => ({
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
      })),
    )!

    expect(state.seeded.status.value).toBe('success')
    expect(state.seeded.data.value).toBe('ssr')
    expect(state.public.status.value).toBe('pending')
    expect(state.public.data.value).toBeUndefined()
    scope.stop()
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
    host.emit({ ...host.attachment.identity.snapshot(), settled: false })
    const app = createApp({})
    app.use(createBetterConvex({ attachment: host.attachment }))
    const scope = effectScope()
    const pagination = app.runWithContext(() =>
      scope.run(() =>
        useConvexPaginatedQueryInternal({
          query: makeFunctionReference<'query'>('notes:hydratedPages') as FunctionReference<
            'query',
            'public',
            { paginationOpts: PaginationOptions },
            PaginationResult<string>
          >,
          args: createConvexArgsState({}),
          options: { initialNumItems: 1, immediate: false },
          bridge: { initialPage: { page: ['ssr'], isDone: false, continueCursor: 'next' } },
        }),
      ),
    )!

    host.emit({ ...host.attachment.identity.snapshot(), settled: true })
    void pagination.state.execute()

    expect(pagination.state.status.value).toBe('success')
    expect(pagination.state.data.value).toEqual(['ssr'])
    expect(host.subscriptions).toHaveLength(1)
    scope.stop()
  })

  it('holds one loadMore offered by a hydrated first page until the list goes live', async () => {
    const host = attachedRuntime('alice')
    host.emit({ ...host.attachment.identity.snapshot(), settled: false })
    const app = createApp({})
    app.use(createBetterConvex({ attachment: host.attachment }))
    const scope = effectScope()
    const pagination = app.runWithContext(() =>
      scope.run(() =>
        useConvexPaginatedQueryInternal({
          query: makeFunctionReference<'query'>('notes:heldPages') as FunctionReference<
            'query',
            'public',
            { paginationOpts: PaginationOptions },
            PaginationResult<string>
          >,
          args: createConvexArgsState({}),
          options: { initialNumItems: 1, immediate: false },
          bridge: { initialPage: { page: ['ssr'], isDone: false, continueCursor: 'next' } },
        }),
      ),
    )!

    expect(() => pagination.state.loadMore(0)).toThrow('positive safe integer')
    let heldSettled = false
    const held = pagination.state.loadMore(2).then(() => {
      heldSettled = true
    })
    expect(pagination.state.isLoadingMore.value).toBe(true)
    expect(pagination.state.canLoadMore.value).toBe(false)
    await expect(pagination.state.loadMore(5)).resolves.toBeUndefined()
    expect(host.subscriptions).toHaveLength(0)

    // Started while auth still settles: the held page waits with the list.
    void pagination.state.execute()
    expect(host.subscriptions).toHaveLength(0)
    expect(pagination.state.status.value).toBe('success')
    expect(pagination.state.isLoadingMore.value).toBe(true)
    expect(pagination.state.data.value).toEqual(['ssr'])

    host.emit({ ...host.attachment.identity.snapshot(), settled: true })
    expect(host.subscriptions.map((subscription) => subscription.args)).toMatchObject([
      { paginationOpts: { numItems: 1, cursor: null, endCursor: 'next' } },
      { paginationOpts: { numItems: 2, cursor: 'next' } },
    ])
    await Promise.resolve()
    expect(heldSettled).toBe(false)
    host.subscriptions[1]!.emit({ page: ['live'], isDone: true, continueCursor: 'end' })
    await held
    expect(pagination.state.data.value).toEqual(['ssr', 'live'])
    expect(pagination.state.status.value).toBe('success')
    expect(pagination.state.isLoadingMore.value).toBe(false)
    expect(pagination.state.isExhausted.value).toBe(true)
    expect(pagination.state.canLoadMore.value).toBe(false)
    scope.stop()
  })

  it('drops a held loadMore when the deferred list is reset before it starts', async () => {
    const host = attachedRuntime('alice')
    const app = createApp({})
    app.use(createBetterConvex({ attachment: host.attachment }))
    const scope = effectScope()
    const pagination = app.runWithContext(() =>
      scope.run(() =>
        useConvexPaginatedQueryInternal({
          query: makeFunctionReference<'query'>('notes:resetHeldPages') as FunctionReference<
            'query',
            'public',
            { paginationOpts: PaginationOptions },
            PaginationResult<string>
          >,
          args: createConvexArgsState({}),
          options: { initialNumItems: 1, immediate: false },
          bridge: { initialPage: { page: ['ssr'], isDone: false, continueCursor: 'next' } },
        }),
      ),
    )!

    const held = pagination.state.loadMore(2)
    pagination.state.reset()
    await expect(held).resolves.toBeUndefined()
    expect(pagination.state.isLoadingMore.value).toBe(false)
    void pagination.state.execute()

    expect(host.subscriptions.map((subscription) => subscription.args)).toMatchObject([
      { paginationOpts: { numItems: 1, cursor: null } },
    ])
    scope.stop()
  })

  it('applies the plugin defaultQueryAuth to queries that omit auth', () => {
    const host = attachedRuntime('anon')
    host.emit({
      authEnabled: true,
      settled: true,
      identityKey: 'anonymous',
      identityGeneration: 2,
      error: null,
    })
    const app = createApp({})
    app.use(createBetterConvex({ attachment: host.attachment, defaultQueryAuth: 'required' }))
    const scope = effectScope()
    const queries = app.runWithContext(() =>
      scope.run(() => ({
        defaulted: useConvexQuery(makeFunctionReference<'query'>('notes:defaulted'), {}),
        explicit: useConvexQuery(
          makeFunctionReference<'query'>('notes:explicit'),
          {},
          { auth: 'optional' },
        ),
        paginated: useConvexPaginatedQuery(
          makeFunctionReference<'query'>('notes:paginated') as never,
          {},
          { initialNumItems: 1 },
        ),
      })),
    )!

    expect(queries.defaulted.blockedBy.value).toBe('auth')
    expect(queries.paginated.blockedBy.value).toBe('auth')
    expect(queries.explicit.blockedBy.value).toBeNull()
    expect(host.subscriptions).toHaveLength(1)
    scope.stop()
  })

  it.each(['auto', 'OPTIONAL', null, 1])('rejects an invalid defaultQueryAuth: %j', (value) => {
    const host = attachedRuntime('invalid')
    expect(() =>
      createBetterConvex({ attachment: host.attachment, defaultQueryAuth: value as never }),
    ).toThrow(TypeError)
  })
})
