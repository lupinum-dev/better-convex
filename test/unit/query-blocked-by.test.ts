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
  useConvexPaginatedQuery,
  useConvexQuery,
  type ConvexAuthMode,
} from '../../packages/vue/src'
import { createBetterConvexAttachment } from '../../packages/vue/src/embedded'
import type { ClientIdentitySnapshot } from '../../packages/vue/src/internal/identity-port'
import { decideQueryGate } from '../../packages/vue/src/internal/query-execution'
import { ConvexCallError } from '../../src/runtime/errors'
import {
  projectConvexSsrPagination,
  projectConvexSsrQuery,
  projectNuxtQueryIdentity,
  resolveConvexQueryGate,
  type NuxtQueryAuthState,
} from '../../src/runtime/utils/query-ssr'

const MODES: ConvexAuthMode[] = ['required', 'optional', 'none']

const authError = new ConvexCallError({ kind: 'authentication', message: 'exchange failed' })
const states = {
  disabled: { authEnabled: false, pending: false, identityKey: 'anonymous', error: null },
  loading: { authEnabled: true, pending: true, identityKey: 'anonymous', error: null },
  anonymous: { authEnabled: true, pending: false, identityKey: 'anonymous', error: null },
  authenticated: { authEnabled: true, pending: false, identityKey: 'user:alice', error: null },
  error: { authEnabled: true, pending: false, identityKey: 'anonymous', error: authError },
} satisfies Record<string, NuxtQueryAuthState>

