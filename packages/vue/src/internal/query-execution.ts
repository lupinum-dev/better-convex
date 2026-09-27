import type { ClientIdentitySnapshot } from './identity-port'
import type { QueryIsolationTag } from './query-controller'

export type QueryExecutionOutcome = 'execute' | 'idle' | 'wait' | 'error'

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
