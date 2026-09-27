import type { ConvexQueryBlockedBy } from '@lupinum/better-convex-vue'
import {
  decideQueryGate,
  deriveQueryStatus,
  queryIsolationTag,
  type ClientIdentitySnapshot,
  type ConvexIdentityKey,
  type QueryExecutionOutcome,
} from '@lupinum/better-convex-vue/internal'
import type { PaginationResult } from 'convex/server'

import { ConvexCallError, normalizeConvexError } from '../errors'
import { deriveConvexAuthStatus, type ConvexAuthMode } from './auth-status'
import { createConvexPayloadKey, type ConvexPayloadNamespace } from './convex-cache'
import type { ConvexCallStatus } from './types'

/**
 * One Nuxt payload entry per query key: the SSR value or the normalized SSR
 * error. The error travels under its query key, so the identity purge that
 * drops a protected key drops its error with it.
 */
export type ConvexQueryPayload<T> = { readonly value: T } | { readonly error: ConvexCallError }

/** Nuxt's SSR-hydrated auth state; identical on the server and a hydrating browser. */
export interface NuxtQueryAuthState {
  readonly authEnabled: boolean
  readonly pending: boolean
  readonly identityKey: ConvexIdentityKey
  readonly error: ConvexCallError | null
}

const AUTH_DISABLED_IDENTITY: ClientIdentitySnapshot = Object.freeze({
  authEnabled: false,
  settled: true,
  identityKey: 'anonymous',
  identityGeneration: 0,
  error: null,
})

/**
 * Adapt Nuxt auth state to the Vue identity snapshot, so SSR, hydration, and
 * the browser runtime share one execution decision. Identity generations
 * belong to the browser runtime; the error survives only where
 * `useConvexAuth()` reports `status: 'error'`.
 */
export function projectNuxtQueryIdentity(state: NuxtQueryAuthState): ClientIdentitySnapshot {
  if (!state.authEnabled) return AUTH_DISABLED_IDENTITY
  const settled = !state.pending
  const status = deriveConvexAuthStatus({
    settled,
    identityKey: state.identityKey,
    error: state.error,
  })
  return {
    authEnabled: true,
    settled,
    identityKey: state.identityKey,
    identityGeneration: 0,
    error: status === 'error' ? state.error : null,
  }
}

export interface ConvexQueryGate {
  readonly outcome: QueryExecutionOutcome
  /** The public `blockedBy`, from the same decision the browser lifecycle makes. */
  readonly blockedBy: ConvexQueryBlockedBy
  /** Identity dimension of the payload key. */
  readonly identity: ConvexIdentityKey
}

export function resolveConvexQueryGate(input: {
  readonly auth: ConvexAuthMode
  readonly started: boolean
  readonly skipped: boolean
  readonly identity: ClientIdentitySnapshot
}): ConvexQueryGate {
  const { outcome, blockedBy } = decideQueryGate(input)
  return {
    outcome,
    blockedBy,
    identity: queryIsolationTag(input.auth, input.identity).identityKey,
  }
}

export function sameConvexQueryGate(a: ConvexQueryGate, b: ConvexQueryGate): boolean {
  return a.outcome === b.outcome && a.identity === b.identity
}

/** The Nuxt async-data key: the payload key when executing, a shared inert key otherwise. */
export function convexQueryAsyncDataKey(
  namespace: ConvexPayloadNamespace,
  functionName: string,
  argsHash: string,
  auth: ConvexAuthMode,
  gate: ConvexQueryGate,
): string {
  return gate.outcome === 'execute'
    ? createConvexPayloadKey(namespace, functionName, argsHash, auth, gate.identity)
    : `${namespace}:${gate.outcome}:${functionName}`
}

/** Read one payload entry, rejecting shapes this module never writes. */
export function readConvexQueryPayload<T>(entry: unknown): ConvexQueryPayload<T> | undefined {
  if (entry === null || typeof entry !== 'object') return undefined
  if (Object.hasOwn(entry, 'value')) return entry as ConvexQueryPayload<T>
  if (!Object.hasOwn(entry, 'error')) return undefined
  const error = (entry as { error: unknown }).error
  return { error: error instanceof ConvexCallError ? error : normalizeConvexError(error) }
}

/** What the server renders for a query, and so what a hydrating browser renders. */
export interface ConvexSsrQueryView<T> {
  readonly status: ConvexCallStatus
  readonly value: T | undefined
  readonly error: ConvexCallError | undefined
  readonly blockedBy: ConvexQueryBlockedBy
}

/**
 * The one SSR projection, called with the same inputs by the server render and
 * by the hydrating browser. Like Nuxt's `useAsyncData`, a query that was not
 * fetched on the server (`server: false`, no URL, no token) renders `idle`.
 */
export function projectConvexSsrQuery<T>(input: {
  readonly gate: Pick<ConvexQueryGate, 'outcome' | 'blockedBy'>
  readonly server: boolean
  /** Names the query on an auth-gate error, like every other query failure. */
  readonly functionName: string
  readonly authError: ConvexCallError | null
  readonly entry: ConvexQueryPayload<T> | null | undefined
  readonly fetching: boolean
}): ConvexSsrQueryView<T> {
  const { outcome, blockedBy } = input.gate
  const fetched = outcome === 'execute' && input.server
  const entry = fetched ? input.entry : undefined
  const hasValue = entry !== null && entry !== undefined && 'value' in entry
  const error =
    outcome === 'error'
      ? input.authError
        ? normalizeConvexError(input.authError, { functionName: input.functionName })
        : undefined
      : entry !== null && entry !== undefined && 'error' in entry
        ? entry.error
        : undefined
  return {
    status: deriveQueryStatus({
      pending: outcome === 'wait' || (fetched && input.fetching),
      error: error !== undefined,
      hasData: hasValue,
    }),
    value: hasValue ? entry.value : undefined,
    error,
    blockedBy,
  }
}

/**
 * The SSR pagination view. It is exactly the state the live list starts from
 * with the same first page, so the hand-off after hydration does not flicker.
 * The server never loads a later page.
 */
export interface ConvexSsrPaginationView<Item> {
  readonly status: ConvexCallStatus
  readonly data: readonly Item[] | undefined
  readonly error: ConvexCallError | undefined
  readonly blockedBy: ConvexQueryBlockedBy
  readonly canLoadMore: boolean
  readonly isExhausted: boolean
}

export function projectConvexSsrPagination<Item>(
  view: ConvexSsrQueryView<PaginationResult<Item>>,
): ConvexSsrPaginationView<Item> {
  const page = view.value
  return {
    status: view.status,
    data: page?.page,
    error: view.error,
    blockedBy: view.blockedBy,
    canLoadMore: view.status === 'success' && page?.isDone === false,
    isExhausted: page?.isDone === true,
  }
}
