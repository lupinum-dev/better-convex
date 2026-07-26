import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server'
import { describe, expect, it, vi } from 'vitest'
import { reactive, ref } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import { useState } from '#imports'

import {
  ANONYMOUS_IDENTITY,
  LOADING_IDENTITY,
  toAuthenticatedIdentity,
  type AuthIdentity,
} from '../../src/runtime/auth/auth-identity'
import {
  createConvexQueryState,
  useConvexQuery,
  type ConvexQueryArgs,
  type UseConvexQueryOptions,
} from '../../src/runtime/composables/useConvexQuery'
import { ConvexCallError } from '../../src/runtime/errors'
import { withAuthDimension } from '../../src/runtime/utils/convex-cache'
import { createConvexQueryKey } from '../../src/runtime/utils/convex-shared'
import { MockConvexClient, mockFnRef } from '../helpers/mock-convex-client'
import { captureInNuxt } from '../helpers/nuxt-runtime-harness'
import { waitFor } from '../helpers/wait-for'

function useConvexQueryState<
  Query extends FunctionReference<'query'>,
  Args extends ConvexQueryArgs<FunctionArgs<Query>> = FunctionArgs<Query>,
  DataT = FunctionReturnType<Query>,
>(
  query: Query,
  args?: MaybeRefOrGetter<Args>,
  options?: UseConvexQueryOptions<FunctionReturnType<Query>, DataT>,
) {
  return createConvexQueryState<Query, Args, DataT>(query, args, { auth: 'none', ...options }, true)
    .resultData
}

