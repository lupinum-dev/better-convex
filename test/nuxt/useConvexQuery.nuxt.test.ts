import { getFunctionName, type FunctionArgs, type FunctionReference } from 'convex/server'
import { hash } from 'ohash'
import { describe, expect, it } from 'vitest'
import { onBeforeMount, onMounted, reactive, ref } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import { useNuxtApp, useState } from '#imports'

import {
  ANONYMOUS_IDENTITY,
  LOADING_IDENTITY,
  toAuthenticatedIdentity,
  type AuthIdentity,
} from '../../src/runtime/auth/auth-identity'
import { createConvexPaginatedQueryState } from '../../src/runtime/composables/useConvexPaginatedQuery'
import {
  createConvexQueryState,
  useConvexQuery,
  type ConvexQueryArgs,
  type UseNuxtConvexQueryOptions,
} from '../../src/runtime/composables/useConvexQuery'
import { ConvexCallError } from '../../src/runtime/errors'
import type { ConvexAuthMode } from '../../src/runtime/utils/auth-status'
import { createConvexPayloadKey } from '../../src/runtime/utils/convex-cache'
import type { ConvexIdentityKey } from '../../src/runtime/utils/identity-key'
import { MockConvexClient, mockFnRef } from '../helpers/mock-convex-client'
import { captureInNuxt, identityProxyListenerCount } from '../helpers/nuxt-runtime-harness'
import { waitFor } from '../helpers/wait-for'

