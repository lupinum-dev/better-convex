import type { ConvexAuthMode, ConvexQueryAuthStatus } from './auth-status'
import { isAuthenticatedIdentityKey, type ConvexIdentityKey } from './identity-key'

/**
 * Canonical query execution gate ("Required execution-gate behavior").
 *
 * The gate is driven by the canonical auth status and the stable identity key
 * published by the frozen {@link ClientIdentityPort} adapter — never by raw engine
 * state and never by `pending`. Background auth work must not idle an already
 * usable identity, so `pending` is deliberately absent from the input.
 *
 * Decision order (each step returns immediately):
 *   1. Explicit `'skip'` resolves idle.
 *   2. `none` executes without waiting and uses the `anonymous` cache dimension.
 *   3. `disabled`: `required` resolves idle; `optional` executes anonymously
 *      without waiting.
 *   4. `loading`: `required` and `optional` wait for initial auth settlement.
 *   5. `error`: `required` and `optional` surface the auth error without a
 *      network request. They do not silently downgrade to anonymous.
 *   6. `anonymous`: `required` resolves idle; `optional` executes anonymously.
 *   7. `authenticated`: `required` and `optional` require a non-null matching
 *      `user:<id>` key and execute with that identity.
 */
export interface QueryExecutionGateInput {
  authStatus: ConvexQueryAuthStatus
  authMode: ConvexAuthMode
  identityKey: ConvexIdentityKey | null
  skipped: boolean
}

/**
 * The terminal query execution decision:
 * - `execute` — the caller may issue its configured network request;
 * - `idle`    — resolve idle with no request and no error;
 * - `wait`    — wait for initial auth settlement, then re-evaluate;
 * - `error`   — surface the settled auth error with no request.
 */
export type QueryExecutionOutcome = 'execute' | 'idle' | 'wait' | 'error'

export interface QueryExecutionGate {
  outcome: QueryExecutionOutcome
  /** The identity dimension for the cache / payload / subscription key. */
  cacheIdentity: ConvexIdentityKey
}

const IDLE = {
  outcome: 'idle',
} as const

/**
 * Pure gate. No side effects, no reactivity, no client access — it maps the
 * canonical status + mode + identity key to a terminal decision so the same
 * matrix is trivially unit-testable across all status/mode combinations.
 */
export function createQueryExecutionGate(input: QueryExecutionGateInput): QueryExecutionGate {
  const { authStatus, authMode, identityKey, skipped } = input

  // 1. Explicit skip resolves idle regardless of auth.
  if (skipped) {
    return {
      ...IDLE,
      cacheIdentity: identityDimension(authMode, identityKey),
    }
  }

  // 2. `none` never inspects or waits for auth. Anonymous transport + anonymous
  //    cache dimension. Uses the dedicated anonymous client unless the whole
  //    build is auth-disabled (its primary is already anonymous).
  if (authMode === 'none') {
    return {
      outcome: 'execute',
      cacheIdentity: 'anonymous',
    }
  }

  // 3. Auth disabled: `required` idles, `optional` executes anonymously now.
  if (authStatus === 'disabled') {
    if (authMode === 'required') {
      return { ...IDLE, cacheIdentity: 'anonymous' }
    }
    return executeAnonymously()
  }

  // 4. Loading: both required and optional wait for initial settlement.
  if (authStatus === 'loading') {
    return {
      outcome: 'wait',
      cacheIdentity: identityDimension(authMode, identityKey),
    }
  }

  // 5. Error: surface the settled auth error; never downgrade to anonymous.
  if (authStatus === 'error') {
    return {
      outcome: 'error',
      cacheIdentity: identityDimension(authMode, identityKey),
    }
  }

  // 6. Anonymous: `required` idles, `optional` executes anonymously.
  if (authStatus === 'anonymous') {
    if (authMode === 'required') {
      return { ...IDLE, cacheIdentity: 'anonymous' }
    }
    return executeAnonymously()
  }

  // 7. Authenticated: both modes require a concrete matching `user:<id>` key.
  //    A settled 'authenticated' status always carries such a key; guard the
  //    inconsistent case (no usable id) by waiting rather than manufacturing a
  //    `user:undefined` identity .
  if (!isAuthenticatedIdentityKey(identityKey)) {
    return {
      outcome: 'wait',
      cacheIdentity: 'anonymous',
    }
  }

  return {
    outcome: 'execute',
    cacheIdentity: identityKey,
  }
}

function executeAnonymously(): QueryExecutionGate {
  return {
    outcome: 'execute',
    cacheIdentity: 'anonymous',
  }
}

/**
 * The cache dimension for a non-`none` query. `none` always keys under
 * `anonymous`; every other mode keys under the concrete authenticated subject
 * when one exists and `anonymous` otherwise.
 */
function identityDimension(
  authMode: ConvexAuthMode,
  identityKey: ConvexIdentityKey | null,
): ConvexIdentityKey {
  if (authMode === 'none') return 'anonymous'
  return isAuthenticatedIdentityKey(identityKey) ? identityKey : 'anonymous'
}
