import type { BetterConvexAttachedRuntime } from 'better-convex-vue/embedded'
import type { ComputedRef } from 'vue'
import { computed } from 'vue'

import { useState } from '#imports'

import { identityKeyOf } from '../auth/auth-identity'
import { ConvexCallError } from '../errors'
import { useConvexIdentityState } from './auth-identity-state'
import { useConvexAuthPendingState } from './auth-pending-state'
import { deriveConvexAuthStatus, type ConvexAuthStatus } from './auth-status'
import type { ConvexIdentityKey } from './identity-key'
import type { QueryExecutionGate } from './query-execution-gate'
import { getConvexRuntimeConfig } from './runtime-config'

/**
 * Reactive canonical auth-identity inputs for query gating and isolation
 * tagging (architecture invariant). This is the single place query composables read auth
 * state; they never touch the auth engine directly.
 *
 * Derived from the SSR-seeded reactive state (`convex:pending` / `convex:identity` /
 * `convex:authError`) so it is correct on both server and client, plus the
 * Query isolation generations are owned by the attached Vue runtime; this Nuxt
 * context only derives the server/client execution gate.
 */
export interface ConvexQueryAuthContext {
  readonly status: ComputedRef<ConvexAuthStatus>
  readonly identityKey: ComputedRef<ConvexIdentityKey | null>
  readonly error: ComputedRef<ConvexCallError | null>
}

export function createConvexQueryAuthContext(): ConvexQueryAuthContext {
  const authEnabled = getConvexRuntimeConfig().auth !== false

  const identity = useConvexIdentityState()
  const pending = useConvexAuthPendingState()
  const authError = useState<string | null>('convex:authError', () => null)

  const identityKey = computed<ConvexIdentityKey | null>(() =>
    authEnabled ? identityKeyOf(identity.value) : null,
  )

  const error = computed<ConvexCallError | null>(() => {
    if (!authEnabled) return null
    return authError.value
      ? new ConvexCallError({
          kind: 'authentication',
          message: authError.value,
        })
      : null
  })

  const status = computed<ConvexAuthStatus>(() => {
    if (!authEnabled) return 'disabled'
    if (pending.value) return 'loading'
    return deriveConvexAuthStatus({
      authEnabled: true,
      settled: true,
      identityKey: identityKey.value,
      error: error.value,
    })
  })

  return {
    status,
    identityKey,
    error,
  }
}

/**
 * Select the live/once transport client for a gate decision (architecture invariant).
 *
 * - `none` in an auth-enabled build uses the dedicated anonymous client that
 *   never receives `setAuth` (its identity is never rebound).
 * - `required`/`optional` (and `none` in an auth-disabled build) use the
 *   owner's stable handle. Its live listeners register even while a confirmed
 *   replacement is pending, then rebind to the replacement on publication.
 *
 * Returns `null` when no client owner exists (SSR uses HTTP, never a WS client).
 */
export function selectLiveQueryClient(
  runtime: BetterConvexAttachedRuntime | undefined,
  gate: QueryExecutionGate,
): Pick<BetterConvexAttachedRuntime['client'], 'query' | 'onUpdate'> | null {
  if (!runtime || gate.outcome !== 'execute') return null
  if (gate.useAnonymousClient) return runtime.anonymousClient
  return runtime.client
}