function payloadKey(
  query: FunctionReference<'query'>,
  args: Record<string, unknown>,
  auth: ConvexAuthMode,
  identity: ConvexIdentityKey = 'anonymous',
) {
  return createConvexPayloadKey('convex', getFunctionName(query), hash(args), auth, identity)
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

function useConvexQueryState<
  Query extends FunctionReference<'query'>,
  Args extends ConvexQueryArgs<FunctionArgs<Query>> = FunctionArgs<Query>,
>(query: Query, args: MaybeRefOrGetter<Args>, options?: UseNuxtConvexQueryOptions) {
  return createConvexQueryState<Query, Args>(query, args, {
    auth: 'none',
    ...options,
  }).resultData
}

describe('useConvexQuery composables (Nuxt runtime)', () => {
  it('starts a payload-less immediate query only after Nuxt hydration settles', async () => {
    const convex = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:list:payload-less-hydration')
    const { result } = await captureInNuxt(
      () => {
        const nuxtApp = useNuxtApp()
        nuxtApp.isHydrating = true
        const listenersBeforeMount = ref(-1)
        const listenersDuringMount = ref(-1)
        const state = useConvexQuery(query, {}, { auth: 'none' })
        onBeforeMount(() => {
          listenersBeforeMount.value = convex.calls.onUpdate.length
        })
        onMounted(() => {
          listenersDuringMount.value = convex.calls.onUpdate.length
          nuxtApp.isHydrating = false
          void nuxtApp.callHook('app:suspense:resolve')
        })
        return { listenersBeforeMount, listenersDuringMount, state }
      },
      { convex, payloadData: {} },
    )

    expect(result.listenersBeforeMount.value).toBe(0)
    expect(result.listenersDuringMount.value).toBe(0)
    await waitFor(() => convex.calls.onUpdate.length === 1)
    expect(result.state.status.value).toBe('pending')
  })

  it('starts at once on the first render of an ssr: false page, and await waits for the result', async () => {
    const convex = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:list:spa-first-render')
    const { result } = await captureInNuxt(
      () => {
        // Nuxt reports `isHydrating` on the first render of an `ssr: false` page too.
        const nuxtApp = useNuxtApp()
        nuxtApp.isHydrating = true
        onMounted(() => {
          nuxtApp.isHydrating = false
        })
        return useConvexQuery(query, {}, { auth: 'none' })
      },
      { convex, serverRendered: false },
    )

    expect(result.status.value).toBe('pending')
    let settled = false
    const awaited = result.then(() => {
      settled = true
    })
    await waitFor(() => convex.calls.onUpdate.length === 1)
    await Promise.resolve()
    expect(settled).toBe(false)

    convex.emitQueryResult(query, {}, [{ _id: 'n1', title: 'Loaded' }])
    await awaited
    expect(result.data.value).toEqual([{ _id: 'n1', title: 'Loaded' }])
  })

  it('keeps an SSR value authoritative until hydration settles', async () => {
    const convex = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:list:hydrated-frame')
    const key = payloadKey(query, {}, 'none')
    const { result } = await captureInNuxt(
      () => {
        const nuxtApp = useNuxtApp()
        nuxtApp.isHydrating = true
        const listenersBeforeMount = ref(-1)
        const listenersDuringMount = ref(-1)
        const statusBeforeMount = ref('unknown')
        const state = useConvexQuery(query, {}, { auth: 'none' })
        onBeforeMount(() => {
          listenersBeforeMount.value = convex.calls.onUpdate.length
          statusBeforeMount.value = state.status.value
        })
        onMounted(() => {
          listenersDuringMount.value = convex.calls.onUpdate.length
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
        convex,
        payloadData: { [key]: { value: [{ _id: 'ssr-note' }] } },
      },
    )

    expect(result.listenersBeforeMount.value).toBe(0)
    expect(result.listenersDuringMount.value).toBe(0)
    expect(result.statusBeforeMount.value).toBe('success')
    expect(result.state.data.value).toEqual([{ _id: 'ssr-note' }])
    await waitFor(() => convex.calls.onUpdate.length === 1)
  })

  it('does not add one identity observer listener per query composable', async () => {
    const query = mockFnRef<'query'>('notes:list:no-identity-mirror')
    const paginated = mockFnRef<'query'>('notes:page:no-identity-mirror')

    const { result } = await captureInNuxt(
      () => {
        const before = identityProxyListenerCount()
        createConvexQueryState(query, 'skip')
        createConvexQueryState(query, 'skip')
        createConvexQueryState(query, 'skip')
        createConvexPaginatedQueryState(paginated as never, 'skip', { initialNumItems: 10 })
        createConvexPaginatedQueryState(paginated as never, 'skip', { initialNumItems: 10 })
        return { before, after: identityProxyListenerCount() }
      },
      { convex: new MockConvexClient() },
    )

    expect(result.after).toBe(result.before)
  })

  it('mounts immediately from an SSR error and keeps it until client reconciliation settles', async () => {
    const convex = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:list:ssr-error-hydration')
    const key = payloadKey(query, {}, 'optional')
    const ssrError = new ConvexCallError({
      kind: 'transport',
      message: 'Sanitized SSR transport failure',
      status: 500,
    })
    const { result, flush } = await captureInNuxt(
      () => hydrating(() => useConvexQuery(query, {})),
      {
        convex,
        convexConfig: { auth: false },
        payloadData: { [key]: { error: ssrError } },
      },
    )

    const hydrated = await result
    expect(hydrated.error.value).toBe(ssrError)
    expect(hydrated.pending.value).toBe(false)
    expect(hydrated.status.value).toBe('error')

    await waitFor(() => convex.calls.onUpdate.length === 1)
    // The live lifecycle is loading: the SSR error bridges it.
    expect(hydrated.status.value).toBe('error')
    convex.emitQueryResult(query, {}, { ok: true })
    await flush()
    await waitFor(() => hydrated.status.value === 'success')
    expect(hydrated.error.value).toBeUndefined()
    expect(hydrated.data.value).toEqual({ ok: true })
  })

  it('retires a hydrated SSR error when reactive arguments change', async () => {
    const convex = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:list:ssr-error-argument-boundary')
    const initialArgs = { category: 'alpha' }
    const replacementArgs = { category: 'beta' }
    const key = payloadKey(query, initialArgs, 'none')
    const ssrError = new ConvexCallError({
      kind: 'transport',
      message: 'Sanitized SSR transport failure',
      status: 500,
    })
    const { result, flush } = await captureInNuxt(
      () =>
        hydrating(() => {
          const args = ref(initialArgs)
          return {
            args,
            query: useConvexQuery(query, args, { auth: 'none' }),
            stableQuery: useConvexQuery(query, initialArgs, { auth: 'none' }),
          }
        }),
      { convex, payloadData: { [key]: { error: ssrError } } },
    )

    expect(result.query.error.value).toBe(ssrError)
    expect(result.query.status.value).toBe('error')
    await waitFor(() => convex.calls.onUpdate.length === 2)

    result.args.value = replacementArgs
    await flush()

    expect(result.query.error.value).toBeUndefined()
    expect(result.query.status.value).toBe('pending')
    expect(result.query.data.value).toBeUndefined()
    expect(result.stableQuery.error.value).toBe(ssrError)

    // Returning to the hydrated arguments does not resurrect the retired error.
    result.args.value = initialArgs
    await flush()
    expect(result.query.error.value).toBeUndefined()
    result.args.value = replacementArgs
    await flush()

    convex.emitQueryResult(query, replacementArgs, { category: 'beta' })
    await waitFor(() => result.query.status.value === 'success')
    expect(result.query.data.value).toEqual({ category: 'beta' })

    convex.emitQueryResult(query, initialArgs, { category: 'alpha' })
    await waitFor(() => result.stableQuery.status.value === 'success')
    expect(result.stableQuery.data.value).toEqual({ category: 'alpha' })
    expect(result.stableQuery.error.value).toBeUndefined()
  })

  it('ignores an SSR payload once hydration has finished', async () => {
    const convex = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:list:stale-payload-navigation')
    const key = payloadKey(query, {}, 'none')

    // Client navigation after hydration: the payload describes an earlier page.
    const { result } = await captureInNuxt(() => useConvexQueryState(query, {}, { auth: 'none' }), {
      convex,
      payloadData: { [key]: { value: [{ _id: 'old-ssr-note' }] } },
    })

    expect(result.status.value).toBe('pending')
    expect(result.data.value).toBeUndefined()
    await waitFor(() => convex.calls.onUpdate.length === 1)
    convex.emitQueryResult(query, {}, [{ _id: 'live-note' }])
    await waitFor(() => result.status.value === 'success')
    expect(result.data.value).toEqual([{ _id: 'live-note' }])
  })

  it('renders server:false as idle while hydrating, as the server did', async () => {
    const convex = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:list:server-false-hydration')
    const { result } = await captureInNuxt(
      () =>
        hydrating(() => {
          const statusBeforeMount = ref('unknown')
          const pendingBeforeMount = ref<boolean | undefined>(undefined)
          const state = useConvexQueryState(query, {}, { server: false })
          onBeforeMount(() => {
            statusBeforeMount.value = state.status.value
            pendingBeforeMount.value = state.pending.value
          })
          return { state, statusBeforeMount, pendingBeforeMount }
        }),
      { convex, payloadData: {} },
    )

    expect(result.statusBeforeMount.value).toBe('idle')
    expect(result.pendingBeforeMount.value).toBe(false)
    await waitFor(() => convex.calls.onUpdate.length === 1)
    expect(result.state.status.value).toBe('pending')
    convex.emitQueryResult(query, {}, [{ _id: 'browser-only' }])
    await waitFor(() => result.state.status.value === 'success')
  })

  it('renders the SSR auth-error gate while hydrating, as the server did', async () => {
    const convex = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:list:ssr-auth-error-gate')
    const { result } = await captureInNuxt(
      () =>
        hydrating(() => {
          useState<string | null>('convex:authError').value = 'Session exchange failed'
          useState<boolean>('convex:pending').value = false
          const state = useConvexQueryState(query, {}, { auth: 'optional' })
          const rendered = ref<{ status: string; pending: boolean; message?: string }>()
          const listenersBeforeMount = ref(-1)
          onBeforeMount(() => {
            rendered.value = {
              status: state.status.value,
              pending: state.pending.value,
              message: state.error.value?.message,
            }
            listenersBeforeMount.value = convex.calls.onUpdate.length
          })
          return { state, rendered, listenersBeforeMount }
        }),
      { convex },
    )

    expect(result.rendered.value).toEqual({
      status: 'error',
      pending: false,
      message: 'Session exchange failed',
    })
    expect(result.state.error.value).toBeInstanceOf(ConvexCallError)
    expect(result.listenersBeforeMount.value).toBe(0)
  })

  it('renders the server blockedBy while hydrating, even before the browser identity settles', async () => {
    const convex = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:mine:ssr-blocked-by')
    const key = payloadKey(query, {}, 'required', 'user:A')
    const browserIdentity = {
      snapshot: () => ({
        authEnabled: true,
        settled: false,
        identityKey: null,
        identityGeneration: 0,
        error: null,
      }),
      waitForInitialSettlement: () => new Promise<void>(() => {}),
      subscribe: () => () => {},
    }
    const { result } = await captureInNuxt(
      () =>
        hydrating(() => {
          useState<boolean>('convex:pending').value = false
          useState<AuthIdentity>('convex:identity').value = toAuthenticatedIdentity('jwt-A', {
            id: 'A',
          })
          const state = useConvexQueryState(query, {}, { auth: 'required' })
          const skipped = useConvexQueryState(query, 'skip', { auth: 'required' })
          const deferred = useConvexQueryState(query, {}, { auth: 'required', immediate: false })
          const rendered = ref<unknown[]>()
          onBeforeMount(() => {
            rendered.value = [
              state.blockedBy.value,
              skipped.blockedBy.value,
              deferred.blockedBy.value,
            ]
          })
          return { state, rendered }
        }),
      {
        convex,
        identityObserver: browserIdentity,
        payloadData: { [key]: { value: 'ssr' } },
      },
    )

    // The server rendered `null`, `skip`, and `manual`; the browser identity
    // is still settling but hydration renders the same values.
    expect(result.rendered.value).toEqual([null, 'skip', 'manual'])
    await waitFor(() => result.state.blockedBy.value === 'auth')
  })

  it('renders an authenticated SSR query fetched without a token as idle, as the server did', async () => {
    const convex = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:mine:ssr-without-token')
    const key = payloadKey(query, {}, 'required', 'user:A')
    const { result } = await captureInNuxt(
      () =>
        hydrating(() => {
          useState<boolean>('convex:pending').value = false
          useState<AuthIdentity>('convex:identity').value = toAuthenticatedIdentity('jwt-A', {
            id: 'A',
          })
          const state = useConvexQueryState(query, {}, { auth: 'required' })
          const rendered = ref<{ status: string; pending: boolean; data: unknown }>()
          onBeforeMount(() => {
            rendered.value = {
              status: state.status.value,
              pending: state.pending.value,
              data: state.data.value,
            }
          })
          return { state, rendered }
        }),
      { convex, payloadData: { [key]: null } },
    )

    expect(result.rendered.value).toEqual({ status: 'idle', pending: false, data: undefined })
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

  it('settles rather than rejects its initial Promise on a live query error', async () => {
    const convex = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:list:awaited-live-failure')

    const { result } = await captureInNuxt(() => useConvexQuery(query, {}, { auth: 'none' }), {
      convex,
    })
    await waitFor(() => convex.calls.onUpdate.length > 0)
    convex.emitQueryError(query, {}, new Error('query exploded'))

    const awaited = await result
    expect(awaited.status.value).toBe('error')
    expect(awaited.error.value).toBeInstanceOf(ConvexCallError)
  })

  it('unwraps the awaited state into one live object with reactive()', async () => {
    const convex = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:list:reactive-object')

    const { result } = await captureInNuxt(() => useConvexQuery(query, {}, { auth: 'none' }), {
      convex,
    })
    await waitFor(() => convex.calls.onUpdate.length > 0)
    convex.emitQueryResult(query, {}, ['first'])
    const notes = reactive(await result)

    expect(notes.status).toBe('success')
    expect(notes.data).toEqual(['first'])
    convex.emitQueryResult(query, {}, ['second'])
    expect(notes.data).toEqual(['second'])
  })

  it('refresh resolves after storing a query error', async () => {
    const convex = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:list:refresh-failure')
    convex.setQueryHandler('notes:list:refresh-failure', async () => {
      throw new Error('private refresh failure')
    })

    const { result } = await captureInNuxt(() => useConvexQueryState(query, {}), { convex })

    await expect(result.refresh()).resolves.toBeUndefined()
    expect(result.status.value).toBe('error')
    expect(result.error.value).toBeInstanceOf(ConvexCallError)
  })

  it('returns Nuxt-compatible immediate state on one native initial-settlement Promise', async () => {
    const convex = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:list:blocking-default')

    const { result } = await captureInNuxt(() => useConvexQuery(query, {}, { auth: 'none' }), {
      convex,
    })

    expect(result).toBeInstanceOf(Promise)
    expect(Promise.resolve(result)).toBe(result)
    expect(result.status.value).toBe('pending')
    expect(result.pending.value).toBe(true)
    expect(result.data.value).toBeUndefined()

    const spread = { ...result }
    expect(typeof spread.then).toBe('function')
    expect(typeof spread.catch).toBe('function')
    expect(typeof spread.finally).toBe('function')

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

    expect(resolved).not.toBe(result)
    expect(resolved.data).toBe(result.data)
    expect(resolved.status).toBe(result.status)
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

  it('keeps later awaits tied to the first settlement across argument changes', async () => {
    const convex = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:list:one-settlement')

    const { result, flush } = await captureInNuxt(
      () => {
        const owner = ref('alice')
        const state = useConvexQuery(query, () => ({ owner: owner.value }), {
          auth: 'none',
        })
        return { owner, state }
      },
      { convex },
    )

    await waitFor(() => convex.activeListenerCount(query, { owner: 'alice' }) === 1)
    convex.emitQueryResult(query, { owner: 'alice' }, { owner: 'alice' })
    await result.state

    result.owner.value = 'bob'
    await flush()
    expect(result.state.status.value).toBe('pending')

    let settledAgain = false
    void result.state.then(() => {
      settledAgain = true
    })
    await Promise.resolve()
    expect(settledAgain).toBe(true)
  })

  it('returns idle + pending=false immediately for skipped args', async () => {
    const query = mockFnRef<'query'>('notes:list:disabled-static')
    const { result } = await captureInNuxt(() => useConvexQueryState(query, 'skip'), {
      convex: new MockConvexClient(),
    })

    expect(result.data.value).toBeUndefined()
    expect(result.pending.value).toBe(false)
    expect(result.status.value).toBe('idle')
    expect(result.blockedBy.value).toBe('skip')
  })

  it('does not fetch or subscribe a deferred query until execute', async () => {
    const convex = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:list:deferred')
    const { result } = await captureInNuxt(
      () => useConvexQueryState(query, {}, { auth: 'none', immediate: false }),
      { convex },
    )

    expect(result.status.value).toBe('idle')
    expect(result.pending.value).toBe(false)
    expect(result.blockedBy.value).toBe('manual')
    expect(convex.calls.onUpdate).toHaveLength(0)
    const execution = result.execute()
    expect(result.blockedBy.value).toBeNull()
    expect(convex.calls.onUpdate).toHaveLength(1)
    convex.emitQueryResult(query, {}, { ready: true })
    await execution
    expect(result.data.value).toEqual({ ready: true })
    expect(result.status.value).toBe('success')
  })

  it('rejects lazy plus deferred options at runtime after an unsafe cast', async () => {
    const query = mockFnRef<'query'>('notes:list:invalid-lifecycle')
    await expect(
      captureInNuxt(
        () =>
          useConvexQueryState(query, {}, {
            immediate: false,
            lazy: true,
          } as never),
        { convex: new MockConvexClient() },
      ),
    ).rejects.toThrow('lazy: true cannot be combined with immediate: false')
  })

  it('settles an awaited skipped query without rejecting', async () => {
    const query = mockFnRef<'query'>('notes:list:disabled-awaited')
    const { result } = await captureInNuxt(() => useConvexQuery(query, 'skip'), {
      convex: new MockConvexClient(),
    })

    const awaited = await result
    expect(awaited.data.value).toBeUndefined()
    expect(awaited.error.value).toBeUndefined()
    expect(awaited.status.value).toBe('idle')
  })

  it('treats "skip" args as idle and does not start subscriptions', async () => {
    const convex = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:list:skip-static')

    const { result } = await captureInNuxt(() => useConvexQueryState(query, 'skip'), {
      convex,
    })

    expect(result.data.value).toBeUndefined()
    expect(result.pending.value).toBe(false)
    expect(result.isStale.value).toBe(false)
    expect(result.status.value).toBe('idle')
    expect(convex.calls.onUpdate.length).toBe(0)
  })

  it('exposes execute and refresh but omits clear from query state', async () => {
    const query = mockFnRef<'query'>('notes:list:return-shape')
    const { result } = await captureInNuxt(() => useConvexQueryState(query, 'skip'), {
      convex: new MockConvexClient(),
    })

    expect(typeof result.refresh).toBe('function')
    expect('clear' in (result as unknown as Record<string, unknown>)).toBe(false)
    expect(typeof result.execute).toBe('function')
  })

  it('does not subscribe while private auth is pending', async () => {
    const query = mockFnRef<'query'>('notes:list:auth-pending-http')
    const convex = new MockConvexClient()

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
        convexConfig: { auth: { origin: 'http://localhost:3000' } },
      },
    )

    expect(result.queryResult.pending.value).toBe(true)
    expect(convex.calls.onUpdate).toHaveLength(0)

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
    expect(result.queryResult.data.value).toBeUndefined()
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
        convexConfig: { auth: { origin: 'http://localhost:3000' } },
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
        convexConfig: { auth: { origin: 'http://localhost:3000' } },
      },
    )

    await waitFor(() => convex.calls.onUpdate.length > 0)
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
    const key = payloadKey(query, { digest }, 'none')
    const otherKey = payloadKey(query, { digest: otherDigest }, 'none')

    expect(otherKey).not.toBe(key)
    const { result, wrapper } = await captureInNuxt(
      () => hydrating(() => useConvexQueryState(query, { digest }, { auth: 'none' })),
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

  it('settles server:false immediately while its live state remains pending', async () => {
    const convex = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:list:server-false-immediate-await')

    const { result } = await captureInNuxt(
      () => useConvexQuery(query, {}, { auth: 'none', server: false }),
      { convex },
    )

    const awaited = await result
    expect(awaited).not.toBe(result)
    expect(awaited.pending.value).toBe(true)
    expect(awaited.status.value).toBe('pending')
  })

  it('hydrates the shared Vue controller from the identity-partitioned Nuxt payload', async () => {
    const convex = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:list:hydrated')
    const key = payloadKey(query, {}, 'none')

    const { result } = await captureInNuxt(
      () => hydrating(() => useConvexQueryState(query, {}, { auth: 'none' })),
      { convex, payloadData: { [key]: { value: [{ _id: 'ssr-note' }] } } },
    )

    expect(result.data.value).toEqual([{ _id: 'ssr-note' }])
    await waitFor(() => convex.calls.onUpdate.length === 1)
    expect(result.status.value).toBe('success')
    expect(result.data.value).toEqual([{ _id: 'ssr-note' }])
  })

  it('hydrates a valid Convex null result as settled data', async () => {
    const convex = new MockConvexClient()
    const query = mockFnRef<'query'>('notes:nullable:hydrated')
    const key = payloadKey(query, {}, 'none')

    const { result } = await captureInNuxt(
      () => hydrating(() => useConvexQueryState(query, {}, { auth: 'none' })),
      { convex, payloadData: { [key]: { value: null } } },
    )

    expect(result.data.value).toBeNull()
    expect(result.pending.value).toBe(false)
    expect(result.status.value).toBe('success')
  })
})