function mountRuntime(initial: ClientIdentitySnapshot) {
  let snapshot = initial
  const listeners = new Set<() => void>()
  const client = {
    query: vi.fn(async () => null) as never,
    mutation: vi.fn(async () => null) as never,
    action: vi.fn(async () => null) as never,
    onUpdate: vi.fn(() => () => {}) as never,
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
  const app = createApp({})
  app.use(createBetterConvex({ attachment }))
  const scope = effectScope()
  return {
    run<T>(factory: () => T): T {
      return app.runWithContext(() => scope.run(factory))!
    },
    emit(next: Partial<ClientIdentitySnapshot>) {
      snapshot = { ...snapshot, ...next }
      for (const listener of [...listeners]) listener()
    },
    stop: () => scope.stop(),
  }
}

const paginated = makeFunctionReference<'query'>('notes:paginated') as FunctionReference<
  'query',
  'public',
  { paginationOpts: PaginationOptions },
  PaginationResult<string>
>

describe('blockedBy', () => {
  it('reports skip, manual, and auth blockers from one precedence', () => {
    const identity = projectNuxtQueryIdentity(states.loading)
    const gate = (auth: ConvexAuthMode, started: boolean, skipped: boolean) =>
      decideQueryGate({ auth, started, skipped, identity })

    expect(gate('optional', true, true)).toEqual({ outcome: 'idle', blockedBy: 'skip' })
    expect(gate('optional', false, true).blockedBy).toBe('skip')
    expect(gate('optional', false, false)).toEqual({ outcome: 'idle', blockedBy: 'manual' })
    expect(gate('optional', true, false)).toEqual({ outcome: 'wait', blockedBy: 'auth' })
    expect(gate('none', true, false)).toEqual({ outcome: 'execute', blockedBy: null })
  })

  it('follows the live query through skip, manual start, and auth settlement', async () => {
    const host = mountRuntime({
      authEnabled: true,
      settled: false,
      identityKey: null,
      identityGeneration: 1,
      error: null,
    })
    const args = ref<Record<string, never> | 'skip'>('skip')
    const query = host.run(() =>
      useConvexQuery(makeFunctionReference<'query'>('notes:blocked'), args, {
        auth: 'required',
        immediate: false,
      }),
    )

    expect(query.blockedBy.value).toBe('skip')
    args.value = {}
    expect(query.blockedBy.value).toBe('manual')
    void query.execute()
    expect(query.blockedBy.value).toBe('auth')
    expect(query.status.value).toBe('pending')

    host.emit({ settled: true, identityKey: 'anonymous' })
    expect(query.blockedBy.value).toBe('auth')
    expect(query.status.value).toBe('idle')

    host.emit({ identityKey: 'user:alice', identityGeneration: 2 })
    expect(query.blockedBy.value).toBeNull()
    expect(query.status.value).toBe('pending')
    host.stop()
  })

  it('reports the same blocker for the paginated list', () => {
    const host = mountRuntime({
      authEnabled: true,
      settled: true,
      identityKey: 'anonymous',
      identityGeneration: 1,
      error: null,
    })
    const list = host.run(() =>
      useConvexPaginatedQuery(paginated, {}, { initialNumItems: 1, auth: 'required' }),
    )

    expect(list.blockedBy.value).toBe('auth')
    expect(list.status.value).toBe('idle')
    host.emit({ identityKey: 'user:alice', identityGeneration: 2 })
    expect(list.blockedBy.value).toBeNull()
    host.stop()
  })
})

describe('blockedBy hydration parity', () => {
  it('renders the server blocker in the hydrating browser and the live lifecycle', () => {
    for (const [name, state] of Object.entries(states)) {
      const identity = projectNuxtQueryIdentity(state)
      for (const auth of MODES) {
        for (const started of [true, false]) {
          for (const skipped of [false, true]) {
            const label = `${name}/${auth}/${started ? 'immediate' : 'deferred'}/${skipped}`
            // The server render and the hydrating browser call the same
            // projection with the same payload and SSR auth state.
            const gate = resolveConvexQueryGate({ auth, started, skipped, identity })
            const server = projectConvexSsrQuery<string>({
              gate,
              server: true,
              functionName: 'notes:list',
              authError: identity.error,
              entry: undefined,
              fetching: false,
            })
            const hydrating = projectConvexSsrQuery<string>({
              gate: resolveConvexQueryGate({ auth, started, skipped, identity }),
              server: true,
              functionName: 'notes:list',
              authError: identity.error,
              entry: undefined,
              fetching: false,
            })
            expect(hydrating.blockedBy, label).toBe(server.blockedBy)
            expect(
              projectConvexSsrPagination<string>({ ...server, value: undefined }).blockedBy,
              label,
            ).toBe(server.blockedBy)

            // The live lifecycle derives the same value from the same identity.
            const host = mountRuntime({ ...identity, identityGeneration: 1 })
            const live = host.run(() => ({
              query: useConvexQuery(
                makeFunctionReference<'query'>('notes:parity'),
                skipped ? 'skip' : {},
                { auth, immediate: started },
              ),
              list: useConvexPaginatedQuery(paginated, skipped ? 'skip' : {}, {
                auth,
                initialNumItems: 1,
                immediate: started,
              }),
            }))
            expect(live.query.blockedBy.value, label).toBe(server.blockedBy)
            expect(live.list.blockedBy.value, label).toBe(server.blockedBy)
            host.stop()
          }
        }
      }
    }
  })

  it('names the query on an auth-gate error in the live lifecycle', async () => {
    const host = mountRuntime({
      authEnabled: true,
      settled: true,
      identityKey: 'anonymous',
      identityGeneration: 1,
      error: authError,
    })
    const live = host.run(() => ({
      query: useConvexQuery(
        makeFunctionReference<'query'>('notes:gated'),
        {},
        { auth: 'required' },
      ),
      list: useConvexPaginatedQuery(paginated, {}, { auth: 'required', initialNumItems: 1 }),
    }))
    await vi.waitFor(() => expect(live.query.error.value).toBeDefined())
    expect(live.query.error.value).toMatchObject({
      kind: 'authentication',
      message: 'exchange failed',
      functionName: 'notes:gated',
    })
    expect(live.list.error.value).toMatchObject({
      kind: 'authentication',
      functionName: 'notes:paginated',
    })
    expect(authError.functionName).toBeUndefined()
    host.stop()
  })

  it('keeps a deferred blocker independent of a browser identity that still settles', () => {
    for (const auth of MODES) {
      const server = resolveConvexQueryGate({
        auth,
        started: false,
        skipped: false,
        identity: projectNuxtQueryIdentity(states.authenticated),
      })
      const host = mountRuntime({
        authEnabled: true,
        settled: false,
        identityKey: null,
        identityGeneration: 0,
        error: null,
      })
      const query = host.run(() =>
        useConvexQuery(
          makeFunctionReference<'query'>('notes:deferred-parity'),
          {},
          {
            auth,
            immediate: false,
          },
        ),
      )
      expect(server.blockedBy).toBe('manual')
      expect(query.blockedBy.value).toBe(server.blockedBy)
      host.stop()
    }
  })
})
