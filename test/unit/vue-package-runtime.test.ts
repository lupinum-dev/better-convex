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
  const mutation = vi.fn(async (_fn: unknown, args: unknown) => ({ label, args }))
  const action = vi.fn(async (_fn: unknown, args: unknown) => ({ label, args }))
  const subscriptions: Array<{ active: boolean; emit(value: unknown): void }> = []
  const runtime = createBetterConvexAttachment({
    client: {
      query: vi.fn(async () => options?.queryResult ?? label) as never,
      mutation: mutation as never,
      action: action as never,
      onUpdate: vi.fn((_fn, _args, onValue) => {
        const subscription = { active: true, emit: onValue }
        subscriptions.push(subscription)
        return () => {
          subscription.active = false
        }
      }) as never,
    },
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
    runtime,
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
    aliceApp.use(createBetterConvex({ runtime: alice.runtime }))
    bobApp.use(createBetterConvex({ runtime: bob.runtime }))

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
    app.use(createBetterConvex({ runtime: host.runtime }))
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
      ...host.runtime.identity.snapshot(),
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

  it('subscribes synchronously and clears protected query state on identity change', () => {
    const host = attachedRuntime('alice')
    const app = createApp({})
    app.use(createBetterConvex({ runtime: host.runtime }))
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
      ...host.runtime.identity.snapshot(),
      identityKey: 'user:bob',
      identityGeneration: 2,
    })
    expect(query.data.value).toBeNull()
    expect(retired.active).toBe(false)
    expect(host.subscriptions).toHaveLength(2)
    retired.emit([{ id: 'late-alice' }])
    expect(query.data.value).toBeNull()

    host.subscriptions[1]!.emit([{ id: 'bob-result' }])
    expect(query.data.value).toEqual([{ id: 'bob-result' }])
    scope.stop()
    expect(host.subscriptions[1]!.active).toBe(false)
  })

  it('does not re-enter pending for an already-settled subscription after a same-generation notification', () => {
    const host = attachedRuntime('alice')
    const app = createApp({})
    app.use(createBetterConvex({ runtime: host.runtime }))
    const scope = effectScope()
    const query = app.runWithContext(() =>
      scope.run(() =>
        useConvexQuery(makeFunctionReference<'query'>('notes:list'), { owner: 'current' }),
      ),
    )!

    host.subscriptions[0]!.emit([{ id: 'settled' }])
    expect(query.status.value).toBe('success')
    expect(query.pending.value).toBe(false)

    host.emit({ ...host.runtime.identity.snapshot() })

    expect(host.subscriptions).toHaveLength(1)
    expect(query.status.value).toBe('success')
    expect(query.pending.value).toBe(false)
    scope.stop()
  })

  it('distinguishes a valid null query result from an unsettled query', () => {
    const host = attachedRuntime('alice')
    const app = createApp({})
    app.use(createBetterConvex({ runtime: host.runtime }))
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
          {},
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

  it('clear retires pending query work and synchronously clears pending state', () => {
    const host = attachedRuntime('alice')
    const app = createApp({})
    app.use(createBetterConvex({ runtime: host.runtime }))
    const scope = effectScope()
    const query = app.runWithContext(() =>
      scope.run(() => useConvexQuery(makeFunctionReference<'query'>('notes:pending'), {})),
    )!
    const retired = host.subscriptions[0]!

    expect(query.pending.value).toBe(true)
    query.clear()
    expect(query.pending.value).toBe(false)
    expect(query.status.value).toBe('idle')
    expect(retired.active).toBe(false)
    retired.emit('late')
    expect(query.data.value).toBeNull()
    expect(query.status.value).toBe('idle')
    scope.stop()
  })

  it('owns the live pagination cursor chain and retires every page across identity', () => {
    const host = attachedRuntime('alice')
    const app = createApp({})
    app.use(createBetterConvex({ runtime: host.runtime }))
    const scope = effectScope()
    const query = app.runWithContext(() =>
      scope.run(() =>
        useConvexPaginatedQuery(
          makeFunctionReference<'query'>('notes:listPaginated') as FunctionReference<
            'query',
            'public',
            { owner: string; paginationOpts: PaginationOptions },
            { page: Array<{ id: string }>; isDone: boolean; continueCursor: string | null }
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
    expect(query.results.value).toEqual([{ id: 'a' }])
    query.loadMore(1)
    expect(host.subscriptions).toHaveLength(2)
    host.subscriptions[1]!.emit({
      page: [{ id: 'b' }],
      continueCursor: null,
      isDone: true,
    })
    expect(query.results.value).toEqual([{ id: 'a' }, { id: 'b' }])

    host.emit({
      ...host.runtime.identity.snapshot(),
      identityKey: 'user:bob',
      identityGeneration: 2,
    })
    expect(query.results.value).toEqual([])
    expect(host.subscriptions.slice(0, 2).every((subscription) => !subscription.active)).toBe(true)
    expect(host.subscriptions).toHaveLength(3)
    scope.stop()
  })

  it('reports authentication errors as errors and unsettled authentication as loading', () => {
    const host = attachedRuntime('alice')
    const app = createApp({})
    app.use(createBetterConvex({ runtime: host.runtime }))
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
        ),
      ),
    )!

    host.emit({
      ...host.runtime.identity.snapshot(),
      settled: false,
    })
    expect(query.status.value).toBe('loading-first-page')
    expect(query.isLoading.value).toBe(true)

    host.emit({
      ...host.runtime.identity.snapshot(),
      settled: true,
      error: normalizeConvexError(new Error('private authentication detail')),
    })
    expect(query.status.value).toBe('error')
    expect(query.isLoading.value).toBe(false)
    expect(query.error.value).not.toBeNull()
    scope.stop()
  })

  it('accepts a complete first-page seed for SSR adapters without losing its cursor', () => {
    const host = attachedRuntime('alice')
    const app = createApp({})
    app.use(createBetterConvex({ runtime: host.runtime }))
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
          {
            initialNumItems: 1,
            initialPage: {
              page: [{ id: 'ssr' }],
              continueCursor: 'ssr-cursor',
              isDone: false,
            },
          },
        ),
      ),
    )!

    expect(query.results.value).toEqual([{ id: 'ssr' }])
    expect(query.hasNextPage.value).toBe(true)
    query.loadMore(1)
    expect(host.subscriptions[1]).toBeDefined()
    scope.stop()
  })

  it('retires a hydrated first page on a same-identity argument change', () => {
    const host = attachedRuntime('alice', {
      queryResult: {
        page: [{ id: 'bob' }],
        continueCursor: '',
        isDone: true,
      },
    })
    const app = createApp({})
    app.use(createBetterConvex({ runtime: host.runtime }))
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
          {
            initialNumItems: 1,
            initialPage: {
              page: [{ id: 'hydrated-alice' }],
              continueCursor: 'alice-cursor',
              isDone: false,
            },
          },
        ),
      ),
    )!

    expect(query.results.value).toEqual([{ id: 'hydrated-alice' }])
    owner.value = 'bob'

    expect(query.results.value).toEqual([])
    expect(query.status.value).toBe('loading-first-page')
    scope.stop()
  })
})
