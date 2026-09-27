import { decideQueryExecution } from '@lupinum/better-convex-vue/internal'
import type { PaginationResult } from 'convex/server'
import { describe, expect, it } from 'vitest'

import { ConvexCallError, normalizeConvexError } from '../../src/runtime/errors'
import { deriveConvexAuthStatus, type ConvexAuthMode } from '../../src/runtime/utils/auth-status'
import {
  convexQueryAsyncDataKey,
  projectConvexSsrPagination,
  projectConvexSsrQuery,
  projectNuxtQueryIdentity,
  readConvexQueryPayload,
  resolveConvexQueryGate,
  type NuxtQueryAuthState,
} from '../../src/runtime/utils/query-ssr'

const MODES: ConvexAuthMode[] = ['required', 'optional', 'none']
const authError = new ConvexCallError({
  kind: 'authentication',
  message: 'Session exchange failed',
})

const states = {
  disabled: { authEnabled: false, pending: false, identityKey: 'anonymous', error: null },
  loading: { authEnabled: true, pending: true, identityKey: 'anonymous', error: null },
  anonymous: { authEnabled: true, pending: false, identityKey: 'anonymous', error: null },
  authenticated: { authEnabled: true, pending: false, identityKey: 'user:alice', error: null },
  error: { authEnabled: true, pending: false, identityKey: 'anonymous', error: authError },
} satisfies Record<string, NuxtQueryAuthState>

function gate(state: NuxtQueryAuthState, auth: ConvexAuthMode, skipped = false) {
  return resolveConvexQueryGate({
    auth,
    started: true,
    skipped,
    identity: projectNuxtQueryIdentity(state),
  })
}

describe('Nuxt auth state adapted to the one Vue execution decision', () => {
  it('keeps the SSR gate matrix', () => {
    const expected: Record<keyof typeof states, Record<ConvexAuthMode, string>> = {
      disabled: { required: 'idle', optional: 'execute', none: 'execute' },
      loading: { required: 'wait', optional: 'wait', none: 'execute' },
      anonymous: { required: 'idle', optional: 'execute', none: 'execute' },
      authenticated: { required: 'execute', optional: 'execute', none: 'execute' },
      error: { required: 'error', optional: 'error', none: 'execute' },
    }
    for (const [name, state] of Object.entries(states)) {
      for (const auth of MODES) {
        expect(gate(state, auth).outcome, `${name}/${auth}`).toBe(
          expected[name as keyof typeof states][auth],
        )
        expect(gate(state, auth, true).outcome, `${name}/${auth}/skip`).toBe('idle')
      }
    }
  })

  it('is the Vue decision itself, not a parallel matrix', () => {
    for (const state of Object.values(states)) {
      for (const auth of MODES) {
        for (const skipped of [false, true]) {
          expect(gate(state, auth, skipped).outcome).toBe(
            decideQueryExecution({ auth, skipped, identity: projectNuxtQueryIdentity(state) }),
          )
        }
      }
    }
  })

  it('lets a usable identity outrank a stale auth error', () => {
    expect(gate({ ...states.authenticated, error: authError }, 'required').outcome).toBe('execute')
  })

  it('gates on the same precedence useConvexAuth() reports as status', () => {
    const requiredOutcome = {
      loading: 'wait',
      authenticated: 'execute',
      error: 'error',
      anonymous: 'idle',
    } as const
    for (const pending of [false, true]) {
      for (const identityKey of ['anonymous', 'user:alice'] as const) {
        for (const error of [null, authError]) {
          const status = deriveConvexAuthStatus({ settled: !pending, identityKey, error })
          expect(
            gate({ authEnabled: true, pending, identityKey, error }, 'required').outcome,
            `${pending}/${identityKey}/${error ? 'error' : 'none'}`,
          ).toBe(requiredOutcome[status])
        }
      }
    }
  })

  it('partitions only non-none payload keys by identity', () => {
    expect(gate(states.authenticated, 'optional').identity).toBe('user:alice')
    expect(gate(states.authenticated, 'none').identity).toBe('anonymous')
    expect(
      convexQueryAsyncDataKey(
        'convex',
        'notes:list',
        'h',
        'optional',
        gate(states.authenticated, 'optional'),
      ),
    ).toBe('convex:notes:list:h:auth:optional:user:alice')
    expect(
      convexQueryAsyncDataKey(
        'convex',
        'notes:list',
        'h',
        'required',
        gate(states.anonymous, 'required'),
      ),
    ).toBe('convex:idle:notes:list')
  })

  it('does not execute a deferred query and reports it as manual', () => {
    expect(
      resolveConvexQueryGate({
        auth: 'none',
        started: false,
        skipped: false,
        identity: projectNuxtQueryIdentity(states.anonymous),
      }),
    ).toMatchObject({ outcome: 'idle', blockedBy: 'manual' })
  })

  it('reports auth as the blocker for every gate outcome auth causes', () => {
    const expected: Record<keyof typeof states, Record<ConvexAuthMode, string | null>> = {
      disabled: { required: 'auth', optional: null, none: null },
      loading: { required: 'auth', optional: 'auth', none: null },
      anonymous: { required: 'auth', optional: null, none: null },
      authenticated: { required: null, optional: null, none: null },
      error: { required: 'auth', optional: 'auth', none: null },
    }
    for (const [name, state] of Object.entries(states)) {
      for (const auth of MODES) {
        expect(gate(state, auth).blockedBy, `${name}/${auth}`).toBe(
          expected[name as keyof typeof states][auth],
        )
        expect(gate(state, auth, true).blockedBy, `${name}/${auth}/skip`).toBe('skip')
      }
    }
  })
})