describe('useConvexQuery composables (Nuxt runtime)', () => {
  it('mounts immediately from an SSR error and keeps it until client reconciliation settles', async () => {
    const convex = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:list:ssr-error-hydration')
    const key = withAuthDimension(createConvexQueryKey(query, {}), 'optional', 'anonymous')
    const ssrError = new ConvexCallError({
      kind: 'transport',
      message: 'Sanitized SSR transport failure',
      status: 500,
    })
    let resolveClient!: (value: unknown) => void
    convex.setQueryHandler(
      'notes:list:ssr-error-hydration',
      () =>
        new Promise((resolve) => {
          resolveClient = resolve
        }),
    )

    const { result, flush } = await captureInNuxt(
      () => {
        useState<Record<string, ConvexCallError | null>>('convex:query-errors').value = {
          [key]: ssrError,
        }
        return useConvexQuery(query, {}, { subscribe: false })
      },
      { convex, convexConfig: { auth: false }, payloadData: { [key]: null } },
    )

    const hydrated = await result
    expect(hydrated.error.value).toBe(ssrError)
    expect(hydrated.pending.value).toBe(false)
    expect(hydrated.status.value).toBe('error')

    resolveClient({ ok: true })
    await flush()
    await waitFor(() => hydrated.status.value === 'success')
    expect(hydrated.error.value).toBeNull()
    expect(hydrated.data.value).toEqual({ ok: true })
  })

  it('surfaces a live query failure as a ConvexCallError through composable-owned error state', async () => {
    const convex = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:list:live-failure')

    const { result } = await captureInNuxt(() => useConvexQueryState(query, {}), { convex })

    await waitFor(() => convex.calls.onUpdate.length > 0)
    // A genuine query failure (not a reconnectable disconnect) is normalized once
    // at the boundary and stored in the library-owned error state .
    convex.emitQueryError(query, {}, new Error('query exploded'))
    await waitFor(() => result.error.value != null)

    expect(result.error.value).toBeInstanceOf(ConvexCallError)
    expect(result.error.value?.kind).toBe('unknown')
    expect(result.error.value?.message).toBe('Unknown Convex error')
    expect(result.status.value).toBe('error')
  })

  it('useConvexQuery blocks until first value arrives', async () => {
    const convex = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:list:blocking-default')

    const { result } = await captureInNuxt(() => useConvexQuery(query, {}, { auth: 'none' }), {
      convex,
    })

    let settled = false
    const blockingResult = result.then((value) => {
      settled = true
      return value
    })

    await waitFor(() => convex.calls.onUpdate.length > 0)
    await Promise.resolve()
    expect(settled).toBe(false)

    convex.emitQueryResult(query, {}, [{ _id: 'n1', title: 'Loaded' }])
    const resolved = await blockingResult

    expect(resolved.status.value).toBe('success')
    expect(resolved.pending.value).toBe(false)
    expect(resolved.data.value).toEqual([{ _id: 'n1', title: 'Loaded' }])
  })

  it('settles an awaited live query when its scope is disposed before the first value', async () => {
    const convex = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:list:disposed-before-first-value')

    const { result, wrapper } = await captureInNuxt(
      () => useConvexQuery(query, {}, { auth: 'none' }),
      {
        convex,
        convexConfig: { defaults: { waitTimeoutMs: 0 } },
      },
    )

    let settled = false
    const completion = result.then(() => {
      settled = true
    })

    await waitFor(() => convex.activeListenerCount(query, {}) === 1)
    wrapper.unmount()

    await waitFor(() => settled, { timeoutMs: 250 })
    await completion
    expect(convex.activeListenerCount(query, {})).toBe(0)
  })

  it('returns idle + pending=false immediately for skipped args', async () => {
    const query = mockFnRef<'query'>('notes:list:disabled-static')
    const { result } = await captureInNuxt(() => useConvexQueryState(query, 'skip'), {
      convex: new MockConvexClient(),
    })

    expect(result.data.value).toBeNull()
    expect(result.pending.value).toBe(false)
    expect(result.status.value).toBe('idle')
  })

  it('treats "skip" args as idle and does not start subscriptions', async () => {
    const convex = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:list:skip-static')

    const { result } = await captureInNuxt(() => useConvexQueryState(query, 'skip'), {
      convex,
    })

    expect(result.data.value).toBeNull()
    expect(result.pending.value).toBe(false)
    expect(result.isStale.value).toBe(false)
    expect(result.status.value).toBe('idle')
    expect(convex.calls.onUpdate.length).toBe(0)
  })

  it('exposes refresh/clear but omits execute on query return shape', async () => {
    const query = mockFnRef<'query'>('notes:list:return-shape')
    const { result } = await captureInNuxt(() => useConvexQueryState(query, null), {
      convex: new MockConvexClient(),
    })

    expect(typeof result.refresh).toBe('function')
    expect(typeof result.clear).toBe('function')
    expect('execute' in (result as unknown as Record<string, unknown>)).toBe(false)
  })

  it('does not fetch client HTTP queries while private auth is pending', async () => {
    const query = mockFnRef<'query'>('notes:list:auth-pending-http')
    const fetchMock = vi.fn(async () => ({ value: [{ _id: 'n1' }] }))
    vi.stubGlobal('$fetch', fetchMock)

    const { result, flush } = await captureInNuxt(
      () => {
        const authPending = useState<boolean>('convex:pending')
        const identity = useState<AuthIdentity>('convex:identity')
        authPending.value = true
        identity.value = LOADING_IDENTITY
        const queryResult = useConvexQueryState(query, {}, { auth: 'required', subscribe: false })
        return { authPending, identity, queryResult }
      },
      {
        convex: new MockConvexClient(),
        convexConfig: { auth: {}, defaults: {} },
      },
    )

    expect(result.queryResult.pending.value).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()

    result.identity.value = ANONYMOUS_IDENTITY
    result.authPending.value = false
    await flush()
  })

  it('respects skip args and does not start subscriptions', async () => {
    const convex = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:list:skip-static')

    const { result } = await captureInNuxt(() => useConvexQueryState(query, 'skip'), { convex })

    expect(result.status.value).toBe('idle')
    expect(result.pending.value).toBe(false)
    expect(convex.calls.onUpdate.length).toBe(0)
  })

  it('releases an active subscription when args switch to "skip"', async () => {
    const convex = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:list:skip-reactive')

    const { result, flush } = await captureInNuxt(
      () => {
        const args = ref<ConvexQueryArgs<Record<string, never>>>({})
        const queryResult = useConvexQueryState(query, args)
        return { args, queryResult }
      },
      { convex },
    )

    await waitFor(() => convex.activeListenerCount(query, {}) >= 1)
    convex.emitQueryResult(query, {}, { ready: true })
    await waitFor(() => result.queryResult.data.value?.ready === true)
    await waitFor(() => convex.activeListenerCount(query, {}) === 1)

    result.args.value = 'skip'
    await flush()

    await waitFor(() => convex.activeListenerCount(query, {}) === 0)
    expect(result.queryResult.data.value).toBeNull()
    expect(result.queryResult.status.value).toBe('idle')
    expect(result.queryResult.pending.value).toBe(false)
    expect(result.queryResult.isStale.value).toBe(false)
  })

  it('waits for auth bootstrap before starting live subscriptions', async () => {
    const convex = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:list:auth-gated-live')

    const { result, flush } = await captureInNuxt(
      () => {
        const authPending = useState<boolean>('convex:pending')
        const identity = useState<AuthIdentity>('convex:identity')
        authPending.value = true
        identity.value = LOADING_IDENTITY
        const queryResult = useConvexQueryState(query, {}, { auth: 'required' })
        return { authPending, identity, queryResult }
      },
      {
        convex,
        convexConfig: { auth: {}, defaults: {} },
      },
    )

    expect(result.queryResult.pending.value).toBe(true)
    expect(convex.calls.onUpdate.length).toBe(0)

    // A settled identity requires a resolved user , not just a token.
    result.identity.value = toAuthenticatedIdentity('ready.jwt.token', {
      id: 'u1',
    })
    result.authPending.value = false
    await flush()

    await waitFor(() => convex.calls.onUpdate.length > 0)
  })

  it('does not wait for auth bootstrap when global query auth is none', async () => {
    const convex = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:list:auth-none-live')

    await captureInNuxt(
      () => {
        const authPending = useState<boolean>('convex:pending')
        const identity = useState<AuthIdentity>('convex:identity')
        authPending.value = true
        identity.value = LOADING_IDENTITY
        return useConvexQueryState(query, {})
      },
      {
        convex,
        convexConfig: { auth: {}, defaults: {} },
      },
    )

    await waitFor(() => convex.calls.onUpdate.length > 0)
  })

  it('uses initialData while loading and transitions to success on first update', async () => {
    const convex = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:list:initial-data-loading')

    const { result } = await captureInNuxt(
      () =>
        useConvexQueryState(
          query,
          {},
          {
            initialData: [{ _id: 'initial', title: 'Loading placeholder' }],
          },
        ),
      { convex },
    )

    expect(result.data.value).toEqual([{ _id: 'initial', title: 'Loading placeholder' }])
    expect(result.pending.value).toBe(true)

    await waitFor(() => convex.calls.onUpdate.length > 0)
    convex.emitQueryResultByPath('notes:list:initial-data-loading', [
      { _id: 'n1', title: 'Loaded' },
    ])
    await waitFor(() => result.pending.value === false)

    expect(result.status.value).toBe('success')
    expect(result.data.value).toEqual([{ _id: 'n1', title: 'Loaded' }])
  })

  it('re-subscribes when nested reactive args mutate deeply', async () => {
    const convex = new MockConvexClient()
    const query = mockFnRef<'query'>('search:notes:deep-args')

    const { result, flush } = await captureInNuxt(
      () => {
        const args = ref({ filter: { tag: 'alpha' } })
        const queryResult = useConvexQueryState(query, args)
        return { args, queryResult }
      },
      { convex },
    )

    await waitFor(() => convex.calls.onUpdate.length > 0)

    convex.emitQueryResult(query, { filter: { tag: 'alpha' } }, { tag: 'alpha', hits: 2 })
    await waitFor(() => result.queryResult.data.value?.tag === 'alpha')

    result.args.value.filter.tag = 'beta'
    await flush()

    await waitFor(() =>
      convex.calls.onUpdate.some((call) => {
        const args = call.args as { filter?: { tag?: string } }
        return args.filter?.tag === 'beta'
      }),
    )

    convex.emitQueryResult(query, { filter: { tag: 'beta' } }, { tag: 'beta', hits: 5 })
    await waitFor(() => result.queryResult.data.value?.tag === 'beta')
  })

  it('re-subscribes when args are passed as a getter function', async () => {
    const convex = new MockConvexClient()
    const query = mockFnRef<'query'>('search:notes:getter-args')

    const { result, flush } = await captureInNuxt(
      () => {
        const tag = ref('alpha')
        const queryResult = useConvexQueryState(query, () => ({
          filter: { tag: tag.value },
        }))
        return { tag, queryResult }
      },
      { convex },
    )

    await waitFor(() => convex.calls.onUpdate.length > 0)

    convex.emitQueryResult(query, { filter: { tag: 'alpha' } }, { tag: 'alpha', hits: 2 })
    await waitFor(() => result.queryResult.data.value?.tag === 'alpha')

    result.tag.value = 'beta'
    await flush()

    await waitFor(() =>
      convex.calls.onUpdate.some((call) => {
        const args = call.args as { filter?: { tag?: string } }
        return args.filter?.tag === 'beta'
      }),
    )

    convex.emitQueryResult(query, { filter: { tag: 'beta' } }, { tag: 'beta', hits: 4 })
    await waitFor(() => result.queryResult.data.value?.tag === 'beta')
  })

  it('deep-unrefs refs inside plain args objects', async () => {
    const convex = new MockConvexClient()
    const query = mockFnRef<'query'>('search:notes:deep-unref')

    const { result, flush } = await captureInNuxt(
      () => {
        const tag = ref('alpha')
        const queryResult = useConvexQueryState(query, {
          filter: {
            tag,
          },
        })
        return { tag, queryResult }
      },
      { convex },
    )

    await waitFor(() => convex.calls.onUpdate.length > 0)
    convex.emitQueryResult(query, { filter: { tag: 'alpha' } }, { tag: 'alpha', hits: 1 })
    await waitFor(() => result.queryResult.data.value?.tag === 'alpha')

    result.tag.value = 'beta'
    await flush()

    await waitFor(() =>
      convex.calls.onUpdate.some((call) => {
        const args = call.args as { filter?: { tag?: string } }
        return args.filter?.tag === 'beta'
      }),
    )
  })

  it('preserves byte arguments at the client query boundary', async () => {
    const convex = new MockConvexClient()
    const query = mockFnRef<'query'>('files:by-digest')
    const digest = new Uint8Array([0, 127, 255]).buffer

    const { flush, wrapper } = await captureInNuxt(() => useConvexQueryState(query, { digest }), {
      convex,
    })

    await flush()
    expect(convex.calls.onUpdate).toHaveLength(1)
    expect(convex.calls.onUpdate[0]?.args).toEqual({ digest })
    expect((convex.calls.onUpdate[0]?.args as { digest: ArrayBuffer }).digest).toBe(digest)
    wrapper.unmount()
  })

  it('hydrates byte arguments from their byte-specific Nuxt key', async () => {
    const convex = new MockConvexClient()
    const query = mockFnRef<'query'>('files:hydrated-by-digest')
    const digest = new Uint8Array([1, 2, 3]).buffer
    const otherDigest = new Uint8Array([1, 2, 4]).buffer
    const key = withAuthDimension(createConvexQueryKey(query, { digest }), 'none', 'anonymous')
    const otherKey = withAuthDimension(
      createConvexQueryKey(query, { digest: otherDigest }),
      'none',
      'anonymous',
    )

    expect(otherKey).not.toBe(key)
    const { result, wrapper } = await captureInNuxt(
      () => useConvexQueryState(query, { digest }, { auth: 'none' }),
      {
        convex,
        payloadData: {
          [key]: { value: { source: 'matching-bytes' } },
          [otherKey]: { value: { source: 'other-bytes' } },
        },
      },
    )

    expect(result.data.value).toEqual({ source: 'matching-bytes' })
    wrapper.unmount()
  })

  it('reactive args trigger refetches for deep updates and added keys', async () => {
    const convex = new MockConvexClient()
    const query = mockFnRef<'query'>('search:notes:reactive-args')

    const { result, flush } = await captureInNuxt(
      () => {
        const args = reactive({
          filter: { tag: 'alpha' as string, sort: 'asc' as string },
        })
        const queryResult = useConvexQueryState(query, args)
        return { args, queryResult }
      },
      { convex },
    )

    await waitFor(() => convex.calls.onUpdate.length > 0)
    convex.emitQueryResult(
      query,
      { filter: { tag: 'alpha', sort: 'asc' } },
      { tag: 'alpha', hits: 1 },
    )
    await waitFor(() => result.queryResult.data.value?.tag === 'alpha')

    result.args.filter.tag = 'beta'
    await flush()

    await waitFor(() =>
      convex.calls.onUpdate.some((call) => {
        const args = call.args as { filter?: { tag?: string } }
        return args.filter?.tag === 'beta'
      }),
    )

    result.args.filter.sort = 'desc'
    await flush()
    await waitFor(() =>
      convex.calls.onUpdate.some((call) => {
        const args = call.args as { filter?: { sort?: string } }
        return args.filter?.sort === 'desc'
      }),
    )
  })

  it('applies transform to initialData while loading', async () => {
    const convex = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:list:initial-data-transform')

    const { result } = await captureInNuxt(
      () =>
        useConvexQueryState(
          query,
          {},
          {
            initialData: [{ _id: 'initial', title: 'loading' }],
            transform: (items: Array<{ _id: string; title: string }>) =>
              items.map((item) => ({
                ...item,
                title: item.title.toUpperCase(),
              })),
          },
        ),
      { convex },
    )

    expect(result.data.value).toEqual([{ _id: 'initial', title: 'LOADING' }])
    expect(result.pending.value).toBe(true)
  })

  it('keepPreviousData keeps settled result during args transition', async () => {
    const convex = new MockConvexClient()
    const query = mockFnRef<'query'>('search:notes:keep-previous')

    const { result, flush } = await captureInNuxt(
      () => {
        const tag = ref('alpha')
        const queryResult = useConvexQueryState(query, () => ({ filter: { tag: tag.value } }), {
          keepPreviousData: true,
        })
        return { tag, queryResult }
      },
      { convex },
    )

    await waitFor(() => convex.calls.onUpdate.length > 0)
    convex.emitQueryResult(query, { filter: { tag: 'alpha' } }, { tag: 'alpha', hits: 2 })
    await waitFor(() => result.queryResult.data.value?.tag === 'alpha')

    result.tag.value = 'beta'
    await flush()

    expect(result.queryResult.data.value).toEqual({ tag: 'alpha', hits: 2 })
    expect(result.queryResult.pending.value).toBe(true)
    expect(result.queryResult.isStale.value).toBe(true)

    convex.emitQueryResult(query, { filter: { tag: 'beta' } }, { tag: 'beta', hits: 5 })
    await waitFor(() => result.queryResult.data.value?.tag === 'beta')
    expect(result.queryResult.isStale.value).toBe(false)
  })

  it('uses pending status contract for server:false until first data', async () => {
    const convex = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:list:server-false-blocking')

    const { result } = await captureInNuxt(
      () => useConvexQueryState(query, {}, { server: false }),
      { convex },
    )

    expect(result.pending.value).toBe(true)
    expect(result.status.value).toBe('pending')

    convex.emitQueryResult(query, {}, [{ _id: 'n1' }])
    await waitFor(() => result.pending.value === false)

    expect(result.status.value).toBe('success')
    expect(result.data.value).toEqual([{ _id: 'n1' }])
  })

  it('hydrates the shared Vue controller from the identity-partitioned Nuxt payload', async () => {
    const convex = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:list:hydrated')
    const key = withAuthDimension(createConvexQueryKey(query, {}), 'none', 'anonymous')

    const { result } = await captureInNuxt(() => useConvexQueryState(query, {}, { auth: 'none' }), {
      convex,
      payloadData: { [key]: { value: [{ _id: 'ssr-note' }] } },
    })

    expect(result.data.value).toEqual([{ _id: 'ssr-note' }])
    expect(convex.calls.onUpdate).toHaveLength(1)
  })

  it('hydrates a valid Convex null result as settled data', async () => {
    const convex = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:nullable:hydrated')
    const key = withAuthDimension(createConvexQueryKey(query, {}), 'none', 'anonymous')

    const { result } = await captureInNuxt(() => useConvexQueryState(query, {}, { auth: 'none' }), {
      convex,
      payloadData: { [key]: { value: null } },
    })

    expect(result.data.value).toBeNull()
    expect(result.pending.value).toBe(true)
    convex.emitQueryResult(query, {}, null)
    await waitFor(() => result.pending.value === false)
    expect(result.pending.value).toBe(false)
    expect(result.status.value).toBe('success')
  })
})
