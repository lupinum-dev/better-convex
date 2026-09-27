import type { ClientIdentitySnapshot } from './identity-port'
import type { QueryIsolationTag } from './query-controller'

export type QueryExecutionOutcome = 'execute' | 'idle' | 'wait' | 'error'

/**
 * Why a query is not running: `'skip'` arguments, a missing or unsettled
 * `'auth'` identity, or a `'manual'` query that has not been executed yet.
 * `null` once the query may run.
 */
export type ConvexQueryBlockedBy = 'skip' | 'auth' | 'manual' | null

/** The gate of one query lifecycle: whether it runs, and what blocks it otherwise. */
export interface QueryGateDecision {
  readonly outcome: QueryExecutionOutcome
  readonly blockedBy: ConvexQueryBlockedBy
}

/**
 * The one query execution decision, in fixed precedence: skip, `none`,
 * auth-disabled, unsettled, auth error, anonymous, authenticated. Adapters
 * with their own auth state (Nuxt SSR) project it onto a snapshot first.
 */
export function decideQueryExecution(input: {
  auth: 'required' | 'optional' | 'none'
  skipped: boolean
  identity: ClientIdentitySnapshot
}): QueryExecutionOutcome {
  if (input.skipped) return 'idle'
  if (input.auth === 'none') return 'execute'
  if (!input.identity.authEnabled) return input.auth === 'required' ? 'idle' : 'execute'
  if (!input.identity.settled) return 'wait'
  if (input.identity.error) return 'error'
  if (input.identity.identityKey === 'anonymous')
    return input.auth === 'required' ? 'idle' : 'execute'
  return 'execute'
}

/**
 * The one gate the browser lifecycle, the Nuxt SSR render, and a hydrating
 * browser share, so all three report the same `blockedBy` for the same inputs.
 *
 * Precedence is skip, manual, auth. A query that has not been started never
 * consults identity: the server and a hydrating browser may still disagree
 * about identity, but they always agree about arguments and `immediate`.
 */
export function decideQueryGate(input: {
  auth: 'required' | 'optional' | 'none'
  started: boolean
  skipped: boolean
  identity: ClientIdentitySnapshot
}): QueryGateDecision {
  if (input.skipped) return { outcome: 'idle', blockedBy: 'skip' }
  if (!input.started) return { outcome: 'idle', blockedBy: 'manual' }
  const outcome = decideQueryExecution({
    auth: input.auth,
    skipped: false,
    identity: input.identity,
  })
  return { outcome, blockedBy: outcome === 'execute' ? null : 'auth' }
}

/** The identity partition for query state, subscription keys, and SSR payload keys. */
export function queryIsolationTag(
  auth: 'required' | 'optional' | 'none',
  identity: ClientIdentitySnapshot,
): QueryIsolationTag {
  if (auth === 'none') return { identityKey: 'anonymous', identityGeneration: 0 }
  return {
    identityKey: identity.identityKey ?? 'anonymous',
    identityGeneration: identity.identityGeneration,
  }
}