describe('SSR view shared by the server render and the hydrating browser', () => {
  const executing = { outcome: 'execute', blockedBy: null } as const
  const gates = {
    execute: executing,
    wait: { outcome: 'wait', blockedBy: 'auth' },
    error: { outcome: 'error', blockedBy: 'auth' },
    idle: { outcome: 'idle', blockedBy: 'skip' },
  } as const
  const view = (
    input: Partial<Omit<Parameters<typeof projectConvexSsrQuery<string>>[0], 'gate'>> & {
      gate?: keyof typeof gates
    },
  ) =>
    projectConvexSsrQuery<string>({
      server: true,
      functionName: 'notes:list',
      authError: null,
      entry: undefined,
      fetching: false,
      ...input,
      gate: gates[input.gate ?? 'execute'],
    })

  it('renders a fetched value as success and a fetched error as error', () => {
    expect(view({ entry: { value: 'ssr' } })).toEqual({
      status: 'success',
      value: 'ssr',
      error: undefined,
      blockedBy: null,
    })
    const error = new ConvexCallError({ kind: 'transport', message: 'SSR failure' })
    expect(view({ entry: { error } })).toEqual({
      status: 'error',
      value: undefined,
      error,
      blockedBy: null,
    })
  })

  it('carries the gate blocker into the rendered view', () => {
    expect(view({ gate: 'wait' }).blockedBy).toBe('auth')
    expect(view({ gate: 'idle' }).blockedBy).toBe('skip')
    expect(view({ gate: 'error', authError }).blockedBy).toBe('auth')
  })

  it('names the query on an auth-gate error', () => {
    const rendered = view({ gate: 'error', authError })
    expect(rendered.error).toMatchObject({
      kind: 'authentication',
      message: authError.message,
      functionName: 'notes:list',
    })
    expect(authError.functionName).toBeUndefined()
  })

  it('keeps a null Convex result as data', () => {
    expect(
      projectConvexSsrQuery<null>({
        gate: executing,
        server: true,
        functionName: 'notes:list',
        authError: null,
        entry: { value: null },
        fetching: false,
      }).status,
    ).toBe('success')
  })

  it('renders server: false as idle, like Nuxt useAsyncData, never as pending', () => {
    expect(view({ server: false })).toEqual({
      status: 'idle',
      value: undefined,
      error: undefined,
      blockedBy: null,
    })
    // A stale entry under the same key must not leak into a browser-only query.
    expect(view({ server: false, entry: { value: 'stale' } }).status).toBe('idle')
  })

  it('renders an unfetched execution (no token, no URL) as idle, never as empty success', () => {
    expect(view({ entry: null })).toEqual({
      status: 'idle',
      value: undefined,
      error: undefined,
      blockedBy: null,
    })
  })

  it('renders the settled auth error gate as that error, named for the query', () => {
    expect(view({ gate: 'error', authError })).toEqual({
      status: 'error',
      value: undefined,
      error: normalizeConvexError(authError, { functionName: 'notes:list' }),
      blockedBy: 'auth',
    })
  })

  it('is pending only while fetching or waiting for auth', () => {
    expect(view({ fetching: true }).status).toBe('pending')
    expect(view({ gate: 'wait' }).status).toBe('pending')
    expect(view({ gate: 'idle', fetching: true }).status).toBe('idle')
  })

  it('reads only payload entries this module writes', () => {
    expect(readConvexQueryPayload(null)).toBeUndefined()
    expect(readConvexQueryPayload({ page: [] })).toBeUndefined()
    expect(readConvexQueryPayload({ value: 1 })).toEqual({ value: 1 })
    const revived = readConvexQueryPayload({ error: { message: 'plain' } })
    expect(revived && 'error' in revived && revived.error).toBeInstanceOf(ConvexCallError)
  })

  it('projects pagination so canLoadMore matches the live first page it hands off to', () => {
    const page: PaginationResult<string> = {
      page: ['a'],
      isDone: false,
      continueCursor: 'next',
      pageStatus: 'SplitRecommended',
    }
    const project = (entry: { value: PaginationResult<string> } | undefined, server = true) =>
      projectConvexSsrPagination(
        projectConvexSsrQuery<PaginationResult<string>>({
          gate: executing,
          server,
          functionName: 'notes:list',
          authError: null,
          entry,
          fetching: false,
        }),
      )
    // Transport internals (cursor, pageStatus) never reach the public view.
    expect(project({ value: page })).toEqual({
      status: 'success',
      data: ['a'],
      error: undefined,
      blockedBy: null,
      canLoadMore: true,
      isExhausted: false,
    })
    expect(project({ value: { ...page, isDone: true, continueCursor: '' } })).toMatchObject({
      canLoadMore: false,
      isExhausted: true,
    })
    expect(project(undefined, false)).toMatchObject({
      status: 'idle',
      data: undefined,
      canLoadMore: false,
      isExhausted: false,
    })
  })
})
